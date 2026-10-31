using System.Security.Cryptography;
using Apivator.Domain.Common;

namespace Apivator.Domain.Organizations;

/// <summary>
/// Organizasyonun tek oturum açma (OIDC) ayarı. Giriş yalnızca doğrulanmış alan adlarındaki e-postalar için çalışır:
/// kimlik sağlayıcının döndürdüğü adres bu alan adlarından birinde değilse reddedilir (başka birinin hesabına
/// IdP üzerinden girilemez).
/// </summary>
public sealed class OrganizationSso : Entity
{
    public const int AuthorityMaxLength = 500;
    public const int ClientIdMaxLength = 300;
    public const int MaxDomains = 20;

    private readonly List<SsoDomain> _domains = [];

    private OrganizationSso()
    {
        Authority = string.Empty;
        ClientId = string.Empty;
    }

    public Guid OrganizationId { get; private set; }

    /// <summary>Açık değilse SSO ile giriş yapılamaz (ayarlar saklanır).</summary>
    public bool Enabled { get; private set; }

    /// <summary>
    /// Doğrulanmış alan adlarındaki hesaplar şifreyle giriş yapamaz, yalnızca SSO. Organizasyon sahibi acil durum
    /// için şifreyle girebilir. Bu kullanıcılarda iki adımlı doğrulama kimlik sağlayıcıya bırakılır.
    /// </summary>
    public bool Enforced { get; private set; }

    /// <summary>OIDC issuer adresi (ör. https://login.microsoftonline.com/{tenant}/v2.0).</summary>
    public string Authority { get; private set; }

    public string ClientId { get; private set; }

    /// <summary>Data Protection ile şifrelenmiş client secret; düz hâli hiçbir zaman saklanmaz ya da döndürülmez.</summary>
    public string? ProtectedClientSecret { get; private set; }

    /// <summary>
    /// Doğrulanmış alan adından ilk kez gelen kişi için hesap açılır ve organizasyona <see cref="DefaultRole"/> ile
    /// eklenir. Kapalıysa yalnızca zaten üye olanlar girebilir.
    /// </summary>
    public bool AutoProvision { get; private set; }

    public OrganizationRole DefaultRole { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public IReadOnlyCollection<SsoDomain> Domains => _domains;

    public bool HasVerifiedDomain => _domains.Any(d => d.VerifiedAt is not null);

    public static OrganizationSso Create(Guid organizationId, DateTimeOffset now) => new()
    {
        OrganizationId = organizationId,
        DefaultRole = OrganizationRole.Member,
        AutoProvision = true,
        CreatedAt = now,
        UpdatedAt = now,
    };

    public void Configure(string authority, string clientId, string? protectedClientSecret, bool keepSecret, bool autoProvision, OrganizationRole defaultRole, DateTimeOffset now)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(authority);
        ArgumentException.ThrowIfNullOrWhiteSpace(clientId);
        if (defaultRole == OrganizationRole.Owner)
        {
            throw new InvalidOperationException("Varsayılan rol sahip olamaz.");
        }

        Authority = authority.Trim().TrimEnd('/');
        ClientId = clientId.Trim();
        if (!keepSecret)
        {
            ProtectedClientSecret = protectedClientSecret;
        }

        AutoProvision = autoProvision;
        DefaultRole = defaultRole;
        UpdatedAt = now;
    }

    public void SetState(bool enabled, bool enforced, DateTimeOffset now)
    {
        if (enabled && !HasVerifiedDomain)
        {
            throw new InvalidOperationException("SSO açılmadan önce en az bir alan adı doğrulanmalı.");
        }

        Enabled = enabled;
        Enforced = enabled && enforced;
        UpdatedAt = now;
    }

    public SsoDomain AddDomain(string domain, DateTimeOffset now)
    {
        var normalized = SsoDomain.Normalize(domain);
        if (_domains.Count >= MaxDomains)
        {
            throw new InvalidOperationException($"En fazla {MaxDomains} alan adı eklenebilir.");
        }

        if (_domains.Any(d => d.Domain == normalized))
        {
            throw new InvalidOperationException("Bu alan adı zaten ekli.");
        }

        var entry = new SsoDomain(Id, normalized, now);
        _domains.Add(entry);
        UpdatedAt = now;
        return entry;
    }

