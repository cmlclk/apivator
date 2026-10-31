using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.RegularExpressions;
using Apivator.Application.Auth;

namespace Apivator.Api.IntegrationTests;

internal static partial class TestHelpers
{
    public const string Password = "Sifre1234";

    public static string NewEmail() => $"user-{Guid.NewGuid():N}@example.com";

    public static async Task<AuthResult> RegisterAsync(this HttpClient client, string email, string displayName = "Test Kullanıcı")
    {
        var response = await client.PostAsJsonAsync("/api/auth/register", new RegisterRequest(email, Password, displayName));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<AuthResult>())!;
    }

    /// <summary>Yeni bir kullanıcı kaydeder; token'lı istemciyi ve kişisel workspace'inin Id'sini döner.</summary>
    public static async Task<(HttpClient Client, Guid WorkspaceId)> CreateUserAsync(this Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program> factory)
    {
        var client = factory.CreateClient();
        var auth = await client.RegisterAsync(NewEmail());
        client.WithBearer(auth.AccessToken);
        var workspaces = await client.GetFromJsonAsync<List<Application.Workspaces.WorkspaceDto>>("/api/workspaces");
        return (client, workspaces!.Single().Id);
    }

    public static async Task<T> ReadAsync<T>(this HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return (await response.Content.ReadFromJsonAsync<T>())!;
    }

    public static HttpClient WithBearer(this HttpClient client, string accessToken)
    {
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        return client;
    }

    /// <summary>E-posta metnindeki linkten sorgu parametresini çeker.</summary>
    public static string QueryValue(string text, string key)
    {
        var match = Regex.Match(text, $@"[?&]{Regex.Escape(key)}=([^&\s]+)");
        Assert.True(match.Success, $"E-postada '{key}' parametresi bulunamadı.");
        return Uri.UnescapeDataString(match.Groups[1].Value);
    }
}
