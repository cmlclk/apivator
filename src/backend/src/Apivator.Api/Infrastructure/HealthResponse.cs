using System.Reflection;
using System.Text.Json;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace Apivator.Api.Infrastructure;

/// <summary>Sağlık kontrolü yanıtı: genel durum, sürüm ve her bileşen. Hata ayrıntısı (bağlantı dizesi vb.) yazılmaz.</summary>
internal static class HealthResponse
{
    public static readonly string Version =
        typeof(HealthResponse).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0] ?? "0.0.0";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static Task WriteAsync(HttpContext context, HealthReport report)
    {
        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.Headers.CacheControl = "no-store";
        return context.Response.WriteAsync(JsonSerializer.Serialize(
            new
            {
                status = report.Status.ToString(),
                version = Version,
                durationMs = Math.Round(report.TotalDuration.TotalMilliseconds, 1),
                checks = report.Entries.ToDictionary(e => e.Key, e => e.Value.Status.ToString()),
            },
            Json));
    }
}
