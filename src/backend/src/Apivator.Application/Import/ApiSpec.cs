using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;

namespace Apivator.Application.Import;

/// <summary>
/// Bir OpenAPI/Swagger belgesini (JSON ya da YAML metni) içe aktarıcının okuduğu tek biçime getirir:
/// OpenAPI 3 JSON. Swagger 2.0 çevrilir; belge bir adresten geldiyse göreli sunucu adresleri ona göre tamamlanır.
/// </summary>
public static class ApiSpec
{
    /// <summary>Çekilen ya da yapıştırılan belgenin en büyük boyutu.</summary>
    public const int MaxBytes = 20 * 1024 * 1024;

    private static readonly JsonDocumentOptions JsonOptions = new()
    {
        AllowTrailingCommas = true,
        CommentHandling = JsonCommentHandling.Skip,
        MaxDepth = 256,
    };

    private static readonly JsonSerializerOptions Compact = new() { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    /// <summary>Metin bir OpenAPI 3 ya da Swagger 2.0 belgesi mi (ayrıştırmadan, hızlı ön kontrol).</summary>
    public static bool LooksLikeSpec(string text)
    {
        var head = text.Length > 4096 ? text[..4096] : text;
        return head.Contains("\"openapi\"", StringComparison.Ordinal)
            || head.Contains("\"swagger\"", StringComparison.Ordinal)
            || System.Text.RegularExpressions.Regex.IsMatch(head, @"(?m)^\s*['""]?(openapi|swagger)['""]?\s*:", System.Text.RegularExpressions.RegexOptions.None, TimeSpan.FromMilliseconds(100));
    }

    /// <summary>JSON ya da YAML metnini okur ve OpenAPI 3 belgesine çevirir.</summary>
    public static Result<JsonObject> Read(string text, Uri? documentUrl)
    {
        JsonNode? node;
        var trimmed = text.TrimStart('﻿', ' ', '\t', '\r', '\n');
        try
        {
            node = trimmed.StartsWith('{') || trimmed.StartsWith('[')
                ? JsonNode.Parse(trimmed, documentOptions: JsonOptions)
                : YamlJson.Parse(trimmed);
        }
        catch (JsonException ex)
        {
            return Error.Validation("spec.invalid", L.T("spec.invalid", "Belge geçerli bir JSON değil: {error}", ("error", ex.Message)));
        }
        catch (FormatException ex)
        {
            return Error.Validation("spec.invalid", ex.Message);
        }

        return node is JsonObject document ? Normalize(document, documentUrl) : NotSpec();
    }

    /// <summary>Ayrıştırılmış belgeyi (dosyadan içe aktarmada) OpenAPI 3'e getirir.</summary>
    public static Result<JsonObject> Normalize(JsonObject document, Uri? documentUrl)
    {
        // YAML'da tırnaksız "openapi: 3.1" ya da "swagger: 2.0" sayı olarak okunur.
        foreach (var key in new[] { "openapi", "swagger" })
        {
            if (document[key] is JsonValue v && v.GetValueKind() == JsonValueKind.Number)
            {
                document[key] = v.ToJsonString();
            }
        }

        if (document["info"] is JsonObject info && info["version"] is JsonValue version && version.GetValueKind() == JsonValueKind.Number)
        {
            info["version"] = version.ToJsonString();
        }

        if (Version(document, "swagger") is { } swagger)
        {
            if (!swagger.StartsWith('2'))
            {
                return Error.Validation("spec.unsupported", L.T("spec.unsupported_swagger", "Swagger {version} desteklenmiyor; yalnızca 2.0 ve OpenAPI 3.", ("version", swagger)));
            }

            return Swagger2Converter.Convert(document, documentUrl);
        }

        if (Version(document, "openapi") is not { } openapi)
        {
            return NotSpec();
        }

        if (!openapi.StartsWith('3'))
        {
            return Error.Validation("spec.unsupported", L.T("spec.unsupported_openapi", "OpenAPI {version} desteklenmiyor; yalnızca 2.0 ve 3.x.", ("version", openapi)));
        }

        if (documentUrl is not null)
        {
            ResolveServers(document, documentUrl);
        }

        return document;
    }

    /// <summary>Belgenin içerik özeti (değişiklik tespiti için); aynı belge her zaman aynı özeti verir.</summary>
    public static string Hash(JsonObject document) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(document.ToJsonString(Compact))));

    public static string Serialize(JsonObject document) => document.ToJsonString(Compact);

    public static JsonObject Deserialize(string json) =>
        JsonNode.Parse(json, documentOptions: JsonOptions) as JsonObject ?? throw new InvalidOperationException("Kayıtlı belge bozuk.");

    public static string? Title(JsonObject document) => document["info"]?["title"] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    public static string? DocumentVersion(JsonObject document) => document["info"]?["version"] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    /// <summary>
    /// OpenAPI 3'te sunucu yoksa varsayılan "/" yani belgenin sunucusudur; göreli adresler ("/api", "//host")
    /// belgenin adresine göre tam adrese çevrilir. Şablonlu adresler ("{scheme}://…") olduğu gibi kalır.
    /// </summary>
    private static void ResolveServers(JsonObject document, Uri documentUrl)
    {
        if (document["servers"] is not JsonArray { Count: > 0 } servers)
        {
            document["servers"] = new JsonArray(new JsonObject { ["url"] = documentUrl.GetLeftPart(UriPartial.Authority) });
            return;
        }

        foreach (var server in servers.OfType<JsonObject>())
        {
            if (server["url"] is JsonValue v && v.TryGetValue<string>(out var url) && !url.StartsWith('{')
                // Unix'te "/api" mutlak dosya adresi sayıldığı için şema kontrolü metin üzerinden.
                && !url.Contains("://", StringComparison.Ordinal) && Uri.TryCreate(documentUrl, url, out var absolute))
            {
                server["url"] = absolute.ToString().TrimEnd('/');
            }
        }
    }

    private static string? Version(JsonObject document, string key) =>
        document[key] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    private static Error NotSpec() =>
        Error.Validation("spec.not_openapi", L.T("spec.not_openapi", "Belge bir OpenAPI 3 ya da Swagger 2.0 belgesi değil."));
}
