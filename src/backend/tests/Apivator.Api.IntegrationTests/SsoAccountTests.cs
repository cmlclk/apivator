using System.Net;
using System.Net.Http.Json;
using Apivator.Api.IntegrationTests.Fixtures;
using Apivator.Application.Account;
using Apivator.Application.ApiKeys;
using Apivator.Application.Auth;
using Apivator.Application.Sso;
using Apivator.Application.Teams;
using Apivator.Application.Workspaces;
using Apivator.Domain.Organizations;
using Apivator.Infrastructure.Identity;

namespace Apivator.Api.IntegrationTests;

/// <summary>SSO kimliğinin hesaplarla eşlenmesi, otomatik ekleme, zorunlu SSO ve 2FA muafiyeti.</summary>
[Collection(ApiCollection.Name)]
public class SsoAccountTests(ApivatorApiFactory factory) : SsoTestBase(factory)
{
    private Task<HttpResponseMessage> PasswordLoginAsync(string email) =>
        Factory.CreateClient().PostAsJsonAsync("/api/auth/login", new LoginRequest(email, TestHelpers.Password));

    private Task<HttpResponseMessage> RefreshAsync(string refreshToken) =>
        Factory.CreateClient().PostAsJsonAsync("/api/auth/refresh", new RefreshRequest(refreshToken));

    /// <summary>E-postadaki SSO bağlama bağlantısını onaylar (oturum açmaz).</summary>
    private async Task<string> ConfirmLinkAsync(string email)
    {
        var mail = Factory.Emails.LastTo(email);
        Assert.Contains($"{PublicUrl}/sso/link?token=", mail.TextBody, StringComparison.Ordinal);
        var token = TestHelpers.QueryValue(mail.TextBody, "token");
        Assert.Equal(HttpStatusCode.NoContent, (await Factory.CreateClient().PostAsJsonAsync("/api/auth/sso/link", new SsoLinkConfirmRequest(token))).StatusCode);
        return token;
    }

