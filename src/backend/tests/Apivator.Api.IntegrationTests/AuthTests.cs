using System.Net;
using System.Net.Http.Json;
using Apivator.Application.Auth;
using Apivator.Application.Workspaces;
using Apivator.Domain.Workspaces;
using Microsoft.AspNetCore.Hosting;

namespace Apivator.Api.IntegrationTests;

[Collection(ApiCollection.Name)]
public class AuthTests(ApivatorApiFactory factory)
{
    [Fact]
    public async Task Register_CreatesPersonalWorkspace_AndSendsConfirmationEmail()
    {
        var client = factory.CreateClient();
        var email = TestHelpers.NewEmail();

        var auth = await client.RegisterAsync(email, "Ayşe Yılmaz");

        Assert.False(string.IsNullOrEmpty(auth.AccessToken));
        Assert.False(auth.User.EmailConfirmed);
        Assert.Contains(factory.Emails.Sent, m => m.To == email && m.Subject.Contains("doğrulayın", StringComparison.Ordinal));

        var workspaces = await client.WithBearer(auth.AccessToken)
            .GetFromJsonAsync<List<WorkspaceDto>>("/api/workspaces");

        var workspace = Assert.Single(workspaces!);
        Assert.Equal(WorkspaceType.Personal, workspace.Type);
        Assert.Equal(WorkspaceRole.Admin, workspace.Role);
    }

    [Theory]
    [InlineData("en", "Password must be at least 8 characters.")]
    [InlineData(null, "Şifre en az 8 karakter olmalı.")]
    public async Task Register_WithWeakPassword_LocalizesIdentityErrors(string? acceptLanguage, string expected)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/register")
        {
            Content = JsonContent.Create(new RegisterRequest(TestHelpers.NewEmail(), "Ab1", "Zayıf Şifre")),
        };
        if (acceptLanguage is not null)
        {
            request.Headers.TryAddWithoutValidation("Accept-Language", acceptLanguage);
        }

