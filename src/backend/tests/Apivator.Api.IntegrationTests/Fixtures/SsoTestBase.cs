using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using Apivator.Application.Audit;
using Apivator.Application.Auth;
using Apivator.Application.Sso;
using Apivator.Application.Teams;
using Apivator.Application.Workspaces;
using Apivator.Domain.Organizations;
using Apivator.Domain.Workspaces;
using Apivator.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Apivator.Api.IntegrationTests.Fixtures;

/// <summary>
/// SSO testlerinin ortak adımları. Her test kendi kimlik sağlayıcısını (yeni port, yeni issuer) ve kendi alan adını
/// kullanır; doğrulanmış alan adı tüm sistemde tek organizasyona ait olabildiği için testler birbirini etkilemez.
/// </summary>
public abstract class SsoTestBase(ApivatorApiFactory factory) : IAsyncLifetime
{
    /// <summary>Uygulamanın web adresi (App:PublicUrl) ve kimlik sağlayıcıya bildirdiği dönüş adresi.</summary>
    protected const string PublicUrl = "http://localhost:5173";
    protected const string RedirectUri = PublicUrl + "/api/auth/sso/callback";

    protected ApivatorApiFactory Factory => factory;

    protected FakeOidcProvider Idp { get; } = new();

    public Task InitializeAsync() => Idp.InitializeAsync();

    public Task DisposeAsync() => Idp.DisposeAsync();

    protected sealed record User(HttpClient Client, Guid Id, string Email);

    /// <summary>SSO'su açık bir organizasyon: sahibi, "Genel" workspace'i ve doğrulanmış alan adı.</summary>
    protected sealed record SsoOrg(User Owner, OrganizationDto Org, WorkspaceDto General, string Domain);

    protected static string NewDomain() => $"sso-{Guid.NewGuid():N}.example";

    protected async Task<User> UserAsync(string? email = null, string name = "Test Kullanıcı")
    {
        var client = Factory.CreateClient();
        email ??= TestHelpers.NewEmail();
        var auth = await client.RegisterAsync(email, name);
        client.WithBearer(auth.AccessToken);
        return new User(client, auth.User.Id, email);
    }

    /// <summary>Kayıtta gönderilen bağlantıyla e-posta adresini doğrular.</summary>
    protected async Task ConfirmEmailAsync(User user)
    {
        var mail = Factory.Emails.Sent.Last(m => m.To == user.Email && m.TextBody.Contains("confirm-email", StringComparison.Ordinal));
        (await user.Client.PostAsJsonAsync("/api/auth/confirm-email", new ConfirmEmailRequest(
            Guid.Parse(TestHelpers.QueryValue(mail.TextBody, "userId")), TestHelpers.QueryValue(mail.TextBody, "token")))).EnsureSuccessStatusCode();
    }

    protected static async Task<(OrganizationDto Org, WorkspaceDto General)> OrganizationAsync(User owner, string name = "Tekil A.Ş.")
    {
        var org = await (await owner.Client.PostAsJsonAsync("/api/organizations", new CreateOrganizationRequest(name))).ReadAsync<OrganizationDto>();
        var general = (await owner.Client.GetFromJsonAsync<List<WorkspaceDto>>("/api/workspaces"))!.Single(w => w.OrganizationId == org.Id);
        return (org, general);
    }

    /// <summary>Kullanıcıyı davet edip daveti kabul ettirir.</summary>
    protected async Task MemberAsync(User admin, Guid orgId, User user, OrganizationRole role = OrganizationRole.Member, Guid? workspaceId = null)
    {
        await (await admin.Client.PostAsJsonAsync($"/api/organizations/{orgId}/invitations", new InviteRequest(user.Email, role, workspaceId, workspaceId is null ? null : WorkspaceRole.Editor))).ReadAsync<InvitationDto>();
        var token = TestHelpers.QueryValue(Factory.Emails.LastTo(user.Email).TextBody, "token");
        await (await user.Client.PostAsJsonAsync("/api/invitations/accept", new AcceptInvitationRequest(token))).ReadAsync<AcceptedInvitationDto>();
    }

    protected Task<HttpResponseMessage> ConfigureAsync(User owner, Guid orgId, bool autoProvision = true, OrganizationRole defaultRole = OrganizationRole.Member, string? authority = null) =>
        owner.Client.PutAsJsonAsync($"/api/organizations/{orgId}/sso", new UpdateSsoRequest(authority ?? Idp.BaseUrl, Idp.ClientId, Idp.ClientSecret, autoProvision, defaultRole));