    public void RemoveDomain(Guid domainId, DateTimeOffset now)
    {
        _domains.RemoveAll(d => d.Id == domainId);
        DisableIfNoVerifiedDomain(now);
    }

    /// <summary>Doğrulanmış alan adı kalmadıysa giriş yapılamaz; ayar açık bırakılmaz. Kapandıysa true.</summary>
    public bool DisableIfNoVerifiedDomain(DateTimeOffset now)
    {
        UpdatedAt = now;
        if (HasVerifiedDomain || !Enabled)
        {
            return false;
        }

        Enabled = false;
        Enforced = false;
        return true;
    }

    /// <summary>E-posta bu organizasyonun doğrulanmış alan adlarından birinde mi?</summary>
    public bool CoversEmail(string email)
    {
        var at = email.LastIndexOf('@');
        if (at < 0)
        {
            return false;
        }

        var domain = email[(at + 1)..].Trim().ToLowerInvariant();
        return _domains.Any(d => d.VerifiedAt is not null && d.Domain == domain);
    }
}

/// <summary>SSO için sahiplenilen alan adı; DNS TXT kaydıyla doğrulanır.</summary>
public sealed class SsoDomain : Entity
{
    public const int DomainMaxLength = 253;

    /// <summary>TXT kaydının değeri bu önekle başlar.</summary>
    public const string RecordPrefix = "apivator-verification=";

    private SsoDomain()
    {
        Domain = string.Empty;
        VerificationToken = string.Empty;
    }

    internal SsoDomain(Guid ssoId, string domain, DateTimeOffset now)
    {
        SsoId = ssoId;
        Domain = domain;
        VerificationToken = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));
        CreatedAt = now;
    }

    public Guid SsoId { get; private set; }

    public string Domain { get; private set; }

    public string VerificationToken { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset? VerifiedAt { get; private set; }

    /// <summary>Doğrulanmış alan adı günde bir yeniden kontrol edilir (alan adı el değiştirmiş olabilir).</summary>
    public DateTimeOffset? LastCheckedAt { get; private set; }

    /// <summary>Art arda başarısız yeniden kontrol sayısı; <see cref="MaxFailedChecks"/>'e ulaşınca doğrulama kalkar.</summary>
    public int FailedChecks { get; private set; }

    public const int MaxFailedChecks = 3;

    /// <summary>DNS'e eklenecek TXT kaydının değeri.</summary>
    public string RecordValue => RecordPrefix + VerificationToken;

    public void MarkVerified(DateTimeOffset now)
    {
        VerifiedAt ??= now;
        LastCheckedAt = now;
        FailedChecks = 0;
    }

    /// <summary>
    /// Yeniden kontrol sonucu. Tek başarısızlık (DNS kesintisi) doğrulamayı kaldırmaz; art arda
    /// <see cref="MaxFailedChecks"/> kez bulunamazsa kaldırır ve true döner.
    /// </summary>
    public bool RecordCheck(bool found, DateTimeOffset now)
    {
        LastCheckedAt = now;
        if (found)
        {
            FailedChecks = 0;
            return false;
        }

        FailedChecks++;
        if (FailedChecks < MaxFailedChecks || VerifiedAt is null)
        {
            return false;
        }

        VerifiedAt = null;
        FailedChecks = 0;
        return true;
    }

    /// <summary>"Firma.COM." → "firma.com"; geçersizse istisna.</summary>
    public static string Normalize(string domain)
    {
        var value = (domain ?? string.Empty).Trim().TrimEnd('.').ToLowerInvariant();
        if (value.StartsWith('@'))
        {
            value = value[1..];
        }

        if (value.Length is 0 or > DomainMaxLength || !value.Contains('.', StringComparison.Ordinal)
            || value.Split('.').Any(label => label.Length is 0 or > 63 || label.StartsWith('-') || label.EndsWith('-') || !label.All(c => char.IsAsciiLetterOrDigit(c) || c == '-')))
        {
            throw new ArgumentException("Geçerli bir alan adı girin (ör. firma.com).", nameof(domain));
        }

        return value;
    }
}
