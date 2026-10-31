using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Apivator.Application.Abstractions;
using Apivator.Application.Account;
using Apivator.Application.Auth;
using Apivator.Application.Collections;
using Apivator.Application.Environments;
using Apivator.Application.Teams;
using Apivator.Application.Workspaces;
using Apivator.Domain.Organizations;
using Apivator.Domain.Workspaces;
using Microsoft.Extensions.DependencyInjection;

namespace Apivator.Api.IntegrationTests;

/// <summary>6.3 Hesap ve profil.</summary>
[Collection(ApiCollection.Name)]
public class AccountTests(ApivatorApiFactory factory)
{
    private const string ChromeWindows =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

    private const string FirefoxMac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0";

    private static readonly byte[] Png =
    [
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
        0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0xF8, 0xCF, 0xC0, 0xF0,
        0x1F, 0x00, 0x05, 0x00, 0x01, 0xFF, 0x89, 0x99, 0x3D, 0x1D, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
        0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];

    private sealed record User(HttpClient Client, Guid Id, string Email, Guid PersonalWorkspaceId, AuthResult Auth);

    private async Task<User> UserAsync(string name = "Test Kullanıcı", string? userAgent = null)
    {
        var client = Client(userAgent);
        var email = TestHelpers.NewEmail();
        var auth = await client.RegisterAsync(email, name);
        client.WithBearer(auth.AccessToken);
        var workspaces = await client.GetFromJsonAsync<List<WorkspaceDto>>("/api/workspaces");
        return new User(client, auth.User.Id, email, workspaces!.Single().Id, auth);
    }

    private HttpClient Client(string? userAgent = null, string? app = null)
    {
        var client = factory.CreateClient();
        if (userAgent is not null)
        {
            client.DefaultRequestHeaders.UserAgent.ParseAdd(userAgent);
        }

        if (app is not null)
        {
            client.DefaultRequestHeaders.Add("X-Apivator-App", app);
        }

        return client;
    }