    [Fact]
    public async Task ConfirmedAccount_IsLinkedOnlyAfterEmailConfirmation_ThenMatchedBySubject()
    {
        User? ali = null;
        var s = await SsoOrgAsync(beforeEnable: async org =>
        {
            ali = await UserAsync($"ali@{org.Domain}", "Ali");
            await ConfirmEmailAsync(ali);
        });

        // IdP'nin e-posta claim'ine güvenilerek doğrudan girilmez; hesabın sahibine onay bağlantısı gider.
        await AssertFailsAsync(ali!.Email, new FakeOidcIdentity("sub-ali", ali.Email, "Ali IdP"), "link_sent");
        Assert.Contains("SSO", Factory.Emails.LastTo(ali.Email).Subject, StringComparison.Ordinal);
        Assert.DoesNotContain((await ali.Client.GetFromJsonAsync<List<OrganizationDto>>("/api/organizations"))!, o => o.Id == s.Org.Id);

        // Yeni bağlama isteği bekleyeni geçersiz kılar.
        var first = TestHelpers.QueryValue(Factory.Emails.LastTo(ali.Email).TextBody, "token");
        await AssertFailsAsync(ali.Email, new FakeOidcIdentity("sub-ali", ali.Email, "Ali IdP"), "link_sent");
        var token = TestHelpers.QueryValue(Factory.Emails.LastTo(ali.Email).TextBody, "token");
        Assert.NotEqual(first, token);
        Assert.Equal(HttpStatusCode.BadRequest, (await Factory.CreateClient().PostAsJsonAsync("/api/auth/sso/link", new SsoLinkConfirmRequest(first))).StatusCode);

        // Bağlantıyı başka biri (oturumu açık başka bir kullanıcı) kullansa da yalnızca e-postanın sahibi bağlanır;
        // yanıt oturum vermez (token ya da cookie yok).
        var other = await UserAsync(name: "Başkası");
        var confirm = await other.Client.PostAsJsonAsync("/api/auth/sso/link", new SsoLinkConfirmRequest(token));
        Assert.Equal(HttpStatusCode.NoContent, confirm.StatusCode);
        Assert.False(confirm.Headers.Contains("Set-Cookie"));
        Assert.Empty(await confirm.Content.ReadAsStringAsync());
        Assert.DoesNotContain((await other.Client.GetFromJsonAsync<List<OrganizationDto>>("/api/organizations"))!, o => o.Id == s.Org.Id);

        // Bağlantı tekrar kullanılamaz.
        var reused = await Factory.CreateClient().PostAsJsonAsync("/api/auth/sso/link", new SsoLinkConfirmRequest(token));
        Assert.Equal(HttpStatusCode.BadRequest, reused.StatusCode);
        Assert.Contains("sso.invalid_link", await reused.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        Assert.Contains((await ali.Client.GetFromJsonAsync<List<OrganizationDto>>("/api/organizations"))!, o => o.Id == s.Org.Id && o.Role == OrganizationRole.Member);

        // Bağlandıktan sonra aynı kişi (sub) doğrudan girer, adresi değişse de...
        Assert.Equal(ali.Id, (await SsoLoginAsync(ali.Email, new FakeOidcIdentity("sub-ali", ali.Email))).Auth.User.Id);
        Assert.Equal(ali.Id, (await SsoLoginAsync(ali.Email, new FakeOidcIdentity("sub-ali", $"ali.yilmaz@{s.Domain}"))).Auth.User.Id);

        // ...ama doğrulanmış alan adı dışındaki bir adresle asla.
        await AssertFailsAsync(ali.Email, new FakeOidcIdentity("sub-ali", "ali@baska-alan.example"), "domain_mismatch");

        // Başka bir IdP kimliği aynı adresi gösterse de hesaba bağlanmadan girmez.
        await AssertFailsAsync(ali.Email, new FakeOidcIdentity("baska-sub", ali.Email), "link_sent");

        // SSO zorunlu değilken şifre de çalışmaya devam eder; hiç hesap açılmadı.
        Assert.Equal(HttpStatusCode.OK, (await PasswordLoginAsync(ali.Email)).StatusCode);
        var actions = (await AuditAsync(s.Owner, s.Org.Id)).Select(e => e.Action).ToList();
        Assert.Equal(3, actions.Count(a => a == "sso.link_requested"));
        Assert.Single(actions, "sso.account_linked");
        Assert.DoesNotContain("sso.user_provisioned", actions);
    }

    [Fact]
    public async Task ExpiredLinkToken_IsRejected_AndConsumed()
    {
        User? veli = null;
        var s = await SsoOrgAsync(beforeEnable: async org =>
        {
            veli = await UserAsync($"veli@{org.Domain}", "Veli");
            await ConfirmEmailAsync(veli);
        });

        await AssertFailsAsync(veli!.Email, new FakeOidcIdentity("sub-veli", veli.Email), "link_sent");
        var token = TestHelpers.QueryValue(Factory.Emails.LastTo(veli.Email).TextBody, "token");
        await ExpireAsync(linkToken: token);

        var expired = await Factory.CreateClient().PostAsJsonAsync("/api/auth/sso/link", new SsoLinkConfirmRequest(token));
        Assert.Equal(HttpStatusCode.BadRequest, expired.StatusCode);
        Assert.Contains("sso.invalid_link", await expired.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        Assert.False(await LinkRequestExistsAsync(token));

        // Bağlanmadı: aynı kimlik yeniden onay ister, hesap organizasyona eklenmedi.
        await AssertFailsAsync(veli.Email, new FakeOidcIdentity("sub-veli", veli.Email), "link_sent");
        Assert.DoesNotContain((await veli.Client.GetFromJsonAsync<List<OrganizationDto>>("/api/organizations"))!, o => o.Id == s.Org.Id);
        Assert.Empty(await AuditAsync(s.Owner, s.Org.Id, "sso.account_linked"));
    }

    [Fact]
    public async Task UnconfirmedAccount_IsRetired_AndANewAccountIsCreated()
    {
        User? squatter = null;
        AuthResult? squatterSession = null;
        string? squatterKey = null;
        var s = await SsoOrgAsync(beforeEnable: async org =>
        {
            // Biri bu adresle önceden (doğrulamadan) kayıt olmuş ve hesabı hazırlamış olabilir.
            var client = Factory.CreateClient();
            var email = $"ceo@{org.Domain}";
            squatterSession = await client.RegisterAsync(email, "Sahte CEO");
            squatter = new User(client.WithBearer(squatterSession.AccessToken), squatterSession.User.Id, email);
            squatterKey = (await (await client.PostAsJsonAsync("/api/me/api-keys", new CreateApiKeyRequest("Arka kapı"))).ReadAsync<CreatedApiKeyDto>()).Secret;
        });
        var squatterWorkspaces = (await squatter!.Client.GetFromJsonAsync<List<WorkspaceDto>>("/api/workspaces"))!.Select(w => w.Id).ToList();

        var (client, auth) = await SsoLoginAsync(squatter.Email, new FakeOidcIdentity("sub-ceo", squatter.Email, "Gerçek CEO"));
        Assert.NotEqual(squatter.Id, auth.User.Id);
        Assert.Equal((squatter.Email, "Gerçek CEO", true), (auth.User.Email, auth.User.DisplayName, auth.User.EmailConfirmed));
        var workspaces = (await client.GetFromJsonAsync<List<WorkspaceDto>>("/api/workspaces"))!;
        Assert.Empty(workspaces.Select(w => w.Id).Intersect(squatterWorkspaces));
        Assert.Contains((await client.GetFromJsonAsync<List<OrganizationDto>>("/api/organizations"))!, o => o.Id == s.Org.Id);

        // Hesabı açan kişinin şifresi ve oturumu artık geçmez.
        Assert.Equal(HttpStatusCode.Unauthorized, (await PasswordLoginAsync(squatter.Email)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await RefreshAsync(squatterSession!.RefreshToken)).StatusCode);

        // Elinde kalan API anahtarı ve süresi dolmamış access token da bir sonraki istekte geçmez.
        var keyClient = Factory.CreateClient();
        keyClient.DefaultRequestHeaders.Add("X-Api-Key", squatterKey);
        Assert.Equal(HttpStatusCode.Unauthorized, (await keyClient.GetAsync("/api/workspaces")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await squatter.Client.GetAsync("/api/workspaces")).StatusCode);

        var retired = Assert.Single(await AuditAsync(s.Owner, s.Org.Id, "sso.unverified_account_retired"));
        Assert.Equal(squatter.Id, retired.TargetId);
        Assert.Single(await AuditAsync(s.Owner, s.Org.Id, "sso.user_provisioned"));
    }

    [Fact]
    public async Task WithoutAutoProvision_OnlyExistingMembersCanSignIn()
    {
        User? member = null, stranger = null;
        var s = await SsoOrgAsync(autoProvision: false, beforeEnable: async org =>
        {
            member = await UserAsync($"uye@{org.Domain}", "Üye");
            await ConfirmEmailAsync(member);
            await MemberAsync(org.Owner, org.Org.Id, member);
            stranger = await UserAsync($"yabanci@{org.Domain}", "Yabancı"); // doğrulanmamış
        });

        var unknown = $"hic.gelmedi@{s.Domain}";
        await AssertFailsAsync(unknown, new FakeOidcIdentity("sub-yok", unknown), "not_member");

        // Doğrulanmamış hesap otomatik açma kapalıyken emekliye ayrılmaz; olduğu gibi kalır.
        await AssertFailsAsync(stranger!.Email, new FakeOidcIdentity("sub-yabanci", stranger.Email), "not_member");
        Assert.Equal(HttpStatusCode.OK, (await PasswordLoginAsync(stranger.Email)).StatusCode);
        Assert.DoesNotContain((await stranger.Client.GetFromJsonAsync<List<OrganizationDto>>("/api/organizations"))!, o => o.Id == s.Org.Id);

        // Üye, bağlamayı onayladıktan sonra girer.
        await AssertFailsAsync(member!.Email, new FakeOidcIdentity("sub-uye", member.Email), "link_sent");
        await ConfirmLinkAsync(member.Email);
        Assert.Equal(member.Id, (await SsoLoginAsync(member.Email, new FakeOidcIdentity("sub-uye", member.Email))).Auth.User.Id);

        Assert.Empty(await AuditAsync(s.Owner, s.Org.Id, "sso.user_provisioned"));
        Assert.Empty(await AuditAsync(s.Owner, s.Org.Id, "sso.unverified_account_retired"));
        Assert.Equal(2, (await AuditAsync(s.Owner, s.Org.Id, "sso.login_failed")).Count(e => e.Data["reason"] == "not_member"));

        // SSO açıkken (zorunlu olmasa da) bu alan adında şifreyle yeni hesap açılamaz.
        var register = await Factory.CreateClient().PostAsJsonAsync("/api/auth/register", new RegisterRequest(unknown, TestHelpers.Password, "Yeni"));
        Assert.Equal(HttpStatusCode.Forbidden, register.StatusCode);
        Assert.Contains("auth.sso_required", await register.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task EnforcedSso_BlocksPasswordLoginAndRegistration_ExceptForOwner()
    {
        User? member = null;
        AuthResult? memberSession = null;
        var outsider = await UserAsync(name: "Başka Alan");
        var outsiderSession = await (await PasswordLoginAsync(outsider.Email)).ReadAsync<AuthResult>();
        var s = await SsoOrgAsync(beforeEnable: async org =>
        {
            member = await UserAsync($"uye@{org.Domain}", "Üye");
            memberSession = await (await PasswordLoginAsync(member.Email)).ReadAsync<AuthResult>();
        });
        var ownerRefresh = await (await PasswordLoginAsync(s.Owner.Email)).ReadAsync<AuthResult>();

        // Zorunlu kılınınca alan adındaki (sahip dışı) hesapların oturumları kapanır.
        await (await SetStateAsync(s.Owner, s.Org.Id, true, enforced: true)).ReadAsync<SsoSettingsDto>();
        Assert.Equal(HttpStatusCode.Unauthorized, (await RefreshAsync(memberSession!.RefreshToken)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await RefreshAsync(ownerRefresh.RefreshToken)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await RefreshAsync(outsiderSession.RefreshToken)).StatusCode);
        var enforced = Assert.Single(await AuditAsync(s.Owner, s.Org.Id, "sso.enforced"));
        Assert.NotEqual("0", enforced.Data["sessions_revoked"]);

        var login = await PasswordLoginAsync(member!.Email.ToUpperInvariant());
        Assert.Equal(HttpStatusCode.Forbidden, login.StatusCode);
        Assert.Contains("auth.sso_required", await login.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        var register = await Factory.CreateClient().PostAsJsonAsync("/api/auth/register", new RegisterRequest($"yeni@{s.Domain}", TestHelpers.Password, "Yeni"));
        Assert.Equal(HttpStatusCode.Forbidden, register.StatusCode);

        // Acil durum: sahip şifreyle girebilir. Başka alan adındakiler etkilenmez.
        Assert.Equal(HttpStatusCode.OK, (await PasswordLoginAsync(s.Owner.Email)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await PasswordLoginAsync(outsider.Email)).StatusCode);

        // SSO'yla gelen kişi adresini başka alan adına çekip şifreyle girmeye geçemez.
        var email = $"sso.kisi@{s.Domain}";
        var (ssoClient, _) = await SsoLoginAsync(email, new FakeOidcIdentity("sub-sso", email));
        var change = await ssoClient.PostAsJsonAsync("/api/me/email", new ChangeEmailRequest("kacak@baska.example", TestHelpers.Password));
        Assert.Equal(HttpStatusCode.Forbidden, change.StatusCode);
        Assert.Contains("account.sso_managed", await change.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        // Zorunluluk kalkınca şifre yeniden çalışır.
        await (await SetStateAsync(s.Owner, s.Org.Id, true, enforced: false)).ReadAsync<SsoSettingsDto>();
        Assert.Equal(HttpStatusCode.OK, (await PasswordLoginAsync(member.Email)).StatusCode);
    }

    [Fact]
    public async Task OrganizationTwoFactorRequirement_IsDelegatedToIdp_ForEnforcedDomainMembers()
    {
        User? passwordMember = null;
        var s = await SsoOrgAsync(enforced: true, defaultRole: OrganizationRole.Admin, beforeEnable: async org =>
        {
            passwordMember = await UserAsync(name: "Şifreli Üye"); // başka alan adında
            await MemberAsync(org.Owner, org.Org.Id, passwordMember, workspaceId: org.General.Id);
        });
        var email = $"sso.uye@{s.Domain}";
        var (ssoClient, _) = await SsoLoginAsync(email, new FakeOidcIdentity("sub-sso-uye", email));

        // Sahip önce kendi 2FA'sını açar, sonra organizasyonda zorunlu kılar.
        var setup = await (await s.Owner.Client.PostAsync("/api/me/2fa/setup", null)).ReadAsync<TwoFactorSetupDto>();
        var code = Totp.Code(setup.Secret, Totp.Step(DateTimeOffset.UtcNow) - 1);
        await (await s.Owner.Client.PostAsJsonAsync("/api/me/2fa/enable", new TwoFactorCodeRequest(code))).ReadAsync<RecoveryCodesDto>();
        (await s.Owner.Client.PutAsJsonAsync($"/api/organizations/{s.Org.Id}/security", new OrganizationSecurityRequest(true))).EnsureSuccessStatusCode();

        // 2FA'sı olmayan şifreli üye workspace'i göremez; SSO zorunlu alan adındaki üyenin 2FA'sı kimlik sağlayıcıdadır.
        Assert.DoesNotContain((await passwordMember!.Client.GetFromJsonAsync<List<WorkspaceDto>>("/api/workspaces"))!, w => w.Id == s.General.Id);
        Assert.Contains((await ssoClient.GetFromJsonAsync<List<WorkspaceDto>>("/api/workspaces"))!, w => w.Id == s.General.Id);
        Assert.Equal(HttpStatusCode.OK, (await ssoClient.GetAsync($"/api/workspaces/{s.General.Id}/collections")).StatusCode);

        // SSO zorunlu değilse muafiyet de yok (kişi şifre sıfırlayıp şifreyle de girebilir).
        await (await SetStateAsync(s.Owner, s.Org.Id, true, enforced: false)).ReadAsync<SsoSettingsDto>();
        Assert.DoesNotContain((await ssoClient.GetFromJsonAsync<List<WorkspaceDto>>("/api/workspaces"))!, w => w.Id == s.General.Id);
    }
}
