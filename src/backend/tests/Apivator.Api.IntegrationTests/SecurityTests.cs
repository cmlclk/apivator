using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Apivator.Application.Account;
using Apivator.Application.Auth;
using Apivator.Application.Teams;
using Apivator.Application.Workspaces;
using Apivator.Domain.Organizations;
using Apivator.Infrastructure.Identity;

namespace Apivator.Api.IntegrationTests;

/// <summary>RFC 6238 test vektörleri (SHA-1, 6 hane).</summary>
public class TotpTests
{
    private const string Rfc6238Secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // "12345678901234567890"

    [Theory]
    [InlineData(59, "287082")]
    [InlineData(1111111109, "081804")]
    [InlineData(1234567890, "005924")]
    [InlineData(2000000000, "279037")]
    public void MatchesRfcVectors(long unixSeconds, string code) =>
        Assert.Equal(code, Totp.Code(Rfc6238Secret, Totp.Step(DateTimeOffset.FromUnixTimeSeconds(unixSeconds))));

    [Fact]
    public void AcceptsNeighbouringSteps_RejectsReuse()
    {
        var now = DateTimeOffset.FromUnixTimeSeconds(1234567890);
        var step = Totp.Step(now);
        Assert.Equal(step, Totp.Verify(Rfc6238Secret, "005 924", now, null));
        Assert.Equal(step - 1, Totp.Verify(Rfc6238Secret, Totp.Code(Rfc6238Secret, step - 1), now, null));
        Assert.Null(Totp.Verify(Rfc6238Secret, Totp.Code(Rfc6238Secret, step - 2), now, null));
        Assert.Null(Totp.Verify(Rfc6238Secret, "005924", now, lastUsedStep: step)); // aynı kod ikinci kez
        Assert.Null(Totp.Verify(Rfc6238Secret, "12345", now, null));
        Assert.Equal("JBSWY3DPEHPK3PXP", Totp.Base32Encode(Totp.Base32Decode("jbsw y3dp ehpk 3pxp")));
    }
}

[Collection(ApiCollection.Name)]
public class SecurityTests(ApivatorApiFactory factory)
{
    private sealed record User(HttpClient Client, Guid Id, string Email, string Name, AuthResult Auth);

    private async Task<User> UserAsync(string name = "Test Kullanıcı", string userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36")
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.UserAgent.ParseAdd(userAgent);
        var email = TestHelpers.NewEmail();
        var auth = await client.RegisterAsync(email, name);
        client.WithBearer(auth.AccessToken);
        return new User(client, auth.User.Id, email, name, auth);
    }

    private static Task<HttpResponseMessage> LoginAsync(HttpClient client, string email) =>
        client.PostAsJsonAsync("/api/auth/login", new LoginRequest(email, TestHelpers.Password));

    /// <summary>Zaman adımının sonuna yakınsa bir sonrakini bekler; testte kullanılan komşu adımlar geçerli kalsın.</summary>
    private static async Task FreshStepAsync()
    {
        var into = DateTimeOffset.UtcNow.ToUnixTimeSeconds() % Totp.PeriodSeconds;
        if (into > 18)
        {
            await Task.Delay(TimeSpan.FromSeconds(Totp.PeriodSeconds - into + 1));
        }
    }

    private static string CodeAt(string secret, int offset) => Totp.Code(secret, Totp.Step(DateTimeOffset.UtcNow) + offset);

    /// <summary>2FA'yı açar; gizli anahtarı ve yedek kodları döner. Kurulumda bir önceki adımın kodu kullanılır.</summary>
    private static async Task<(string Secret, IReadOnlyList<string> Codes)> EnableAsync(User user)
    {
        var setup = await (await user.Client.PostAsync("/api/me/2fa/setup", null)).ReadAsync<TwoFactorSetupDto>();
        var codes = await (await user.Client.PostAsJsonAsync("/api/me/2fa/enable", new TwoFactorCodeRequest(CodeAt(setup.Secret, -1)))).ReadAsync<RecoveryCodesDto>();
        return (setup.Secret, codes.Codes);
    }

    private static async Task<List<SecurityEventKind>> EventsAsync(User user) =>
        (await user.Client.GetFromJsonAsync<List<SecurityEventDto>>("/api/me/security-events"))!.Select(e => e.Kind).ToList();