        var response = await factory.CreateClient().SendAsync(request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains(expected, await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Register_WithExistingEmail_ReturnsConflict()
    {
        var client = factory.CreateClient();
        var email = TestHelpers.NewEmail();
        await client.RegisterAsync(email);

        var response = await client.PostAsJsonAsync("/api/auth/register", new RegisterRequest(email, TestHelpers.Password, "Başka"));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Theory]
    [InlineData("gecersiz", "Sifre1234", "Ad")]
    [InlineData("a@example.com", "kisa1", "Ad")]
    [InlineData("a@example.com", "rakamyok", "Ad")]
    [InlineData("a@example.com", "Sifre1234", " ")]
    public async Task Register_WithInvalidInput_ReturnsValidationProblem(string email, string password, string name)
    {
        var response = await factory.CreateClient()
            .PostAsJsonAsync("/api/auth/register", new RegisterRequest(email, password, name));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Login_WithWrongPassword_ReturnsUnauthorized()
    {
        var client = factory.CreateClient();
        var email = TestHelpers.NewEmail();
        await client.RegisterAsync(email);

        var response = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(email, "YanlisSifre1"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Login_LocksOutAfterFiveFailures()
    {
        var client = factory.CreateClient();
        var email = TestHelpers.NewEmail();
        await client.RegisterAsync(email);

        for (var i = 0; i < 5; i++)
        {
            await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(email, "YanlisSifre1"));
        }

        var response = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(email, TestHelpers.Password));
        Assert.Equal(HttpStatusCode.Locked, response.StatusCode);
    }

    [Fact]
    public async Task Me_WithoutToken_ReturnsUnauthorized()
    {
        var response = await factory.CreateClient().GetAsync("/api/me");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Refresh_RotatesToken_AndDetectsReuse()
    {
        var client = factory.CreateClient();
        var auth = await client.RegisterAsync(TestHelpers.NewEmail());

        var first = await client.PostAsJsonAsync("/api/auth/refresh", new RefreshRequest(auth.RefreshToken));
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var rotated = (await first.Content.ReadFromJsonAsync<AuthResult>())!;
        Assert.NotEqual(auth.RefreshToken, rotated.RefreshToken);

        // Eski token tekrar kullanılırsa reddedilir ve yeni token da iptal edilir.
        var reuse = await client.PostAsJsonAsync("/api/auth/refresh", new RefreshRequest(auth.RefreshToken));
        Assert.Equal(HttpStatusCode.Unauthorized, reuse.StatusCode);

        var afterReuse = await client.PostAsJsonAsync("/api/auth/refresh", new RefreshRequest(rotated.RefreshToken));
        Assert.Equal(HttpStatusCode.Unauthorized, afterReuse.StatusCode);
    }

    [Fact]
    public async Task Refresh_WorksWithHttpOnlyCookie()
    {
        // Varsayılan test istemcisi cookie'leri saklar; web istemcisinin davranışı budur.
        var client = factory.CreateClient(new() { BaseAddress = new Uri("https://localhost") });
        await client.RegisterAsync(TestHelpers.NewEmail());

        var response = await client.PostAsync("/api/auth/refresh", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Logout_RevokesRefreshToken()
    {
        var client = factory.CreateClient();
        var auth = await client.RegisterAsync(TestHelpers.NewEmail());

        await client.PostAsJsonAsync("/api/auth/logout", new RefreshRequest(auth.RefreshToken));
        var response = await client.PostAsJsonAsync("/api/auth/refresh", new RefreshRequest(auth.RefreshToken));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task ConfirmEmail_WithTokenFromEmail_MarksUserConfirmed()
    {
        var client = factory.CreateClient();
        var email = TestHelpers.NewEmail();
        var auth = await client.RegisterAsync(email);

        var message = factory.Emails.LastTo(email);
        var request = new ConfirmEmailRequest(
            Guid.Parse(TestHelpers.QueryValue(message.TextBody, "userId")),
            TestHelpers.QueryValue(message.TextBody, "token"));

        var response = await client.PostAsJsonAsync("/api/auth/confirm-email", request);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        var me = await client.WithBearer(auth.AccessToken).GetFromJsonAsync<UserDto>("/api/me");
        Assert.True(me!.EmailConfirmed);
    }

    [Fact]
    public async Task ResetPassword_ChangesPassword_AndRevokesSessions()
    {
        var client = factory.CreateClient();
        var email = TestHelpers.NewEmail();
        var auth = await client.RegisterAsync(email);

        var forgot = await client.PostAsJsonAsync("/api/auth/forgot-password", new ForgotPasswordRequest(email));
        Assert.Equal(HttpStatusCode.Accepted, forgot.StatusCode);

        var token = TestHelpers.QueryValue(factory.Emails.LastTo(email).TextBody, "token");
        var reset = await client.PostAsJsonAsync("/api/auth/reset-password", new ResetPasswordRequest(email, token, "YeniSifre99"));
        Assert.Equal(HttpStatusCode.NoContent, reset.StatusCode);

        var oldSession = await client.PostAsJsonAsync("/api/auth/refresh", new RefreshRequest(auth.RefreshToken));
        Assert.Equal(HttpStatusCode.Unauthorized, oldSession.StatusCode);

        var login = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(email, "YeniSifre99"));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
    }

    [Fact]
    public async Task ForgotPassword_ForUnknownEmail_StillReturnsAccepted()
    {
        var response = await factory.CreateClient()
            .PostAsJsonAsync("/api/auth/forgot-password", new ForgotPasswordRequest(TestHelpers.NewEmail()));

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
    }

    [Fact]
    public async Task SessionRefresh_IsNotLimitedLikeLoginAttempts()
    {
        // Aynı IP'den (ör. bir ofis) gelen sayfa açılışları giriş denemesi sınırını tüketmemeli.
        using var strict = factory.WithWebHostBuilder(b => b.UseSetting("RateLimiting:AuthPermitPerMinute", "3"));
        var client = strict.CreateClient();
        var email = TestHelpers.NewEmail();
        var token = (await client.RegisterAsync(email)).RefreshToken;

        for (var i = 0; i < 5; i++)
        {
            var refresh = await client.PostAsJsonAsync("/api/auth/refresh", new RefreshRequest(token));
            Assert.Equal(HttpStatusCode.OK, refresh.StatusCode);
            token = (await refresh.Content.ReadFromJsonAsync<AuthResult>())!.RefreshToken;
        }

        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 3; i++)
        {
            statuses.Add((await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(email, TestHelpers.Password))).StatusCode);
        }

        Assert.Equal([HttpStatusCode.OK, HttpStatusCode.OK, HttpStatusCode.TooManyRequests], statuses);
    }
}
