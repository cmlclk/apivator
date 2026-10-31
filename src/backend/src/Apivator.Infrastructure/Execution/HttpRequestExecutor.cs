using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Text;
using Apivator.Application.Common.Localization;
using Apivator.Application.Execution;
using Apivator.Domain.Collections;
using Microsoft.Extensions.Options;

namespace Apivator.Infrastructure.Execution;

internal sealed class HttpRequestExecutor(IExecutionHttpClientSource clients, IOptionsMonitor<ProxyOptions> options, TimeProvider clock)
    : IRequestExecutor, IRequestStreamer
{
    public const string HttpClientName = "apivator-executor";
    private const string UserAgent = "Apivator/0.1";

    public async Task<ExecuteHttpResponse> ExecuteAsync(ExecuteHttpRequest request, CancellationToken cancellationToken = default)
    {
        if (!TryBuildUri(request.Url, out var uri, out var urlError))
        {
            return ExecuteHttpResponse.Failed("invalid_url", urlError);
        }

        uri = AuthApplier.ApplyToUri(uri, request.Auth);

        var settings = options.CurrentValue;
        HttpRequestMessage message;
        string? bodyPreview;
        Dictionary<int, DecodedFile> files;
        try
        {
            files = DecodeFiles(request.Files, settings.MaxUploadBytes);
            (message, bodyPreview) = BuildMessage(request, uri, files);
        }
        catch (FormatException ex)
        {
            return ExecuteHttpResponse.Failed("invalid_request", ex.Message);
        }

        if (request.Auth is { Type: AuthType.AwsSigV4 } aws)
        {
            var bytes = message.Content is null ? [] : await message.Content.ReadAsByteArrayAsync(cancellationToken);
            AwsSigner.Sign(message, bytes, aws, clock.GetUtcNow());
        }

        var timeout = TimeSpan.FromMilliseconds(Math.Clamp(request.TimeoutMs ?? settings.TimeoutSeconds * 1000, 100, settings.TimeoutSeconds * 1000));
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(timeout);

        var sent = Snapshot(message, bodyPreview);
        var client = clients.CreateClient();
        var stopwatch = Stopwatch.StartNew();

        try
        {
            var first = await client.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, timeoutCts.Token);
            var current = message;

            // Digest: sunucunun meydan okumasına göre aynı isteği imzalı olarak bir kez daha gönder.
            if (request.Auth is { Type: AuthType.Digest } digest
                && first.StatusCode == HttpStatusCode.Unauthorized
                && DigestAuth.Challenge(first) is { } challenge
                && !message.Headers.Contains("Authorization"))
            {
                first.Dispose();
                (current, _) = BuildMessage(request, uri, files);
                current.Headers.TryAddWithoutValidation(
                    "Authorization",
                    DigestAuth.Authorization(challenge, current.Method.Method, uri, digest.BasicUsername, digest.BasicPassword));
                sent = Snapshot(current, bodyPreview);
                message.Dispose();
                first = await client.SendAsync(current, HttpCompletionOption.ResponseHeadersRead, timeoutCts.Token);
            }

            using (current)
            using (var response = first)
            {
                var (bytes, truncated) = await ReadLimitedAsync(response.Content, settings.MaxResponseBytes, timeoutCts.Token);
                stopwatch.Stop();

                var (body, encoding) = DecodeBody(bytes, response.Content.Headers.ContentType);
                return new ExecuteHttpResponse(
                    (int)response.StatusCode,
                    response.ReasonPhrase ?? response.StatusCode.ToString(),
                    CollectHeaders(response),
                    body,
                    encoding,
                    bytes.Length,
                    truncated,
                    stopwatch.Elapsed.TotalMilliseconds,
                    response.RequestMessage?.RequestUri?.ToString(),
                    null)
                { Request = sent };
            }
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return ExecuteHttpResponse.Failed("timeout", L.T("execute.request_timeout", "İstek {seconds:0.#} saniye içinde yanıt almadı.", ("seconds", timeout.TotalSeconds)), stopwatch.Elapsed.TotalMilliseconds) with { Request = sent };
        }
        catch (HttpRequestException ex)
        {
            var (code, text) = Describe(ex, uri);
            return ExecuteHttpResponse.Failed(code, text, stopwatch.Elapsed.TotalMilliseconds) with { Request = sent };
        }
    }

    /// <summary>
    /// Yanıtı akış olarak okur. text/event-stream ise her SSE olayı ayrı iletilir; değilse gövde (sınırlı) tek
    /// parça gönderilir. Bağlantı zaman aşımı yalnızca yanıt başlıklarına kadar; akışın kendisi en fazla
    /// <see cref="ProxyOptions.StreamMaxMinutes"/> sürer.
    /// </summary>
    public async Task StreamAsync(ExecuteHttpRequest request, Func<StreamEvent, Task> emit, CancellationToken cancellationToken = default)
    {
        if (!TryBuildUri(request.Url, out var uri, out var urlError))
        {
            await emit(new StreamEvent("error") { Message = urlError });
            return;
        }

        uri = AuthApplier.ApplyToUri(uri, request.Auth);
        var settings = options.CurrentValue;
        HttpRequestMessage message;
        try
        {
            (message, _) = BuildMessage(request, uri, DecodeFiles(request.Files, settings.MaxUploadBytes));
        }
        catch (FormatException ex)
        {
            await emit(new StreamEvent("error") { Message = ex.Message });
            return;
        }

        using var owned = message;
        if (message.Headers.Accept.Count == 0)
        {
            message.Headers.TryAddWithoutValidation("Accept", "text/event-stream");
        }

        if (request.Auth is { Type: AuthType.AwsSigV4 } aws)
        {
            var bytes = message.Content is null ? [] : await message.Content.ReadAsByteArrayAsync(cancellationToken);
            AwsSigner.Sign(message, bytes, aws, clock.GetUtcNow());
        }

        using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        lifetime.CancelAfter(TimeSpan.FromMinutes(settings.StreamMaxMinutes));
        using var connectTimeout = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
        connectTimeout.CancelAfter(TimeSpan.FromSeconds(settings.TimeoutSeconds));
        var stopwatch = Stopwatch.StartNew();
        HttpResponseMessage response;
        try
        {
            response = await clients.CreateClient().SendAsync(message, HttpCompletionOption.ResponseHeadersRead, connectTimeout.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            await emit(new StreamEvent("error") { Message = L.T("execute.server_timeout", "Sunucu {seconds} saniye içinde yanıt vermedi.", ("seconds", settings.TimeoutSeconds)) });
            return;
        }
        catch (HttpRequestException ex)
        {
            await emit(new StreamEvent("error") { Message = Describe(ex, uri).Message });
            return;
        }

        using (response)
        {
            await emit(new StreamEvent("open")
            {
                Status = (int)response.StatusCode,
                StatusText = response.ReasonPhrase ?? response.StatusCode.ToString(),
                Headers = CollectHeaders(response),
                ElapsedMs = stopwatch.Elapsed.TotalMilliseconds,
            });

            if (response.Content.Headers.ContentType?.MediaType?.Equals("text/event-stream", StringComparison.OrdinalIgnoreCase) != true)
            {
                var (bytes, truncated) = await ReadLimitedAsync(response.Content, settings.MaxResponseBytes, lifetime.Token);
                var (body, _) = DecodeBody(bytes, response.Content.Headers.ContentType);
                await emit(new StreamEvent("body") { Data = body, Message = truncated ? L.T("execute.truncated", "Yanıt kısaltıldı.") : null, ElapsedMs = stopwatch.Elapsed.TotalMilliseconds });
                await emit(new StreamEvent("done") { Message = L.T("execute.not_event_stream", "Yanıt bir olay akışı (text/event-stream) değil."), ElapsedMs = stopwatch.Elapsed.TotalMilliseconds });
                return;
            }

            try
            {
                await using var stream = await response.Content.ReadAsStreamAsync(lifetime.Token);
                using var reader = new StreamReader(stream, Encoding.UTF8);
                await foreach (var sse in SseParser.ReadAsync(reader, lifetime.Token))
                {
                    await emit(new StreamEvent("event") { Event = sse.Event, Data = sse.Data, Id = sse.Id, ElapsedMs = stopwatch.Elapsed.TotalMilliseconds });
                }

                await emit(new StreamEvent("done") { Message = L.T("execute.stream_closed", "Sunucu akışı kapattı."), ElapsedMs = stopwatch.Elapsed.TotalMilliseconds });
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                await emit(new StreamEvent("done") { Message = L.T("execute.stream_limit", "Akış {minutes} dakika sınırına ulaştı.", ("minutes", settings.StreamMaxMinutes)), ElapsedMs = stopwatch.Elapsed.TotalMilliseconds });
            }
            catch (IOException ex)
            {
                await emit(new StreamEvent("error") { Message = L.T("execute.stream_interrupted", "Akış kesildi: {message}", ("message", ex.Message)), ElapsedMs = stopwatch.Elapsed.TotalMilliseconds });
            }
        }
    }

    private static bool TryBuildUri(string? raw, out Uri uri, out string error)
    {
        uri = null!;
        error = L.T("execute.invalid_url", "Geçerli bir URL girin.");
        var value = raw?.Trim();
        if (string.IsNullOrEmpty(value))
        {
            error = L.T("execute.url_empty", "URL boş olamaz.");
            return false;
        }

        // Postman gibi: şema yazılmamışsa http varsayılır (ör. "localhost:5000/api").
        if (!value.Contains("://", StringComparison.Ordinal))
        {
            value = "http://" + value;
        }

        if (!Uri.TryCreate(value, UriKind.Absolute, out var parsed))
        {
            return false;
        }

        if (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps)
        {
            error = L.T("execute.only_http", "Yalnızca http ve https adresleri desteklenir.");
            return false;
        }

        uri = parsed;
        return true;
    }

    private sealed record DecodedFile(string FileName, string? ContentType, byte[] Bytes);

    private static Dictionary<int, DecodedFile> DecodeFiles(IReadOnlyList<ExecuteFile>? files, int maxBytes)
    {
        var result = new Dictionary<int, DecodedFile>();
        long total = 0;
        foreach (var file in files ?? [])
        {
            byte[] bytes;
            try
            {
                bytes = Convert.FromBase64String(file.ContentBase64 ?? string.Empty);
            }
            catch (FormatException)
            {
                throw new FormatException(L.T("execute.file_unreadable", "'{name}' dosyasının içeriği okunamadı.", ("name", file.FileName)));
            }

            total += bytes.Length;
            if (total > maxBytes)
            {
                throw new FormatException(L.T("execute.files_too_large", "Gönderilen dosyalar toplamda {max} MB sınırını aşıyor.", ("max", maxBytes / (1024 * 1024))));
            }

            result[file.Index] = new DecodedFile(file.FileName, file.ContentType, bytes);
        }

        return result;
    }

    private const int PreviewLimit = 64 * 1024;

    /// <summary>Konsolda gösterilmek üzere hedefe giden isteğin kopyası.</summary>
    private static SentRequestDto Snapshot(HttpRequestMessage message, string? bodyPreview)
    {
        var headers = message.Headers.Select(h => new HttpHeaderDto(h.Key, string.Join(", ", h.Value)))
            .Concat(message.Content?.Headers.Select(h => new HttpHeaderDto(h.Key, string.Join(", ", h.Value))) ?? [])
            .ToList();
        var preview = bodyPreview is { Length: > PreviewLimit } ? bodyPreview[..PreviewLimit] + "…" : bodyPreview;
        return new SentRequestDto(message.Method.Method, message.RequestUri?.ToString() ?? string.Empty, headers, preview);
    }

    private static (HttpRequestMessage Message, string? BodyPreview) BuildMessage(ExecuteHttpRequest request, Uri uri, Dictionary<int, DecodedFile> files)
    {
        var method = string.IsNullOrWhiteSpace(request.Method) ? HttpMethod.Get : new HttpMethod(request.Method.Trim().ToUpperInvariant());
        var message = new HttpRequestMessage(method, uri) { Version = HttpVersion.Version11, VersionPolicy = HttpVersionPolicy.RequestVersionOrHigher };

        var headers = (request.Headers ?? []).Where(h => h.Enabled && !string.IsNullOrWhiteSpace(h.Key)).ToList();
        var contentType = headers.LastOrDefault(h => h.Key.Trim().Equals("Content-Type", StringComparison.OrdinalIgnoreCase))?.Value;
        (message.Content, var bodyPreview) = BuildContent(request.Body ?? RequestBody.None, contentType, files);

        foreach (var header in headers)
        {
            var key = header.Key.Trim();
            if (key.Equals("Content-Type", StringComparison.OrdinalIgnoreCase) && message.Content is MultipartFormDataContent)
            {
                continue; // multipart sınırı (boundary) otomatik üretilmeli
            }

            if (message.Headers.TryAddWithoutValidation(key, header.Value))
            {
                continue;
            }

            // Content-* başlıkları içerik nesnesine aittir.
            message.Content ??= new ByteArrayContent([]);
            message.Content.Headers.Remove(key);
            if (!message.Content.Headers.TryAddWithoutValidation(key, header.Value))
            {
                throw new FormatException(L.T("execute.invalid_header", "Geçersiz header: '{name}'.", ("name", key)));
            }
        }

        AuthApplier.ApplyToHeaders(message, request.Auth);

        if (!message.Headers.Contains("User-Agent"))
        {
            message.Headers.TryAddWithoutValidation("User-Agent", UserAgent);
        }

        if (!message.Headers.Contains("Accept"))
        {
            message.Headers.TryAddWithoutValidation("Accept", "*/*");
        }

        return (message, bodyPreview);
    }

    private static (HttpContent? Content, string? Preview) BuildContent(RequestBody body, string? contentType, Dictionary<int, DecodedFile> files)
    {
        switch (body.Mode)
        {
            case BodyMode.GraphQL:
                var payload = new System.Text.Json.Nodes.JsonObject { ["query"] = body.Raw ?? string.Empty };
                if (!string.IsNullOrWhiteSpace(body.GraphqlVariables))
                {
                    try
                    {
                        payload["variables"] = System.Text.Json.Nodes.JsonNode.Parse(body.GraphqlVariables);
                    }
                    catch (System.Text.Json.JsonException)
                    {
                        throw new FormatException(L.T("execute.graphql_variables", "GraphQL değişkenleri geçerli bir JSON değil."));
                    }
                }

                var graphqlText = payload.ToJsonString();
                var graphql = new ByteArrayContent(Encoding.UTF8.GetBytes(graphqlText));
                graphql.Headers.TryAddWithoutValidation("Content-Type", contentType ?? "application/json");
                return (graphql, graphqlText);

            case BodyMode.Binary:
                if (!files.TryGetValue(ExecuteFile.BinaryIndex, out var binary))
                {
                    throw new FormatException(L.T("execute.no_file", "Gönderilecek dosya seçilmemiş."));
                }

                var binaryContent = new ByteArrayContent(binary.Bytes);
                binaryContent.Headers.TryAddWithoutValidation("Content-Type", contentType ?? binary.ContentType ?? "application/octet-stream");
                return (binaryContent, $"[dosya: {binary.FileName}, {binary.Bytes.Length:N0} bayt]");

            case BodyMode.Raw:
                var content = new ByteArrayContent(Encoding.UTF8.GetBytes(body.Raw ?? string.Empty));
                content.Headers.TryAddWithoutValidation("Content-Type", contentType ?? DefaultContentType(body.RawLanguage));
                return (content, body.Raw);

            case BodyMode.UrlEncoded:
                var pairs = body.Form
                    .Where(f => f.Enabled && !string.IsNullOrEmpty(f.Key))
                    .Select(f => new KeyValuePair<string, string>(f.Key, f.Value))
                    .ToList();
                return (new FormUrlEncodedContent(pairs), string.Join('&', pairs.Select(p => $"{Uri.EscapeDataString(p.Key)}={Uri.EscapeDataString(p.Value)}")));

            case BodyMode.FormData:
                var multipart = new MultipartFormDataContent();
                var parts = new List<string>();
                for (var i = 0; i < body.Form.Count; i++)
                {
                    var field = body.Form[i];
                    if (!field.Enabled || string.IsNullOrEmpty(field.Key))
                    {
                        continue;
                    }

                    if (field.Type == FormFieldType.File)
                    {
                        if (!files.TryGetValue(i, out var file))
                        {
                            throw new FormatException(L.T("execute.no_file_for_field", "'{name}' alanı için dosya seçilmemiş.", ("name", field.Key)));
                        }

                        var part = new ByteArrayContent(file.Bytes);
                        part.Headers.TryAddWithoutValidation("Content-Type", file.ContentType is { Length: > 0 } type ? type : "application/octet-stream");
                        multipart.Add(part, field.Key, file.FileName);
                        parts.Add($"{field.Key}: [dosya: {file.FileName}, {file.Bytes.Length:N0} bayt]");
                    }
                    else
                    {
                        multipart.Add(new StringContent(field.Value, Encoding.UTF8), field.Key);
                        parts.Add($"{field.Key}: {field.Value}");
                    }
                }

                return (multipart, string.Join('\n', parts));

            default:
                return (null, null);
        }
    }

    private static string DefaultContentType(RawLanguage language) => language switch
    {
        RawLanguage.Json => "application/json",
        RawLanguage.Xml => "application/xml",
        RawLanguage.Html => "text/html",
        RawLanguage.JavaScript => "application/javascript",
        _ => "text/plain",
    };

    private static async Task<(byte[] Bytes, bool Truncated)> ReadLimitedAsync(HttpContent content, int maxBytes, CancellationToken ct)
    {
        await using var stream = await content.ReadAsStreamAsync(ct);
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await stream.ReadAsync(chunk, ct)) > 0)
        {
            var remaining = maxBytes - (int)buffer.Length;
            if (read > remaining)
            {
                buffer.Write(chunk, 0, remaining);
                return (buffer.ToArray(), true);
            }

            buffer.Write(chunk, 0, read);
        }

        return (buffer.ToArray(), false);
    }

    private static (string Body, string Encoding) DecodeBody(byte[] bytes, MediaTypeHeaderValue? contentType)
    {
        if (bytes.Length == 0)
        {
            return (string.Empty, "text");
        }

        var media = contentType?.MediaType?.ToLowerInvariant() ?? string.Empty;
        var textual = media.StartsWith("text/", StringComparison.Ordinal)
            || media.Contains("json", StringComparison.Ordinal)
            || media.Contains("xml", StringComparison.Ordinal)
            || media.Contains("javascript", StringComparison.Ordinal)
            || media.Contains("x-www-form-urlencoded", StringComparison.Ordinal)
            || media.Contains("graphql", StringComparison.Ordinal);

        Encoding encoding = Encoding.UTF8;
        if (contentType?.CharSet is { Length: > 0 } charset)
        {
            try
            {
                encoding = Encoding.GetEncoding(charset.Trim('"'));
            }
            catch (ArgumentException)
            {
                encoding = Encoding.UTF8;
            }
        }

        if (textual)
        {
            return (encoding.GetString(bytes), "text");
        }

        // Content-Type yoksa ya da bilinmiyorsa: geçerli UTF-8 ise metin say, değilse base64 gönder.
        if (media.Length == 0 || media == "application/octet-stream")
        {
            try
            {
                return (new UTF8Encoding(false, throwOnInvalidBytes: true).GetString(bytes), "text");
            }
            catch (DecoderFallbackException)
            {
                return (Convert.ToBase64String(bytes), "base64");
            }
        }

        return (Convert.ToBase64String(bytes), "base64");
    }

    private static List<HttpHeaderDto> CollectHeaders(HttpResponseMessage response)
    {
        var headers = new List<HttpHeaderDto>();
        foreach (var (key, values) in response.Headers.Concat(response.Content.Headers))
        {
            headers.AddRange(values.Select(v => new HttpHeaderDto(key, v)));
        }

        return headers;
    }

    private (string Code, string Message) Describe(HttpRequestException ex, Uri uri) =>
        NetworkErrors.Describe(ex, uri, options.CurrentValue.SslErrorHint);
}
