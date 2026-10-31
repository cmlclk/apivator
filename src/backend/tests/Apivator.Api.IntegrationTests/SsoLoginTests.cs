using System.Net;
using System.Net.Http.Json;
using Apivator.Api.IntegrationTests.Fixtures;
using Apivator.Application.Auth;
using Apivator.Application.Teams;
using Apivator.Application.Workspaces;
using Apivator.Domain.Organizations;
using Apivator.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Apivator.Api.IntegrationTests;

/// <summary>SSO ile giriş akışı: OIDC + PKCE, tek kullanımlık state ve giriş kodu, alan adı sınırı, bozuk yanıtlar.</summary>
[Collection(ApiCollection.Name)]
public class SsoLoginTests(ApivatorApiFactory factory) : SsoTestBase(factory)
{
    [Fact]
    public async Task FirstLogin_ProvisionsConfirmedMember_AndExchangeStartsSession()
    {
        var s = await SsoOrgAsync(defaultRole: OrganizationRole.Admin);
        var email = $"yeni.kisi@{s.Domain}";

        var flow = await BeginAsync(email);
        Assert.Equal((RedirectUri, "S256", email), (Param(flow.Url, "redirect_uri"), Param(flow.Url, "code_challenge_method"), Param(flow.Url, "login_hint")));
        Assert.All(new[] { "state", "nonce", "code_challenge" }, key => Assert.True(Param(flow.Url, key) is { Length: >= 43 }, key));

        // Sağlayıcıya giden PKCE, istemcinin challenge'ından ayrıdır (istemcinin verifier'ı sunucuya hiç gitmez).
        Assert.NotEqual(Challenge(flow.Verifier), Param(flow.Url, "code_challenge"));
        Assert.NotEqual(flow.State, (await BeginAsync(email)).State);

        var location = await CallbackAsync(flow.Callback(Idp.Authorize(flow.Url, new FakeOidcIdentity("idp-kullanici-1", email, "Yeni Kişi"))));
        Assert.True(Idp.Rejections.IsEmpty, string.Join("; ", Idp.Rejections));
        Assert.Equal((1, "basic"), (Idp.TokenRequests, Idp.LastClientAuth));
        var loginCode = LoginCode(location);

        // Web istemcisi: refresh token httpOnly cookie olarak da gelir.
        var browser = Factory.CreateClient(new() { BaseAddress = new Uri("https://localhost") });
        var auth = await (await ExchangeAsync(loginCode, flow.Verifier, browser)).ReadAsync<AuthResult>();
        Assert.Equal((email, "Yeni Kişi", true), (auth.User.Email, auth.User.DisplayName, auth.User.EmailConfirmed));
        Assert.Equal(HttpStatusCode.OK, (await browser.PostAsync("/api/auth/refresh", null)).StatusCode);

        // Giriş kodu tek kullanımlıktır.
        Assert.Equal(HttpStatusCode.Unauthorized, (await ExchangeAsync(loginCode, flow.Verifier)).StatusCode);

        var client = Factory.CreateClient().WithBearer(auth.AccessToken);
        var orgs = (await client.GetFromJsonAsync<List<OrganizationDto>>("/api/organizations"))!;
        Assert.Equal(OrganizationRole.Admin, orgs.Single(o => o.Id == s.Org.Id).Role);
        Assert.Contains(orgs, o => o.IsPersonal);
        Assert.Contains((await client.GetFromJsonAsync<List<WorkspaceDto>>("/api/workspaces"))!, w => w.Id == s.General.Id);

        var provisioned = Assert.Single(await AuditAsync(s.Owner, s.Org.Id, "sso.user_provisioned"));
        var login = Assert.Single(await AuditAsync(s.Owner, s.Org.Id, "sso.login"));
        Assert.Equal((auth.User.Id, "Yeni Kişi", auth.User.Id, email), (provisioned.TargetId, provisioned.ActorName, login.ActorId, login.Data["email"]));

        // İkinci girişte yeni hesap açılmaz.
        var (_, again) = await SsoLoginAsync(email, new FakeOidcIdentity("idp-kullanici-1", email, "Yeni Kişi"));
        Assert.Equal(auth.User.Id, again.User.Id);
        Assert.Single(await AuditAsync(s.Owner, s.Org.Id, "sso.user_provisioned"));
        Assert.Equal(2, (await AuditAsync(s.Owner, s.Org.Id, "sso.login")).Count);
    }

