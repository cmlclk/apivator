using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Apivator.Application.Collections;
using Apivator.Application.Common.Localization;
using Apivator.Application.Environments;
using Apivator.Application.Runs;
using Apivator.Application.Workspaces;

namespace Apivator.Cli;

internal sealed class ServerException(string message) : Exception(message);

/// <summary>Apivator sunucusuna API anahtarıyla konuşur (yalnızca okuma ve rapor gönderme).</summary>
internal sealed class ServerClient : IDisposable
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    private readonly HttpClient _http;

    public ServerClient(string server, string apiKey, HttpMessageHandler? handler = null)
    {
        if (!Uri.TryCreate(server.TrimEnd('/') + "/", UriKind.Absolute, out var baseAddress) || baseAddress.Scheme is not ("http" or "https"))
        {
            throw new UsageException(L.T("cli.server.bad_address", "Sunucu adresi geçersiz: {server} (ör. https://apivator.sirket.com)", ("server", server)));
        }

        _http = handler is null ? new HttpClient() : new HttpClient(handler, disposeHandler: false);
        _http.BaseAddress = baseAddress;
        _http.Timeout = TimeSpan.FromSeconds(60);
        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        // Sunucu hataları da CLI ile aynı dilde gelsin.
        _http.DefaultRequestHeaders.AcceptLanguage.Add(new StringWithQualityHeaderValue(Lang.Current));
        _http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("apivator-cli", typeof(ServerClient).Assembly.GetName().Version?.ToString(3) ?? "0"));
    }

    public Task<List<WorkspaceDto>> WorkspacesAsync(CancellationToken ct) => GetAsync<List<WorkspaceDto>>("api/workspaces", ct);

    public Task<List<CollectionTreeDto>> CollectionsAsync(Guid workspaceId, CancellationToken ct) =>
        GetAsync<List<CollectionTreeDto>>($"api/workspaces/{workspaceId}/collections", ct);

    public Task<RunSourceDto> RunSourceAsync(Guid collectionId, CancellationToken ct) =>
        GetAsync<RunSourceDto>($"api/collections/{collectionId}/run-source", ct);

    public Task<List<EnvironmentDto>> EnvironmentsAsync(Guid workspaceId, CancellationToken ct) =>
        GetAsync<List<EnvironmentDto>>($"api/workspaces/{workspaceId}/environments", ct);

    public Task<GlobalsDto> GlobalsAsync(Guid workspaceId, CancellationToken ct) =>
        GetAsync<GlobalsDto>($"api/workspaces/{workspaceId}/globals", ct);

    public async Task ReportAsync(RunReportRequest report, CancellationToken ct)
    {
        using var response = await SendAsync(() => _http.PostAsJsonAsync("api/runs/report", report, Json, ct));
        await EnsureAsync(response, ct);
    }

    private async Task<T> GetAsync<T>(string path, CancellationToken ct)
    {
        using var response = await SendAsync(() => _http.GetAsync(path, ct));
        await EnsureAsync(response, ct);
        return (await response.Content.ReadFromJsonAsync<T>(Json, ct))!;
    }

    private async Task<HttpResponseMessage> SendAsync(Func<Task<HttpResponseMessage>> send)
    {
        try
        {
            return await send();
        }
        catch (HttpRequestException ex)
        {
            throw new ServerException(L.T("cli.server.unreachable", "Sunucuya ulaşılamadı ({address}): {message}", ("address", _http.BaseAddress), ("message", ex.Message)));
        }
        catch (TaskCanceledException) when (!_http.Timeout.Equals(Timeout.InfiniteTimeSpan))
        {
            throw new ServerException(L.T("cli.server.timeout", "Sunucu yanıt vermedi ({address}).", ("address", _http.BaseAddress)));
        }
    }

    private static async Task EnsureAsync(HttpResponseMessage response, CancellationToken ct)
    {
        if (response.IsSuccessStatusCode)
        {
            return;
        }

        string? detail = null;
        try
        {
            using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            detail = problem.RootElement.TryGetProperty("detail", out var d) ? d.GetString() : null;
        }
        catch (JsonException)
        {
        }

        throw new ServerException(response.StatusCode switch
        {
            HttpStatusCode.Unauthorized => L.T("cli.server.unauthorized", "API anahtarı geçersiz, iptal edilmiş ya da süresi dolmuş. Yeni bir anahtarı Apivator'da Hesap > API anahtarları'ndan oluşturun."),
            HttpStatusCode.Forbidden => detail ?? L.T("cli.server.forbidden", "Bu işlem için yetkiniz yok."),
            HttpStatusCode.NotFound => detail ?? L.T("cli.server.not_found", "Bulunamadı ya da erişiminiz yok."),
            _ => L.T("cli.server.error", "Sunucu hatası ({status}){detail}", ("status", (int)response.StatusCode), ("detail", detail is null ? string.Empty : ": " + detail)),
        });
    }

    public void Dispose() => _http.Dispose();
}
