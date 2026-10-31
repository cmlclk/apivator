using System.Buffers;
using System.Globalization;
using System.Text;
using System.Text.Json;
using Apivator.Api.Infrastructure;
using Apivator.Application.Abstractions;
using Apivator.Application.Audit;
using Apivator.Application.Common.Localization;

namespace Apivator.Api.Endpoints;

internal static class AuditEndpoints
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static void MapAuditEndpoints(this IEndpointRouteBuilder routes)
    {
        var audit = routes.MapGroup("/organizations/{id:guid}/audit").WithTags("Audit").RequireAuthorization();

        audit.MapGet("/", async (
            Guid id,
            DateTimeOffset? from,
            DateTimeOffset? to,
            string? action,
            Guid? actorId,
            Guid? workspaceId,
            string? q,
            string? cursor,
            int? limit,
            IAuditService service,
            ICurrentUser user,
            CancellationToken ct) =>
        {
            var result = await service.ListAsync(id, new AuditQuery(from, to, action, actorId, workspaceId, q, cursor, limit), user.RequiredId, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });

        // ?format=csv|json; CSV'de ayırıcı varsayılan olarak ';' (Türkçe Excel), separator=comma ile ','.
        audit.MapGet("/export", async (
                Guid id,
                string? format,
                string? separator,
                DateTimeOffset? from,
                DateTimeOffset? to,
                string? action,
                Guid? actorId,
                Guid? workspaceId,
                string? q,
                IAuditService service,
                ICurrentUser user,
                HttpContext http,
                CancellationToken ct) =>
            {
                var kind = string.Equals(format, "json", StringComparison.OrdinalIgnoreCase) ? AuditExportFormat.Json : AuditExportFormat.Csv;
                var result = await service.ExportAsync(id, new AuditQuery(from, to, action, actorId, workspaceId, q), kind, user.RequiredId, ct);
                if (!result.IsSuccess)
                {
                    return result.Error!.ToProblem();
                }

                var stamp = DateTimeOffset.UtcNow.ToString("yyyyMMdd-HHmm", CultureInfo.InvariantCulture);
                var name = L.T("audit.export_filename", "denetim-kaydi");
                var extension = kind == AuditExportFormat.Json ? "json" : "csv";
                http.Response.ContentType = kind == AuditExportFormat.Json ? "application/json; charset=utf-8" : "text/csv; charset=utf-8";
                http.Response.Headers.ContentDisposition = $"attachment; filename=\"{name}-{stamp}.{extension}\"";
                http.Response.Headers.CacheControl = "no-store";

                if (kind == AuditExportFormat.Json)
                {
                    await WriteJsonAsync(http.Response.Body, result.Value, ct);
                }
                else
                {
                    await WriteCsvAsync(http.Response.Body, result.Value, string.Equals(separator, "comma", StringComparison.OrdinalIgnoreCase) ? ',' : ';', ct);
                }

                return Results.Empty;
            })
            .RequireRateLimiting(RateLimitPolicies.Runs);
    }

    private static async Task WriteJsonAsync(Stream body, IAsyncEnumerable<AuditEntryDto> rows, CancellationToken ct)
    {
        // Serialize(writer) her nesneden sonra senkron flush yapar; Kestrel buna izin vermediği için önce belleğe
        // yazılır, tampon dolunca yanıta asenkron aktarılır.
        var buffer = new ArrayBufferWriter<byte>(64 * 1024);
        await using var json = new Utf8JsonWriter(buffer);
        json.WriteStartArray();
        await foreach (var row in rows.WithCancellation(ct))
        {
            JsonSerializer.Serialize(json, row, JsonOptions);
            if (buffer.WrittenCount > 60 * 1024)
            {
                await body.WriteAsync(buffer.WrittenMemory, ct);
                buffer.ResetWrittenCount();
            }
        }

        json.WriteEndArray();
        json.Flush();
        await body.WriteAsync(buffer.WrittenMemory, ct);
    }

    private static async Task WriteCsvAsync(Stream body, IAsyncEnumerable<AuditEntryDto> rows, char separator, CancellationToken ct)
    {
        // UTF-8 BOM: Excel Türkçe karakterleri ancak böyle doğru açar.
        await using var writer = new StreamWriter(body, new UTF8Encoding(encoderShouldEmitUTF8Identifier: true), leaveOpen: true);
        string[] header =
        [
            L.T("audit.csv_time", "Zaman (UTC)"),
            L.T("audit.csv_event", "Olay"),
            L.T("audit.csv_actor", "Yapan"),
            L.T("audit.csv_actor_email", "Yapan e-posta"),
            L.T("audit.csv_api_key", "API anahtarı"),
            L.T("audit.csv_ip", "IP"),
            L.T("audit.csv_device", "Cihaz"),
            L.T("audit.csv_target_type", "Hedef türü"),
            L.T("audit.csv_target", "Hedef"),
            L.T("audit.csv_target_id", "Hedef Id"),
            L.T("audit.csv_workspace", "Workspace"),
            L.T("audit.csv_details", "Ayrıntı"),
        ];
        await writer.WriteLineAsync(string.Join(separator, header.Select(h => Csv(h, separator))));
        var count = 0;
        await foreach (var r in rows.WithCancellation(ct))
        {
            string?[] cells =
            [
                r.CreatedAt.UtcDateTime.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
                r.Action,
                r.ActorName,
                r.ActorEmail,
                r.ViaApiKey ? L.T("audit.csv_yes", "evet") : string.Empty,
                r.IpAddress,
                r.Device,
                r.TargetType,
                r.TargetName,
                r.TargetId?.ToString(),
                r.WorkspaceName,
                string.Join("; ", r.Data.Select(d => $"{d.Key}={d.Value}")),
            ];
            await writer.WriteLineAsync(string.Join(separator, cells.Select(c => Csv(c, separator))));
            if (++count % 500 == 0)
            {
                await writer.FlushAsync(ct);
            }
        }

        await writer.FlushAsync(ct);
    }

    /// <summary>RFC 4180 tırnaklama; =, +, -, @ ile başlayan hücreler Excel formülü olarak çalışmasın diye önüne ' eklenir.</summary>
    private static string Csv(string? value, char separator)
    {
        if (string.IsNullOrEmpty(value))
        {
            return string.Empty;
        }

        if (value[0] is '=' or '+' or '-' or '@' or '\t' or '\r')
        {
            value = "'" + value;
        }

        return value.IndexOfAny([separator, '"', '\n', '\r']) >= 0 ? "\"" + value.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"" : value;
    }
}