    /// <summary>Aynı kullanıcı için başka bir cihazdan giriş.</summary>
    private async Task<(HttpClient Client, AuthResult Auth)> LoginAsync(string email, string? userAgent = null, string? app = null, string password = TestHelpers.Password)
    {
        var client = Client(userAgent, app);
        var auth = await (await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(email, password))).ReadAsync<AuthResult>();
        client.WithBearer(auth.AccessToken);
        return (client, auth);
    }

    private static Task<HttpResponseMessage> RefreshAsync(HttpClient client, string refreshToken) =>
        client.PostAsJsonAsync("/api/auth/refresh", new RefreshRequest(refreshToken));

    [Fact]
    public async Task Profile_ListsOrganizationsWorkspacesAndRoles()
    {
        var a = await UserAsync("Ayşe Yılmaz");
        var org = await (await a.Client.PostAsJsonAsync("/api/organizations", new CreateOrganizationRequest("Ekip A.Ş."))).ReadAsync<OrganizationDto>();

        var profile = await a.Client.GetFromJsonAsync<ProfileDto>("/api/me/profile");

        Assert.Equal(("Ayşe Yılmaz", a.Email, (string?)null, (long?)null), (profile!.DisplayName, profile.Email, profile.PendingEmail, profile.AvatarVersion));
        Assert.True(profile.CreatedAt > DateTimeOffset.UtcNow.AddMinutes(-5));
        Assert.Equal(2, profile.Organizations.Count);
        Assert.True(profile.Organizations[0].IsPersonal);
        Assert.Equal(a.PersonalWorkspaceId, Assert.Single(profile.Organizations[0].Workspaces).Id);
        var team = profile.Organizations.Single(o => o.Id == org.Id);
        Assert.Equal(OrganizationRole.Owner, team.Role);
        Assert.Equal(("Genel", WorkspaceRole.Admin), (Assert.Single(team.Workspaces).Name, team.Workspaces[0].Role));
    }

    [Fact]
    public async Task UpdateProfile_ChangesDisplayName_AndValidates()
    {
        var a = await UserAsync("Eski Ad");

        var updated = await (await a.Client.PatchAsJsonAsync("/api/me/profile", new UpdateProfileRequest("  Yeni Ad  "))).ReadAsync<ProfileDto>();
        Assert.Equal("Yeni Ad", updated.DisplayName);
        Assert.Equal("Yeni Ad", (await a.Client.GetFromJsonAsync<UserDto>("/api/me"))!.DisplayName);

        Assert.Equal(HttpStatusCode.BadRequest, (await a.Client.PatchAsJsonAsync("/api/me/profile", new UpdateProfileRequest(" "))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await a.Client.PatchAsJsonAsync("/api/me/profile", new UpdateProfileRequest(new string('a', 81)))).StatusCode);
    }

    [Fact]
    public async Task Avatar_UploadServeAndRemove()
    {
        var a = await UserAsync();

        using var notImage = new ByteArrayContent("<svg onload=alert(1)>"u8.ToArray());
        notImage.Headers.ContentType = new MediaTypeHeaderValue("image/svg+xml");
        Assert.Equal(HttpStatusCode.BadRequest, (await a.Client.PutAsync("/api/me/avatar", notImage)).StatusCode);

        using var png = new ByteArrayContent(Png);
        png.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        var response = await a.Client.PutAsync("/api/me/avatar", png);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var me = await a.Client.GetFromJsonAsync<UserDto>("/api/me");
        Assert.NotNull(me!.AvatarVersion);

        // Herkese açık (oturumsuz) ve sürümlü adreste uzun süre önbelleklenir.
        var image = await factory.CreateClient().GetAsync($"/api/users/{a.Id}/avatar?v={me.AvatarVersion}");
        Assert.Equal(HttpStatusCode.OK, image.StatusCode);
        Assert.Equal("image/png", image.Content.Headers.ContentType?.MediaType);
        Assert.Equal(Png, await image.Content.ReadAsByteArrayAsync());
        Assert.Contains("immutable", image.Headers.CacheControl?.ToString() ?? string.Empty, StringComparison.Ordinal);

        Assert.Equal(HttpStatusCode.NoContent, (await a.Client.DeleteAsync("/api/me/avatar")).StatusCode);
        Assert.Null((await a.Client.GetFromJsonAsync<UserDto>("/api/me"))!.AvatarVersion);
        Assert.Equal(HttpStatusCode.NotFound, (await factory.CreateClient().GetAsync($"/api/users/{a.Id}/avatar")).StatusCode);
    }

    [Fact]
    public async Task EmailChange_RequiresVerification_OldAddressValidUntilConfirmed()
    {
        var a = await UserAsync("Değişen");
        var newEmail = TestHelpers.NewEmail();

        Assert.Equal(HttpStatusCode.BadRequest, (await a.Client.PostAsJsonAsync("/api/me/email", new ChangeEmailRequest(newEmail, "YanlisSifre1"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await a.Client.PostAsJsonAsync("/api/me/email", new ChangeEmailRequest("gecersiz", TestHelpers.Password))).StatusCode);

        Assert.Equal(HttpStatusCode.Accepted, (await a.Client.PostAsJsonAsync("/api/me/email", new ChangeEmailRequest(newEmail, TestHelpers.Password))).StatusCode);
        Assert.Equal(newEmail, (await a.Client.GetFromJsonAsync<ProfileDto>("/api/me/profile"))!.PendingEmail);

        // Doğrulanana kadar eski adresle giriş yapılır, yenisiyle yapılamaz.
        await LoginAsync(a.Email);
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().PostAsJsonAsync("/api/auth/login", new LoginRequest(newEmail, TestHelpers.Password))).StatusCode);

        var mail = factory.Emails.LastTo(newEmail);
        Assert.Contains("/confirm-email-change?", mail.TextBody, StringComparison.Ordinal);
        var confirm = new ConfirmEmailChangeRequest(
            Guid.Parse(TestHelpers.QueryValue(mail.TextBody, "userId")),
            TestHelpers.QueryValue(mail.TextBody, "email"),
            TestHelpers.QueryValue(mail.TextBody, "token"));

        Assert.Equal(HttpStatusCode.BadRequest, (await factory.CreateClient().PostAsJsonAsync("/api/auth/confirm-email-change", confirm with { Token = "bozuk" })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await factory.CreateClient().PostAsJsonAsync("/api/auth/confirm-email-change", confirm)).StatusCode);
        // Bağlantı ikinci kez açılırsa sorun çıkmaz.
        Assert.Equal(HttpStatusCode.NoContent, (await factory.CreateClient().PostAsJsonAsync("/api/auth/confirm-email-change", confirm)).StatusCode);

        var profile = await a.Client.GetFromJsonAsync<ProfileDto>("/api/me/profile");
        Assert.Equal((newEmail, (string?)null, true), (profile!.Email, profile.PendingEmail, profile.EmailConfirmed));
        await LoginAsync(newEmail);
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().PostAsJsonAsync("/api/auth/login", new LoginRequest(a.Email, TestHelpers.Password))).StatusCode);

        // Eski adrese bildirim gider.
        Assert.Contains("değişti", factory.Emails.LastTo(a.Email).Subject, StringComparison.Ordinal);
    }

    [Fact]
    public async Task EmailChange_ToTakenAddress_Conflicts_AndCancelInvalidatesLink()
    {
        var a = await UserAsync();
        var b = await UserAsync();
        Assert.Equal(HttpStatusCode.Conflict, (await a.Client.PostAsJsonAsync("/api/me/email", new ChangeEmailRequest(b.Email, TestHelpers.Password))).StatusCode);

        var newEmail = TestHelpers.NewEmail();
        await a.Client.PostAsJsonAsync("/api/me/email", new ChangeEmailRequest(newEmail, TestHelpers.Password));
        var mail = factory.Emails.LastTo(newEmail);
        Assert.Equal(HttpStatusCode.NoContent, (await a.Client.DeleteAsync("/api/me/email/pending")).StatusCode);
        Assert.Null((await a.Client.GetFromJsonAsync<ProfileDto>("/api/me/profile"))!.PendingEmail);

        var confirm = new ConfirmEmailChangeRequest(a.Id, newEmail, TestHelpers.QueryValue(mail.TextBody, "token"));
        Assert.Equal(HttpStatusCode.BadRequest, (await factory.CreateClient().PostAsJsonAsync("/api/auth/confirm-email-change", confirm)).StatusCode);
    }

    [Fact]
    public async Task ChangePassword_ClosesOtherSessions_KeepsCurrent_AndNotifies()
    {
        var a = await UserAsync();
        var (other, otherAuth) = await LoginAsync(a.Email, FirefoxMac);
        Assert.Equal(HttpStatusCode.OK, (await other.GetAsync("/api/me")).StatusCode);

        var wrong = await a.Client.PostAsJsonAsync("/api/me/password", new ChangePasswordRequest("YanlisSifre1", "YeniSifre123"));
        Assert.Equal(HttpStatusCode.BadRequest, wrong.StatusCode);
        Assert.Contains("currentPassword", await wrong.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        // Şifre kuralları kayıttakiyle aynı.
        var weak = await a.Client.PostAsJsonAsync("/api/me/password", new ChangePasswordRequest(TestHelpers.Password, "kisa"));
        Assert.Equal(HttpStatusCode.BadRequest, weak.StatusCode);
        Assert.Contains("newPassword", await weak.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        Assert.Equal(HttpStatusCode.NoContent, (await a.Client.PostAsJsonAsync("/api/me/password", new ChangePasswordRequest(TestHelpers.Password, "YeniSifre123"))).StatusCode);

        // Diğer cihaz: access token'ı süresini beklemeden, refresh token'ı da hemen geçersiz.
        Assert.Equal(HttpStatusCode.Unauthorized, (await other.GetAsync("/api/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await RefreshAsync(factory.CreateClient(), otherAuth.RefreshToken)).StatusCode);

        // Bu cihaz açık kalır.
        Assert.Equal(HttpStatusCode.OK, (await a.Client.GetAsync("/api/me")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await RefreshAsync(factory.CreateClient(), a.Auth.RefreshToken)).StatusCode);

        await LoginAsync(a.Email, password: "YeniSifre123");
        Assert.Contains("şifreniz değişti", factory.Emails.LastTo(a.Email).Subject, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Sessions_ListDevices_AndRevoke()
    {
        var a = await UserAsync(userAgent: ChromeWindows);
        var (mac, macAuth) = await LoginAsync(a.Email, FirefoxMac);
        var (desktop, _) = await LoginAsync(a.Email, "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0", "desktop");

        var sessions = await a.Client.GetFromJsonAsync<List<SessionDto>>("/api/me/sessions");
        Assert.Equal(3, sessions!.Count);
        Assert.True(sessions[0].Current);
        Assert.Equal("Chrome · Windows", sessions[0].Device);
        Assert.Contains(sessions, s => s is { Device: "Firefox · macOS", App: "web", Current: false });
        Assert.Contains(sessions, s => s is { Device: "Apivator Masaüstü · Windows", App: "desktop" });

        // Rotasyon oturumu değiştirmez: yenilenen token aynı oturum olarak kalır.
        var rotated = await (await RefreshAsync(Client(FirefoxMac), macAuth.RefreshToken)).ReadAsync<AuthResult>();
        mac.WithBearer(rotated.AccessToken);
        Assert.Equal(3, (await a.Client.GetFromJsonAsync<List<SessionDto>>("/api/me/sessions"))!.Count);

        var macSession = (await mac.GetFromJsonAsync<List<SessionDto>>("/api/me/sessions"))!.Single(s => s.Current);
        Assert.Equal("Firefox · macOS", macSession.Device);

        Assert.Equal(HttpStatusCode.NoContent, (await a.Client.DeleteAsync($"/api/me/sessions/{macSession.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await mac.GetAsync("/api/me")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await a.Client.DeleteAsync($"/api/me/sessions/{macSession.Id}")).StatusCode);

        var revoked = await (await a.Client.PostAsync("/api/me/sessions/revoke-others", null)).ReadAsync<Dictionary<string, int>>();
        Assert.Equal(1, revoked["revoked"]);
        Assert.Equal(HttpStatusCode.Unauthorized, (await desktop.GetAsync("/api/me")).StatusCode);
        Assert.True(Assert.Single((await a.Client.GetFromJsonAsync<List<SessionDto>>("/api/me/sessions"))!).Current);

        // Başkasının oturumu kapatılamaz.
        var b = await UserAsync();
        var bSession = (await b.Client.GetFromJsonAsync<List<SessionDto>>("/api/me/sessions"))!.Single();
        Assert.Equal(HttpStatusCode.NotFound, (await a.Client.DeleteAsync($"/api/me/sessions/{bSession.Id}")).StatusCode);
    }

    [Fact]
    public async Task Logout_EndsSession_AccessTokenStopsWorking()
    {
        var a = await UserAsync();
        Assert.Equal(HttpStatusCode.NoContent, (await a.Client.PostAsJsonAsync("/api/auth/logout", new RefreshRequest(a.Auth.RefreshToken))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await a.Client.GetAsync("/api/me")).StatusCode);
    }

    [Fact]
    public async Task Preferences_DefaultsUpdateAndValidation()
    {
        var a = await UserAsync();
        var b = await UserAsync();

        var defaults = await a.Client.GetFromJsonAsync<PreferencesDto>("/api/me/preferences");
        Assert.Equal(new PreferencesDto("system", null, true, true, true), defaults);

        var wanted = new PreferencesDto("dark", a.PersonalWorkspaceId, false, true, false, "en");
        Assert.Equal(wanted, await (await a.Client.PutAsJsonAsync("/api/me/preferences", wanted)).ReadAsync<PreferencesDto>());

        // Başka bir cihazdan girişte de aynı tercihler gelir.
        var (other, _) = await LoginAsync(a.Email);
        Assert.Equal(wanted, await other.GetFromJsonAsync<PreferencesDto>("/api/me/preferences"));

        Assert.Equal(HttpStatusCode.BadRequest, (await a.Client.PutAsJsonAsync("/api/me/preferences", wanted with { Theme = "pembe" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await a.Client.PutAsJsonAsync("/api/me/preferences", wanted with { Language = "xx" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await a.Client.PutAsJsonAsync("/api/me/preferences", wanted with { DefaultWorkspaceId = b.PersonalWorkspaceId })).StatusCode);

        // E-posta tercihleri adrese göre uygulanır; kayıtlı olmayan adresler (dağıtım listeleri) etkilenmez.
        await using var scope = factory.Services.CreateAsyncScope();
        var directory = scope.ServiceProvider.GetRequiredService<IUserDirectory>();
        Assert.False(await directory.EmailAllowedAsync(a.Email.ToUpperInvariant(), EmailTopic.Mention));
        Assert.True(await directory.EmailAllowedAsync(a.Email, EmailTopic.MergeRequest));
        Assert.False(await directory.EmailAllowedAsync(a.Email, EmailTopic.MonitorAlert));
        Assert.True(await directory.EmailAllowedAsync(b.Email, EmailTopic.Mention));
        Assert.True(await directory.EmailAllowedAsync("ekip@example.com", EmailTopic.MonitorAlert));
    }

    [Fact]
    public async Task Export_ContainsAccountAndPersonalWorkspaceInPostmanFormat()
    {
        var a = await UserAsync("Dışa Aktaran");
        await (await a.Client.PostAsJsonAsync($"/api/workspaces/{a.PersonalWorkspaceId}/collections", new CreateCollectionRequest("Ödeme API"))).ReadAsync<CollectionTreeDto>();
        await (await a.Client.PostAsJsonAsync($"/api/workspaces/{a.PersonalWorkspaceId}/collections", new CreateCollectionRequest("Ödeme API"))).ReadAsync<CollectionTreeDto>();
        Assert.True((await a.Client.PostAsJsonAsync($"/api/workspaces/{a.PersonalWorkspaceId}/environments", new CreateEnvironmentRequest("Test"))).IsSuccessStatusCode);

        var response = await a.Client.GetAsync("/api/me/export");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/zip", response.Content.Headers.ContentType?.MediaType);
        Assert.StartsWith("apivator-hesap-", response.Content.Headers.ContentDisposition?.FileName?.Trim('"'), StringComparison.Ordinal);

        await using var stream = await response.Content.ReadAsStreamAsync();
        using var zip = new ZipArchive(stream, ZipArchiveMode.Read);
        var names = zip.Entries.Select(e => e.FullName).Order(StringComparer.Ordinal).ToList();
        Assert.Equal(
            ["BENIOKU.txt", "collections/Ödeme API (2).postman_collection.json", "collections/Ödeme API.postman_collection.json", "environments/Test.postman_environment.json", "hesap.json"],
            names);

        using var reader = new StreamReader(zip.GetEntry("collections/Ödeme API.postman_collection.json")!.Open());
        Assert.Contains("schema.getpostman.com/json/collection/v2.1.0", await reader.ReadToEndAsync(), StringComparison.Ordinal);
        using var account = new StreamReader(zip.GetEntry("hesap.json")!.Open());
        Assert.Contains("Dışa Aktaran", await account.ReadToEndAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task DeleteAccount_RequiresOwnershipTransfer()
    {
        var owner = await UserAsync("Sahip");
        var org = await (await owner.Client.PostAsJsonAsync("/api/organizations", new CreateOrganizationRequest("Devredilecek"))).ReadAsync<OrganizationDto>();
        var solo = await (await owner.Client.PostAsJsonAsync("/api/organizations", new CreateOrganizationRequest("Tek Kişilik"))).ReadAsync<OrganizationDto>();
        var member = await UserAsync("Üye");
        await owner.Client.PostAsJsonAsync($"/api/organizations/{org.Id}/invitations", new InviteRequest(member.Email));
        var invite = TestHelpers.QueryValue(factory.Emails.LastTo(member.Email).TextBody, "token");
        await (await member.Client.PostAsJsonAsync("/api/invitations/accept", new AcceptInvitationRequest(invite))).ReadAsync<AcceptedInvitationDto>();

        var check = await owner.Client.GetFromJsonAsync<AccountDeletionCheckDto>("/api/me/deletion");
        Assert.Equal(org.Id, Assert.Single(check!.MustTransfer).Id);
        Assert.Equal(solo.Id, Assert.Single(check.WillDelete).Id);

        var blocked = await owner.Client.PostAsJsonAsync("/api/me/deletion", new DeleteAccountRequest(TestHelpers.Password));
        Assert.Equal(HttpStatusCode.Conflict, blocked.StatusCode);
        Assert.Contains("Devredilecek", await blocked.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        Assert.True((await owner.Client.PatchAsJsonAsync($"/api/organizations/{org.Id}/members/{member.Id}", new ChangeOrganizationRoleRequest(OrganizationRole.Owner))).IsSuccessStatusCode);
        Assert.Empty((await owner.Client.GetFromJsonAsync<AccountDeletionCheckDto>("/api/me/deletion"))!.MustTransfer);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PostAsJsonAsync("/api/me/deletion", new DeleteAccountRequest("YanlisSifre1"))).StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, (await owner.Client.PostAsJsonAsync("/api/me/deletion", new DeleteAccountRequest(TestHelpers.Password))).StatusCode);
    }

    [Fact]
    public async Task DeleteAccount_ConfirmedByEmail_RemovesPersonalData_KeepsTeamWork()
    {
        var owner = await UserAsync("Kalan Sahip");
        var org = await (await owner.Client.PostAsJsonAsync("/api/organizations", new CreateOrganizationRequest("Kalıcı Ekip"))).ReadAsync<OrganizationDto>();
        var general = (await owner.Client.GetFromJsonAsync<List<WorkspaceDto>>("/api/workspaces"))!.Single(w => w.OrganizationId == org.Id);

        var leaving = await UserAsync("Ayrılan Kişi");
        await owner.Client.PostAsJsonAsync($"/api/organizations/{org.Id}/invitations", new InviteRequest(leaving.Email, OrganizationRole.Member, general.Id, WorkspaceRole.Editor));
        var invite = TestHelpers.QueryValue(factory.Emails.LastTo(leaving.Email).TextBody, "token");
        await (await leaving.Client.PostAsJsonAsync("/api/invitations/accept", new AcceptInvitationRequest(invite))).ReadAsync<AcceptedInvitationDto>();

        var teamCollection = await (await leaving.Client.PostAsJsonAsync($"/api/workspaces/{general.Id}/collections", new CreateCollectionRequest("Ekip İşi"))).ReadAsync<CollectionTreeDto>();
        await (await leaving.Client.PostAsJsonAsync($"/api/workspaces/{leaving.PersonalWorkspaceId}/collections", new CreateCollectionRequest("Kişisel"))).ReadAsync<CollectionTreeDto>();
        await (await leaving.Client.PostAsJsonAsync("/api/me/api-keys", new Application.ApiKeys.CreateApiKeyRequest("CI"))).ReadAsync<Application.ApiKeys.CreatedApiKeyDto>();

        await leaving.Client.PostAsJsonAsync("/api/me/deletion", new DeleteAccountRequest(TestHelpers.Password));
        var mail = factory.Emails.LastTo(leaving.Email);
        Assert.Contains("/delete-account?", mail.TextBody, StringComparison.Ordinal);
        var confirm = new ConfirmAccountDeletionRequest(Guid.Parse(TestHelpers.QueryValue(mail.TextBody, "userId")), TestHelpers.QueryValue(mail.TextBody, "token"));

        Assert.Equal(HttpStatusCode.BadRequest, (await factory.CreateClient().PostAsJsonAsync("/api/auth/delete-account", confirm with { Token = "bozuk" })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await factory.CreateClient().PostAsJsonAsync("/api/auth/delete-account", confirm)).StatusCode);
        // Aynı bağlantı tekrar kullanılamaz.
        Assert.Equal(HttpStatusCode.BadRequest, (await factory.CreateClient().PostAsJsonAsync("/api/auth/delete-account", confirm)).StatusCode);

        // Giriş ve açık oturum kapanır; e-posta adresi yeniden kayıt için boşa çıkar.
        Assert.Equal(HttpStatusCode.Unauthorized, (await leaving.Client.GetAsync("/api/me/profile")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().PostAsJsonAsync("/api/auth/login", new LoginRequest(leaving.Email, TestHelpers.Password))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await RefreshAsync(factory.CreateClient(), leaving.Auth.RefreshToken)).StatusCode);
        Assert.Contains("silindi", factory.Emails.LastTo(leaving.Email).Subject, StringComparison.Ordinal);
        await factory.CreateClient().RegisterAsync(leaving.Email, "Geri Dönen");

        // Ekip workspace'indeki iş kalır; üyelik kalkar.
        var tree = await owner.Client.GetFromJsonAsync<List<CollectionTreeDto>>($"/api/workspaces/{general.Id}/collections");
        Assert.Contains(tree!, c => c.Id == teamCollection.Id);
        var members = await owner.Client.GetFromJsonAsync<OrganizationMembersDto>($"/api/organizations/{org.Id}/members");
        Assert.DoesNotContain(members!.Members, m => m.UserId == leaving.Id);

        // Kişisel workspace silinmiştir.
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<IApplicationDbContext>();
        Assert.False(db.Workspaces.Any(w => w.Id == leaving.PersonalWorkspaceId));
        Assert.False(db.ApiKeys.Any(k => k.UserId == leaving.Id));
        var directory = scope.ServiceProvider.GetRequiredService<IUserDirectory>();
        Assert.Equal("Silinmiş kullanıcı", (await directory.DisplayNamesAsync([leaving.Id]))[leaving.Id]);
    }

    [Theory]
    [InlineData(ChromeWindows, null, "Chrome · Windows")]
    [InlineData(FirefoxMac, null, "Firefox · macOS")]
    [InlineData("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", null, "Safari · iOS")]
    [InlineData("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0", null, "Edge · Linux")]
    [InlineData("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36", null, "Chrome · Android")]
    [InlineData(ChromeWindows, "desktop", "Apivator Masaüstü · Windows")]
    [InlineData("apivator-cli/0.1.0", null, "Apivator CLI")]
    [InlineData(null, null, "Bilinmeyen cihaz")]
    public void DeviceLabel_DescribesCommonClients(string? userAgent, string? app, string expected) =>
        Assert.Equal(expected, DeviceLabel.Describe(userAgent, app));

    [Theory]
    [InlineData("en", "Key name must be 1–")]
    [InlineData("tr", "Anahtar adı 1–")]
    public async Task ApiKeyValidation_FollowsAcceptLanguage(string language, string expectedStart)
    {
        var user = await UserAsync();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/me/api-keys")
        {
            Content = JsonContent.Create(new Application.ApiKeys.CreateApiKeyRequest(" ")),
        };
        request.Headers.TryAddWithoutValidation("Accept-Language", language);

        var response = await user.Client.SendAsync(request);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var body = System.Text.Json.JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.StartsWith(expectedStart, body.RootElement.GetProperty("detail").GetString());
    }
}