    protected static async Task<SsoDomainDto> AddDomainAsync(User owner, Guid orgId, string domain)
    {
        var settings = await (await owner.Client.PostAsJsonAsync($"/api/organizations/{orgId}/sso/domains", new AddSsoDomainRequest(domain))).ReadAsync<SsoSettingsDto>();
        return settings.Domains.Single(d => string.Equals(d.Domain, domain.Trim().TrimStart('@').TrimEnd('.'), StringComparison.OrdinalIgnoreCase));
    }

    protected static Task<HttpResponseMessage> VerifyAsync(User owner, Guid orgId, Guid domainId) =>
        owner.Client.PostAsync($"/api/organizations/{orgId}/sso/domains/{domainId}/verify", null);

    /// <summary>Alan adını ekler, TXT kaydını "DNS'e yazar" ve doğrular.</summary>
    protected async Task<SsoDomainDto> VerifiedDomainAsync(User owner, Guid orgId, string domain)
    {
        var added = await AddDomainAsync(owner, orgId, domain);
        Factory.Dns.Publish(added.RecordName, added.RecordValue);
        var settings = await (await VerifyAsync(owner, orgId, added.Id)).ReadAsync<SsoSettingsDto>();
        return settings.Domains.Single(d => d.Id == added.Id);
    }

    protected static Task<HttpResponseMessage> SetStateAsync(User owner, Guid orgId, bool enabled, bool enforced = false) =>
        owner.Client.PutAsJsonAsync($"/api/organizations/{orgId}/sso/state", new SsoStateRequest(enabled, enforced));

    /// <summary>
    /// Sahibi bu alan adında olan bir organizasyon kurar, kimlik sağlayıcıyı tanımlar, alan adını doğrular ve SSO'yu açar.
    /// <paramref name="beforeEnable"/> SSO açılmadan (kayıt hâlâ serbestken) çalışır.
    /// </summary>
    protected async Task<SsoOrg> SsoOrgAsync(
        bool enforced = false,
        bool autoProvision = true,
        OrganizationRole defaultRole = OrganizationRole.Member,
        Func<SsoOrg, Task>? beforeEnable = null)
    {
        var domain = NewDomain();
        var owner = await UserAsync($"sahip@{domain}", "Sahip");
        var (org, general) = await OrganizationAsync(owner, $"Tekil {domain[4..12]} A.Ş.");
        (await ConfigureAsync(owner, org.Id, autoProvision, defaultRole)).EnsureSuccessStatusCode();
        await VerifiedDomainAsync(owner, org.Id, domain);
        var result = new SsoOrg(owner, org, general, domain);
        if (beforeEnable is not null)
        {
            await beforeEnable(result);
        }

        await (await SetStateAsync(owner, org.Id, true, enforced)).ReadAsync<SsoSettingsDto>();
        return result;
    }

    /// <summary>Başlatılmış bir giriş: kimlik sağlayıcı adresi ve istemcide kalan PKCE doğrulayıcısı.</summary>
    protected sealed record SsoFlow(string Url, string Verifier)
    {
        public string State => Param(Url, "state")!;

        /// <summary>Kimlik sağlayıcının bu girişe döneceği sorgu dizesi.</summary>
        public string Callback(string code) => $"code={Uri.EscapeDataString(code)}&state={Uri.EscapeDataString(State)}";
    }