    [Fact]
    public async Task TwoFactor_SetupLoginRecoveryAndDisable()
    {
        await FreshStepAsync();
        var user = await UserAsync("Ayşe");

        var setup = await (await user.Client.PostAsync("/api/me/2fa/setup", null)).ReadAsync<TwoFactorSetupDto>();
        Assert.Equal(32, setup.Secret.Length);
        Assert.StartsWith($"otpauth://totp/Apivator:{Uri.EscapeDataString(user.Email)}?secret={setup.Secret}&issuer=Apivator", setup.OtpAuthUri, StringComparison.Ordinal);

        var wrong = await user.Client.PostAsJsonAsync("/api/me/2fa/enable", new TwoFactorCodeRequest("000000"));
        Assert.Equal(HttpStatusCode.BadRequest, wrong.StatusCode);

        var codes = await (await user.Client.PostAsJsonAsync("/api/me/2fa/enable", new TwoFactorCodeRequest(CodeAt(setup.Secret, -1)))).ReadAsync<RecoveryCodesDto>();
        Assert.Equal(10, codes.Codes.Count);
        Assert.All(codes.Codes, c => Assert.Matches("^[a-z2-9]{5}-[a-z2-9]{5}$", c));
        Assert.Contains("iki adımlı doğrulama açıldı", factory.Emails.LastTo(user.Email).Subject, StringComparison.Ordinal);

        var status = await user.Client.GetFromJsonAsync<TwoFactorStatusDto>("/api/me/2fa");
        Assert.Equal((true, 10), (status!.Enabled, status.RecoveryCodesLeft));
        Assert.True((await user.Client.GetFromJsonAsync<UserDto>("/api/me"))!.TwoFactorEnabled);

        // Giriş: şifre doğruysa oturum yerine ikinci adım.
        var anonymous = factory.CreateClient();
        var first = await (await LoginAsync(anonymous, user.Email)).ReadAsync<JsonElement>();
        Assert.True(first.GetProperty("twoFactorRequired").GetBoolean());
        Assert.False(first.TryGetProperty("accessToken", out _));
        var challenge = first.GetProperty("challengeToken").GetString()!;

        // Kurulumda kullanılan kod tekrar kullanılamaz; bozuk belirteç reddedilir.
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsJsonAsync("/api/auth/login/2fa", new TwoFactorLoginRequest(challenge, CodeAt(setup.Secret, -1)))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsJsonAsync("/api/auth/login/2fa", new TwoFactorLoginRequest(challenge + "x", CodeAt(setup.Secret, 0)))).StatusCode);

        var session = await (await anonymous.PostAsJsonAsync("/api/auth/login/2fa", new TwoFactorLoginRequest(challenge, CodeAt(setup.Secret, 0)))).ReadAsync<AuthResult>();
        Assert.Equal(user.Id, session.User.Id);

        // Yedek kod bir kez çalışır.
        var second = (await (await LoginAsync(anonymous, user.Email)).ReadAsync<TwoFactorChallengeDto>()).ChallengeToken;
        await (await anonymous.PostAsJsonAsync("/api/auth/login/2fa", new TwoFactorLoginRequest(second, codes.Codes[0].ToUpperInvariant()))).ReadAsync<AuthResult>();
        var third = (await (await LoginAsync(anonymous, user.Email)).ReadAsync<TwoFactorChallengeDto>()).ChallengeToken;
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsJsonAsync("/api/auth/login/2fa", new TwoFactorLoginRequest(third, codes.Codes[0]))).StatusCode);

        // Yedek kodları yenileme güncel authenticator kodu ister.
        var renewed = await (await user.Client.PostAsJsonAsync("/api/me/2fa/recovery-codes", new TwoFactorCodeRequest(CodeAt(setup.Secret, 1)))).ReadAsync<RecoveryCodesDto>();
        Assert.DoesNotContain(codes.Codes[1], renewed.Codes);

        // Kapatma: şifre + kod (yedek kod da olur).
        var badPassword = await user.Client.PostAsJsonAsync("/api/me/2fa/disable", new DisableTwoFactorRequest("yanlis-sifre1", renewed.Codes[0]));
        Assert.Equal(HttpStatusCode.BadRequest, badPassword.StatusCode);
        (await user.Client.PostAsJsonAsync("/api/me/2fa/disable", new DisableTwoFactorRequest(TestHelpers.Password, renewed.Codes[0]))).EnsureSuccessStatusCode();
        Assert.False((await user.Client.GetFromJsonAsync<TwoFactorStatusDto>("/api/me/2fa"))!.Enabled);
        await (await LoginAsync(anonymous, user.Email)).ReadAsync<AuthResult>();

        var events = await EventsAsync(user);
        Assert.Equal(SecurityEventKind.LoginSucceeded, events[0]);
        Assert.Contains(SecurityEventKind.TwoFactorEnabled, events);
        Assert.Contains(SecurityEventKind.TwoFactorDisabled, events);
        Assert.Contains(SecurityEventKind.RecoveryCodeUsed, events);
        Assert.Contains(SecurityEventKind.RecoveryCodesRegenerated, events);
        Assert.Contains(SecurityEventKind.LoginFailed, events);
    }

    [Fact]
    public async Task NewDevice_SendsAlert_AndFailuresAreRecorded()
    {
        var user = await UserAsync("Mert");
        var sameDevice = factory.CreateClient();
        sameDevice.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0 Safari/537.36");
        await (await LoginAsync(sameDevice, user.Email)).ReadAsync<AuthResult>();
        Assert.DoesNotContain(factory.Emails.Sent, m => m.To == user.Email && m.Subject.Contains("yeni bir cihazdan", StringComparison.Ordinal));

        var phone = factory.CreateClient();
        phone.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0");
        await (await LoginAsync(phone, user.Email)).ReadAsync<AuthResult>();
        var alert = factory.Emails.LastTo(user.Email);
        Assert.Contains("yeni bir cihazdan", alert.Subject, StringComparison.Ordinal);
        Assert.Contains("Firefox · Linux", alert.TextBody, StringComparison.Ordinal);
        var alerts = factory.Emails.Sent.Count(m => m.To == user.Email && m.Subject.Contains("yeni bir cihazdan", StringComparison.Ordinal));
        await (await LoginAsync(phone, user.Email)).ReadAsync<AuthResult>();
        Assert.Equal(alerts, factory.Emails.Sent.Count(m => m.To == user.Email && m.Subject.Contains("yeni bir cihazdan", StringComparison.Ordinal)));

        // Hatalı denemeler ve kilitlenme.
        for (var i = 0; i < 5; i++)
        {
            await phone.PostAsJsonAsync("/api/auth/login", new LoginRequest(user.Email, "Yanlis1234"));
        }

        var events = (await user.Client.GetFromJsonAsync<List<SecurityEventDto>>("/api/me/security-events"))!;
        Assert.Equal(SecurityEventKind.LockedOut, events[0].Kind);
        Assert.Equal(4, events.Count(e => e.Kind == SecurityEventKind.LoginFailed));
        Assert.Equal("Firefox · Linux", events[0].Device);
        Assert.Equal(HttpStatusCode.Locked, (await LoginAsync(phone, user.Email)).StatusCode);
    }

    [Fact]
    public async Task Organization_RequiresTwoFactor()
    {
        await FreshStepAsync();
        var owner = await UserAsync("Sahip");
        var org = await (await owner.Client.PostAsJsonAsync("/api/organizations", new CreateOrganizationRequest("Güvenli A.Ş."))).ReadAsync<OrganizationDto>();
        var general = (await owner.Client.GetFromJsonAsync<List<WorkspaceDto>>("/api/workspaces"))!.Single(w => w.OrganizationId == org.Id);
        var member = await UserAsync("Üye");
        await (await owner.Client.PostAsJsonAsync($"/api/organizations/{org.Id}/invitations", new InviteRequest(member.Email, OrganizationRole.Member, general.Id, Apivator.Domain.Workspaces.WorkspaceRole.Editor))).ReadAsync<InvitationDto>();
        var token = TestHelpers.QueryValue(factory.Emails.LastTo(member.Email).TextBody, "token");
        await (await member.Client.PostAsJsonAsync("/api/invitations/accept", new AcceptInvitationRequest(token))).ReadAsync<AcceptedInvitationDto>();
        Assert.Contains((await member.Client.GetFromJsonAsync<List<WorkspaceDto>>("/api/workspaces"))!, w => w.Id == general.Id);

        // Yönetici önce kendi 2FA'sını açmalı.
        var tooEarly = await owner.Client.PutAsJsonAsync($"/api/organizations/{org.Id}/security", new OrganizationSecurityRequest(true));
        Assert.Equal(HttpStatusCode.BadRequest, tooEarly.StatusCode);
        Assert.Contains("2fa.admin_not_enabled", await tooEarly.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        await EnableAsync(owner);
        (await owner.Client.PutAsJsonAsync($"/api/organizations/{org.Id}/security", new OrganizationSecurityRequest(true))).EnsureSuccessStatusCode();
        Assert.True((await owner.Client.GetFromJsonAsync<List<OrganizationDto>>("/api/organizations"))!.Single(o => o.Id == org.Id).RequireTwoFactor);

        // 2FA'sı olmayan üye organizasyonun workspace'lerini göremez.
        var me = await member.Client.GetFromJsonAsync<UserDto>("/api/me");
        Assert.Equal(["Güvenli A.Ş."], me!.TwoFactorRequiredBy);
        Assert.DoesNotContain((await member.Client.GetFromJsonAsync<List<WorkspaceDto>>("/api/workspaces"))!, w => w.Id == general.Id);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync($"/api/workspaces/{general.Id}/collections")).StatusCode);

        // Yönetici üyelerin 2FA durumunu görür.
        var members = await owner.Client.GetFromJsonAsync<OrganizationMembersDto>($"/api/organizations/{org.Id}/members");
        Assert.Equal((true, false), (members!.Members.Single(m => m.UserId == owner.Id).TwoFactorEnabled, members.Members.Single(m => m.UserId == member.Id).TwoFactorEnabled));
        var asMember = await member.Client.GetFromJsonAsync<OrganizationMembersDto>($"/api/organizations/{org.Id}/members");
        Assert.All(asMember!.Members, m => Assert.Null(m.TwoFactorEnabled));

        // Üye 2FA'yı açınca erişir; zorunluyken kapatamaz.
        var (_, codes) = await EnableAsync(member);
        Assert.Contains((await member.Client.GetFromJsonAsync<List<WorkspaceDto>>("/api/workspaces"))!, w => w.Id == general.Id);
        var disable = await member.Client.PostAsJsonAsync("/api/me/2fa/disable", new DisableTwoFactorRequest(TestHelpers.Password, codes[0]));
        Assert.Equal(HttpStatusCode.BadRequest, disable.StatusCode);
        Assert.Contains("Güvenli A.Ş.", await disable.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        // Kişisel organizasyonda kullanılamaz.
        var personal = (await owner.Client.GetFromJsonAsync<List<OrganizationDto>>("/api/organizations"))!.Single(o => o.IsPersonal);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PutAsJsonAsync($"/api/organizations/{personal.Id}/security", new OrganizationSecurityRequest(true))).StatusCode);
    }

    [Fact]
    public async Task Admin_RevokesSessionsAndSendsPasswordReset()
    {
        var owner = await UserAsync("Yönetici Can");
        var org = await (await owner.Client.PostAsJsonAsync("/api/organizations", new CreateOrganizationRequest("Destek Ltd."))).ReadAsync<OrganizationDto>();
        var member = await UserAsync("Zeynep");
        await (await owner.Client.PostAsJsonAsync($"/api/organizations/{org.Id}/invitations", new InviteRequest(member.Email, OrganizationRole.Member, null, null))).ReadAsync<InvitationDto>();
        var token = TestHelpers.QueryValue(factory.Emails.LastTo(member.Email).TextBody, "token");
        await (await member.Client.PostAsJsonAsync("/api/invitations/accept", new AcceptInvitationRequest(token))).ReadAsync<AcceptedInvitationDto>();

        // Üye yönetici işlemi yapamaz; yönetici kendine uygulayamaz.
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.PostAsync($"/api/organizations/{org.Id}/members/{owner.Id}/revoke-sessions", null)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PostAsync($"/api/organizations/{org.Id}/members/{owner.Id}/revoke-sessions", null)).StatusCode);

        (await owner.Client.PostAsync($"/api/organizations/{org.Id}/members/{member.Id}/revoke-sessions", null)).EnsureSuccessStatusCode();
        var refresh = await factory.CreateClient().PostAsJsonAsync("/api/auth/refresh", new RefreshRequest(member.Auth.RefreshToken));
        Assert.Equal(HttpStatusCode.Unauthorized, refresh.StatusCode);
        Assert.Contains("oturumlarınız kapatıldı", factory.Emails.LastTo(member.Email).Subject, StringComparison.Ordinal);

        (await owner.Client.PostAsync($"/api/organizations/{org.Id}/members/{member.Id}/password-reset", null)).EnsureSuccessStatusCode();
        var mail = factory.Emails.LastTo(member.Email);
        Assert.Contains("Yönetici Can", mail.TextBody, StringComparison.Ordinal);
        var resetToken = TestHelpers.QueryValue(mail.TextBody, "token");
        (await factory.CreateClient().PostAsJsonAsync("/api/auth/reset-password", new ResetPasswordRequest(member.Email, resetToken, "YeniSifre123"))).EnsureSuccessStatusCode();

        var fresh = factory.CreateClient();
        var auth = await (await fresh.PostAsJsonAsync("/api/auth/login", new LoginRequest(member.Email, "YeniSifre123"))).ReadAsync<AuthResult>();
        fresh.WithBearer(auth.AccessToken);
        var events = (await fresh.GetFromJsonAsync<List<SecurityEventDto>>("/api/me/security-events"))!;
        var revoked = events.Single(e => e.Kind == SecurityEventKind.SessionsRevokedByAdmin);
        Assert.Equal(("Yönetici Can", "Destek Ltd.", null, null), (revoked.ActorName, revoked.Detail, revoked.Device, revoked.IpAddress));
        Assert.Contains(events, e => e.Kind == SecurityEventKind.PasswordResetSentByAdmin);
        Assert.Contains(events, e => e.Kind == SecurityEventKind.PasswordReset);
    }
}