    [Fact]
    public async Task IdpCannotSignIntoAddressesOutsideVerifiedDomains()
    {
        var victim = await UserAsync(name: "Kurban"); // @example.com
        var s = await SsoOrgAsync(defaultRole: OrganizationRole.Admin);

        // Organizasyona eklenmiş ama doğrulanmamış alan adı da sayılmaz.
        var unverified = NewDomain();
        await AddDomainAsync(s.Owner, s.Org.Id, unverified);

        var forged = new[] { victim.Email, $"biri@{unverified}", $"biri@alt.{s.Domain}", $"biri@{s.Domain}.saldirgan.example" };
        foreach (var email in forged)
        {
            await AssertFailsAsync($"biri@{s.Domain}", new FakeOidcIdentity("saldirgan", email), "domain_mismatch");
        }

        Assert.Empty(await AuditAsync(s.Owner, s.Org.Id, "sso.login"));
        Assert.DoesNotContain((await victim.Client.GetFromJsonAsync<List<OrganizationDto>>("/api/organizations"))!, o => o.Id == s.Org.Id);

        // Başarısız denemeler sebebi ve sağlayıcının gönderdiği adresle denetim kaydına yazılır.
        var failures = await AuditAsync(s.Owner, s.Org.Id, "sso.login_failed");
        Assert.Equal(forged.Length, failures.Count);
        Assert.All(failures, f => Assert.Equal("domain_mismatch", f.Data["reason"]));
        Assert.Equal(forged.Reverse(), failures.Select(f => f.Data["email"]));

        // SSO'su olmayan bir adresle başlatılamaz.
        var start = await StartAsync(victim.Email);
        Assert.Equal(HttpStatusCode.BadRequest, start.StatusCode);
        Assert.Contains("sso.not_available", await start.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(IdTokenTamper.WrongNonce)]
    [InlineData(IdTokenTamper.ForeignKey)]
    [InlineData(IdTokenTamper.WrongAudience)]
    [InlineData(IdTokenTamper.WrongIssuer)]
    [InlineData(IdTokenTamper.Expired)]
    [InlineData(IdTokenTamper.HmacSigned)]
    [InlineData(IdTokenTamper.NoSignature)]
    [InlineData(IdTokenTamper.NoSubject)]
    public async Task TamperedIdToken_IsRejected(IdTokenTamper tamper)
    {
        var s = await SsoOrgAsync();
        var email = $"kisi@{s.Domain}";

        await AssertFailsAsync(email, new FakeOidcIdentity("sub-1", email), "invalid_response", tamper);
        Assert.Empty(await AuditAsync(s.Owner, s.Org.Id, "sso.login"));
        Assert.Equal("invalid_response", Assert.Single(await AuditAsync(s.Owner, s.Org.Id, "sso.login_failed")).Data["reason"]);
        Assert.Equal(1, Idp.TokenRequests);
    }

    [Fact]
    public async Task ChangingTheIdp_DoesNotCarryOverSubjectLinks()
    {
        var s = await SsoOrgAsync();
        var email = $"kisi@{s.Domain}";
        var (_, first) = await SsoLoginAsync(email, new FakeOidcIdentity("ortak-sub", email));

        // Yeni sağlayıcıda aynı "sub" bambaşka bir kişiye ait olabilir: eski bağlantıyla doğrudan girilmez.
        var other = new FakeOidcProvider();
        await other.InitializeAsync();
        try
        {
            (await ConfigureAsync(s.Owner, s.Org.Id, authority: other.BaseUrl)).EnsureSuccessStatusCode();
            var flow = await BeginAsync(email);
            AssertError(await CallbackAsync(flow.Callback(other.Authorize(flow.Url, new FakeOidcIdentity("ortak-sub", email)))), "link_sent");
        }
        finally
        {
            await other.DisposeAsync();
        }

        Assert.Contains("/sso/link?token=", Factory.Emails.LastTo(email).TextBody, StringComparison.Ordinal);

        // Eski sağlayıcıya dönülünce eski bağlantı yine geçerlidir.
        (await ConfigureAsync(s.Owner, s.Org.Id)).EnsureSuccessStatusCode();
        Assert.Equal(first.User.Id, (await SsoLoginAsync(email, new FakeOidcIdentity("ortak-sub", email))).Auth.User.Id);
    }

    [Fact]
    public async Task MissingOrUnverifiedEmail_IsRejected()
    {
        var s = await SsoOrgAsync();
        var email = $"kisi@{s.Domain}";

        await AssertFailsAsync(email, new FakeOidcIdentity("sub-1", null), "no_email");
        await AssertFailsAsync(email, new FakeOidcIdentity("sub-1", email, EmailVerified: false), "email_unverified");

        // Bazı sağlayıcılar boolean yerine dize gönderir.
        await AssertFailsAsync(email, new FakeOidcIdentity("sub-1", email, EmailVerified: "false"), "email_unverified");
        LoginCode((await SignInAtIdpAsync(email, new FakeOidcIdentity("sub-1", email, EmailVerified: "true"))).Location);

        // email_verified hiç gönderilmezse (Entra ID gibi) doğrulanmış alan adı yeterlidir.
        LoginCode((await SignInAtIdpAsync(email, new FakeOidcIdentity("sub-1", email, EmailVerified: FakeOidcIdentity.Omitted))).Location);
    }

    [Fact]
    public async Task State_IsSingleUse_AndExpires()
    {
        var s = await SsoOrgAsync();
        var email = $"kisi@{s.Domain}";
        var identity = new FakeOidcIdentity("sub-1", email);

        AssertError(await CallbackAsync("code=x&state=hic-verilmedi"), "expired");
        AssertError(await CallbackAsync("code=x"), "expired");

        // Tanınmayan state hiçbir organizasyona ait değildir; denetim kaydı yazılmaz (kayıt şişirilemez).
        Assert.Empty(await AuditAsync(s.Owner, s.Org.Id, "sso.login_failed"));

        // Kullanıcı sağlayıcıda reddederse; aynı state ikinci kez kullanılamaz. Başarısız deneme IP'siyle yazılır.
        var denied = await BeginAsync(email);
        AssertError(await CallbackAsync($"error=access_denied&state={Uri.EscapeDataString(denied.State)}", forwardedFor: "203.0.113.7"), "denied");
        var deniedEntry = Assert.Single(await AuditAsync(s.Owner, s.Org.Id, "sso.login_failed"));
        Assert.Equal(("denied", "203.0.113.7"), (deniedEntry.Data["reason"], deniedEntry.IpAddress));
        AssertError(await CallbackAsync(denied.Callback(Idp.Authorize(denied.Url, identity))), "expired");

        var failed = await BeginAsync(email);
        AssertError(await CallbackAsync($"error=server_error&state={Uri.EscapeDataString(failed.State)}"), "provider_error");

        // Sağlayıcının vermediği kod: token adresi reddeder.
        var forged = await BeginAsync(email);
        AssertError(await CallbackAsync(forged.Callback("uydurma")), "invalid_response");

        // Başarılı dönüş tekrar oynatılamaz (aynı anda gelen iki dönüşten yalnızca biri geçer).
        var flow = await BeginAsync(email);
        var query = flow.Callback(Idp.Authorize(flow.Url, identity));
        var both = await Task.WhenAll(CallbackAsync(query), CallbackAsync(query));
        Assert.Single(both, l => Param(l, "code") is not null);
        AssertError(Assert.Single(both, l => Param(l, "code") is null), "expired");
        AssertError(await CallbackAsync(query), "expired");

        // Süresi dolmuş giriş denemesi.
        var late = await BeginAsync(email);
        await ExpireAsync(state: late.State);
        AssertError(await CallbackAsync(late.Callback(Idp.Authorize(late.Url, identity))), "expired");

        // Yalnızca organizasyona bağlanabilen denemeler yazılır: red, sağlayıcı hatası, uydurma kod.
        Assert.Equal(
            ["denied", "invalid_response", "provider_error"],
            (await AuditAsync(s.Owner, s.Org.Id, "sso.login_failed")).Select(e => e.Data["reason"]).Order());
    }

    [Fact]
    public async Task LoginCode_IsRejected_WhenUserIsLockedOrDeletedMeanwhile()
    {
        var s = await SsoOrgAsync();
        var email = $"kisi@{s.Domain}";
        var identity = new FakeOidcIdentity("sub-1", email);
        var userId = (await SsoLoginAsync(email, identity)).Auth.User.Id;

        async Task SetUserAsync(DateTimeOffset? lockoutEnd, DateTimeOffset? deletedAt)
        {
            using var scope = Factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Users.Where(u => u.Id == userId).ExecuteUpdateAsync(u => u
                .SetProperty(x => x.LockoutEnabled, true)
                .SetProperty(x => x.LockoutEnd, lockoutEnd)
                .SetProperty(x => x.DeletedAt, deletedAt));
        }

        // Kod verildikten sonra hesap kilitlenir ya da silinirse kod oturuma çevrilemez.
        var (locked, lockedVerifier) = await SignInAtIdpAsync(email, identity);
        await SetUserAsync(DateTimeOffset.UtcNow.AddHours(1), null);
        var response = await ExchangeAsync(LoginCode(locked), lockedVerifier);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Contains("sso.invalid_code", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        await SetUserAsync(null, null);
        var (deleted, deletedVerifier) = await SignInAtIdpAsync(email, identity);
        await SetUserAsync(null, DateTimeOffset.UtcNow);
        Assert.Equal(HttpStatusCode.Unauthorized, (await ExchangeAsync(LoginCode(deleted), deletedVerifier)).StatusCode);
    }

    [Fact]
    public async Task LoginCode_RequiresStartersVerifier_IsSingleUse_AndExpires()
    {
        var s = await SsoOrgAsync();
        var email = $"kisi@{s.Domain}";
        var identity = new FakeOidcIdentity("sub-1", email);

        var badChallenge = await StartAsync(email, challenge: "kisa");
        Assert.Equal(HttpStatusCode.BadRequest, badChallenge.StatusCode);
        Assert.Contains("sso.code_challenge", await badChallenge.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        // Kodu ele geçiren (ör. adres çubuğundan) ama verifier'ı bilmeyen oturum açamaz; deneme kodu yakar.
        var (stolen, verifier) = await SignInAtIdpAsync(email, identity);
        Assert.Equal(HttpStatusCode.Unauthorized, (await ExchangeAsync(LoginCode(stolen), NewVerifier())).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await ExchangeAsync(LoginCode(stolen), verifier)).StatusCode);

        var (expired, expiredVerifier) = await SignInAtIdpAsync(email, identity);
        await ExpireAsync(loginCode: LoginCode(expired));
        var response = await ExchangeAsync(LoginCode(expired), expiredVerifier);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Contains("sso.invalid_code", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        var (location, rightVerifier) = await SignInAtIdpAsync(email, identity);
        var code = LoginCode(location);
        var results = await Task.WhenAll(ExchangeAsync(code, rightVerifier), ExchangeAsync(code, rightVerifier));
        Assert.Equal([HttpStatusCode.OK, HttpStatusCode.Unauthorized], results.Select(r => r.StatusCode).Order());

        Assert.Equal(HttpStatusCode.Unauthorized, (await ExchangeAsync("uydurma-kod", rightVerifier)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await ExchangeAsync(string.Empty, rightVerifier)).StatusCode);

        // Verifier uzunluğu RFC 7636'ya uymuyorsa (43-128) aynı hata döner.
        var (lengthCase, _) = await SignInAtIdpAsync(email, identity);
        foreach (var malformed in new[] { new string('a', 42), new string('a', 129), string.Empty })
        {
            var invalid = await ExchangeAsync(LoginCode(lengthCase), malformed);
            Assert.Equal(HttpStatusCode.Unauthorized, invalid.StatusCode);
            Assert.Contains("sso.invalid_code", await invalid.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task Desktop_ReturnsToLoopbackAgent_WithItsState()
    {
        var s = await SsoOrgAsync();
        var email = $"masaustu@{s.Domain}";
        var identity = new FakeOidcIdentity("sub-masaustu", email);

        foreach (var agent in new[] { "http://127.0.0.1:53682/callback", "http://localhost:41000/" })
        {
            var flow = await BeginAsync(email, agent, "ajan-durumu");
            Assert.Equal(RedirectUri, Param(flow.Url, "redirect_uri")); // sağlayıcıya her zaman sunucunun adresi verilir
            var location = await CallbackAsync(flow.Callback(Idp.Authorize(flow.Url, identity)));
            Assert.StartsWith(agent + "?", location.ToString(), StringComparison.Ordinal);
            Assert.Equal("ajan-durumu", Param(location, "state"));
            Assert.Null(Param(location, "error"));
            Assert.Equal(HttpStatusCode.OK, (await ExchangeAsync(Param(location, "code")!, flow.Verifier)).StatusCode);
        }

        // Hata da ajana döner.
        var cancelled = await BeginAsync(email, "http://127.0.0.1:53682/callback", "ajan-durumu");
        var back = await CallbackAsync($"error=access_denied&state={Uri.EscapeDataString(cancelled.State)}");
        Assert.StartsWith("http://127.0.0.1:53682/callback?", back.ToString(), StringComparison.Ordinal);
        Assert.Equal(("sso_denied", "ajan-durumu"), (Param(back, "error"), Param(back, "state")));

        var rejected = new[]
        {
            "https://saldirgan.example/cb", "http://saldirgan.example/cb", "http://192.168.1.5:8080/cb", "https://127.0.0.1:53682/cb",
            "http://127.0.0.1.saldirgan.example/cb", "http://127.0.0.1:53682/cb?x=1", "http://127.0.0.1:53682/cb#x", "javascript:alert(1)", "/goreli",
        };
        foreach (var returnUrl in rejected)
        {
            var response = await StartAsync(email, returnUrl, "ajan-durumu");
            Assert.True(response.StatusCode == HttpStatusCode.BadRequest, $"{returnUrl}: {(int)response.StatusCode}");
        }
    }
}