    protected static string NewVerifier() => WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));

    protected static string Challenge(string verifier) => WebEncoders.Base64UrlEncode(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));

    protected Task<HttpResponseMessage> StartAsync(string email, string? returnUrl = null, string? state = null, string? challenge = null) =>
        Factory.CreateClient().PostAsJsonAsync("/api/auth/sso/start", new SsoStartRequest(email, challenge ?? Challenge(NewVerifier()), returnUrl, state));

    protected async Task<SsoFlow> BeginAsync(string email, string? returnUrl = null, string? state = null)
    {
        var verifier = NewVerifier();
        var start = await (await StartAsync(email, returnUrl, state, Challenge(verifier))).ReadAsync<SsoStartDto>();
        return new SsoFlow(start.AuthorizationUrl, verifier);
    }

    /// <summary>Kimlik sağlayıcının tarayıcıyı geri gönderdiği adresi çağırır ve yönlendirme hedefini döner.</summary>
    protected async Task<Uri> CallbackAsync(string query, string? forwardedFor = null)
    {
        var client = Factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        if (forwardedFor is not null)
        {
            client.DefaultRequestHeaders.Add("X-Forwarded-For", forwardedFor);
        }

        var response = await client.GetAsync("/api/auth/sso/callback?" + query);
        Assert.True(response.StatusCode == HttpStatusCode.Redirect, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return response.Headers.Location!;
    }

    /// <summary>Başlat → kimlik sağlayıcıda giriş → dönüş. Yönlendirme hedefini ve PKCE doğrulayıcısını döner.</summary>
    protected async Task<(Uri Location, string Verifier)> SignInAtIdpAsync(string email, FakeOidcIdentity identity, IdTokenTamper tamper = IdTokenTamper.None)
    {
        var flow = await BeginAsync(email);
        return (await CallbackAsync(flow.Callback(Idp.Authorize(flow.Url, identity, tamper))), flow.Verifier);
    }

    /// <summary>Girişin hata koduyla web dönüş sayfasına yönlendiğini doğrular.</summary>
    protected async Task AssertFailsAsync(string email, FakeOidcIdentity identity, string reason, IdTokenTamper tamper = IdTokenTamper.None) =>
        AssertError((await SignInAtIdpAsync(email, identity, tamper)).Location, reason);

    protected static string? Param(string url, string key) =>
        QueryHelpers.ParseQuery(new Uri(url).Query).TryGetValue(key, out var value) ? value.ToString() : null;

    protected static string? Param(Uri url, string key) => Param(url.ToString(), key);

    /// <summary>Web dönüş sayfasına başarıyla gelindiğini doğrular; tek kullanımlık giriş kodunu döner.</summary>
    protected static string LoginCode(Uri location)
    {
        Assert.StartsWith(PublicUrl + "/sso/callback?", location.ToString(), StringComparison.Ordinal);
        Assert.Null(Param(location, "error"));
        return Param(location, "code") ?? throw new Xunit.Sdk.XunitException($"Giriş kodu yok: {location}");
    }

    protected static void AssertError(Uri location, string reason)
    {
        Assert.StartsWith(PublicUrl + "/sso/callback?", location.ToString(), StringComparison.Ordinal);
        Assert.Equal("sso_" + reason, Param(location, "error"));
        Assert.Null(Param(location, "code"));
    }

    protected Task<HttpResponseMessage> ExchangeAsync(string code, string verifier, HttpClient? client = null) =>
        (client ?? Factory.CreateClient()).PostAsJsonAsync("/api/auth/sso/exchange", new SsoExchangeRequest(code, verifier));

    /// <summary>Tüm akış: kimlik sağlayıcıda giriş, dönüş ve kodun oturuma çevrilmesi. Token'lı istemciyi döner.</summary>
    protected async Task<(HttpClient Client, AuthResult Auth)> SsoLoginAsync(string email, FakeOidcIdentity identity)
    {
        var (location, verifier) = await SignInAtIdpAsync(email, identity);
        var auth = await (await ExchangeAsync(LoginCode(location), verifier)).ReadAsync<AuthResult>();
        return (Factory.CreateClient().WithBearer(auth.AccessToken), auth);
    }

    protected static async Task<List<AuditEntryDto>> AuditAsync(User admin, Guid orgId, string action = "sso") =>
        [.. (await admin.Client.GetFromJsonAsync<AuditPageDto>($"/api/organizations/{orgId}/audit?limit=200&action={action}"))!.Items];

    /// <summary>Dönüş/giriş kodunun ya da bağlama bağlantısının süresini veritabanında geçmişe çeker (servisle aynı SHA-256 özeti).</summary>
    protected async Task ExpireAsync(string? state = null, string? loginCode = null, string? linkToken = null)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var past = DateTimeOffset.UtcNow.AddMinutes(-1);
        if (state is not null)
        {
            var hash = Hash(state);
            Assert.Equal(1, await db.SsoLoginTickets.Where(t => t.StateHash == hash).ExecuteUpdateAsync(u => u.SetProperty(t => t.ExpiresAt, past)));
        }

        if (loginCode is not null)
        {
            var hash = Hash(loginCode);
            Assert.Equal(1, await db.SsoLoginCodes.Where(c => c.CodeHash == hash).ExecuteUpdateAsync(u => u.SetProperty(c => c.ExpiresAt, past)));
        }

        if (linkToken is not null)
        {
            var hash = Hash(linkToken);
            Assert.Equal(1, await db.SsoLinkRequests.Where(r => r.TokenHash == hash).ExecuteUpdateAsync(u => u.SetProperty(r => r.ExpiresAt, past)));
        }
    }

    /// <summary>Bu bağlama bağlantısının kaydı hâlâ veritabanında mı?</summary>
    protected async Task<bool> LinkRequestExistsAsync(string linkToken)
    {
        using var scope = Factory.Services.CreateScope();
        var hash = Hash(linkToken);
        return await scope.ServiceProvider.GetRequiredService<AppDbContext>().SsoLinkRequests.AnyAsync(r => r.TokenHash == hash);
    }

    private static string Hash(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}
