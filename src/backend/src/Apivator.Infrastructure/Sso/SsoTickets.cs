namespace Apivator.Infrastructure.Sso;

/// <summary>
/// Kimlik sağlayıcıya gönderilmiş, dönüşü beklenen bir giriş (state). Birden fazla API örneğinde de çalışsın diye
/// bellekte değil veritabanında tutulur; dönüşte bir kez kullanılıp silinir.
/// </summary>
public sealed class SsoLoginTicket
{
    public Guid Id { get; set; } = Guid.CreateVersion7();

    /// <summary>state değerinin SHA-256 özeti (state'in kendisi saklanmaz).</summary>
    public string StateHash { get; set; } = string.Empty;

    public Guid OrganizationId { get; set; }

    /// <summary>PKCE code_verifier (Data Protection ile şifreli).</summary>
    public string ProtectedCodeVerifier { get; set; } = string.Empty;

    public string Nonce { get; set; } = string.Empty;

    /// <summary>
    /// Akışı başlatan istemcinin challenge'ı (S256). Giriş kodu yalnızca aynı istemcinin verifier'ıyla oturuma
    /// çevrilir; başkasının kodu kurbana verilerek onun tarayıcısında oturum açtırılamaz (login CSRF).
    /// </summary>
    public string ClientChallenge { get; set; } = string.Empty;

    /// <summary>Masaüstü: yerel ajanın dönüş adresi; web'de null.</summary>
    public string? ReturnUrl { get; set; }

    /// <summary>Masaüstü: ajanın beklediği state, dönüş adresine aynen eklenir.</summary>
    public string? ClientState { get; set; }

    public DateTimeOffset ExpiresAt { get; set; }
}

/// <summary>Başarılı dönüşten sonra istemciye verilen tek kullanımlık, kısa ömürlü giriş kodu.</summary>
public sealed class SsoLoginCode
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromSeconds(60);

    public Guid Id { get; set; } = Guid.CreateVersion7();

    public string CodeHash { get; set; } = string.Empty;

    public Guid UserId { get; set; }

    public Guid OrganizationId { get; set; }

    /// <summary>Girişi başlatan istemcinin challenge'ı (bkz. <see cref="SsoLoginTicket.ClientChallenge"/>).</summary>
    public string ClientChallenge { get; set; } = string.Empty;

    public DateTimeOffset ExpiresAt { get; set; }
}

/// <summary>
/// Kimlik sağlayıcıdaki kimliği, aynı e-postalı mevcut (doğrulanmış) bir Apivator hesabına bağlama isteği. Bağlama
/// e-postadaki bağlantıyla onaylanır: IdP'nin e-posta claim'i değiştirilebilir olabileceği için (ör. Entra) yalnızca
/// claim'e güvenilip başkasının hesabına girilmez.
/// </summary>
public sealed class SsoLinkRequest
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromHours(1);

    public Guid Id { get; set; } = Guid.CreateVersion7();

    public string TokenHash { get; set; } = string.Empty;

    public Guid UserId { get; set; }

    public Guid OrganizationId { get; set; }

    public string LoginProvider { get; set; } = string.Empty;

    public string Subject { get; set; } = string.Empty;

    public DateTimeOffset ExpiresAt { get; set; }
}
