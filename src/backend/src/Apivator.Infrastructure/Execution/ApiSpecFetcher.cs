using System.Net;
using System.Text;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Import;
using Microsoft.Extensions.Options;

namespace Apivator.Infrastructure.Execution;

/// <summary>
/// Belgeyi adresinden bulup çeker. Sıra: verilen adres belgeyse o; Swagger UI / ReDoc / Scalar sayfasıysa
/// sayfadaki (ve yüklediği script'lerdeki) belge adresi; yalnızca sunucu adresiyse bilinen yollar. Kullanıcının
/// verdiği header'lar yalnızca verilen adresle aynı sunucuya gönderilir.
/// </summary>
internal sealed class ApiSpecFetcher(IExecutionHttpClientSource clients, IOptionsMonitor<ProxyOptions> options) : IApiSpecFetcher
{
    private static readonly TimeSpan TotalTimeout = TimeSpan.FromMinutes(2);

    public async Task<Result<SpecFetchResult>> FetchAsync(SpecFetchRequest request, CancellationToken ct = default)
    {
        if (ParseUrl(request.Url) is not { } start)
        {
            return Error.Validation("spec.url", L.T("spec_fetch.url", "Geçerli bir http(s) adresi girin."));
        }

        using var total = CancellationTokenSource.CreateLinkedTokenSource(ct);
        total.CancelAfter(TotalTimeout);
        var session = new Session(clients.CreateClient(), options.CurrentValue, start, request.Headers ?? []);
        try
        {
            return await session.RunAsync(total.Token);
        }
        catch (FetchFailed failed)
        {
            return failed.Error;
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return Error.Validation("spec.timeout", L.T("spec_fetch.search_timeout", "Belge aranırken süre doldu."));
        }
    }

    /// <summary>Şemasız adreslere localhost/IP için http, diğerlerine https eklenir.</summary>
    internal static Uri? ParseUrl(string text)
    {
        text = text.Trim();
        if (text.Length == 0)
        {
            return null;
        }

        if (!text.Contains("://", StringComparison.Ordinal))
        {
            var host = text.Split('/', ':')[0];
            var local = host is "localhost" || IPAddress.TryParse(host, out _) || host.EndsWith(".local", StringComparison.OrdinalIgnoreCase);
            text = (local ? "http://" : "https://") + text;
        }

        return Uri.TryCreate(text, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" ? uri : null;
    }

    private sealed class FetchFailed(Error error) : Exception(error.Message)
    {
        public Error Error { get; } = error;
    }

    private sealed record Page(Uri Uri, HttpStatusCode Status, string? ContentType, string Text)
    {
        public bool Ok => (int)Status is >= 200 and < 300;
    }

    private sealed class Session(HttpClient client, ProxyOptions settings, Uri start, IReadOnlyList<Apivator.Domain.Collections.KeyValueItem> headers)
    {
        private readonly List<string> _tried = [];

        public async Task<Result<SpecFetchResult>> RunAsync(CancellationToken ct)
        {
            var page = await GetAsync(start, ct);
            if (page.Ok)
            {
                if (IsSpec(page))
                {
                    return SpecFetchResult.Document(page.Uri.ToString(), page.Text, _tried);
                }

                if (await ExploreAsync(page, ct) is { } found)
                {
                    return found;
                }
            }
            else if (page.Status is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden && !SpecDiscovery.LooksLikeBase(start))
            {
                return Unauthorized(page);
            }

            if (SpecDiscovery.LooksLikeBase(start))
            {
                var baseUrl = start.GetLeftPart(UriPartial.Path).TrimEnd('/');
                foreach (var (path, versionsPage) in SpecDiscovery.KnownPaths)
                {
                    var candidate = await GetAsync(new Uri(baseUrl + path), ct);
                    if (candidate.Status is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                    {
                        return Unauthorized(candidate);
                    }

                    if (!candidate.Ok || !IsSpec(candidate))
                    {
                        continue;
                    }

                    // Başka sürümler de varsa (v1, v2) seçtirilir.
                    if (versionsPage is not null)
                    {
                        var choices = await VersionsAsync(new Uri(baseUrl + versionsPage), ct);
                        if (choices.Count > 1)
                        {
                            return SpecFetchResult.Select(choices, _tried);
                        }
                    }

                    return SpecFetchResult.Document(candidate.Uri.ToString(), candidate.Text, _tried);
                }
            }

            if (!page.Ok && !SpecDiscovery.LooksLikeBase(start))
            {
                return Error.Validation("spec.status", L.T("spec_fetch.status", "Adres {status} döndü.", ("status", $"{(int)page.Status} {page.Status}")));
            }

            var tried = _tried.Count > 1 ? L.T("spec_fetch.tried", " Denenen adresler: {urls}.", ("urls", string.Join(", ", _tried.Take(12)))) : string.Empty;
            return Error.Validation("spec.not_found", L.T("spec_fetch.not_found", "Bu adreste OpenAPI/Swagger belgesi bulunamadı.{tried} Belgenin ya da Swagger UI sayfasının tam adresini girin.", ("tried", tried)));
        }

        /// <summary>HTML ya da JS sayfasında belge arar.</summary>
        private async Task<Result<SpecFetchResult>?> ExploreAsync(Page page, CancellationToken ct)
        {
            var html = SpecDiscovery.IsHtml(page.Text, page.ContentType);
            if (!html && !SpecDiscovery.IsScript(page.ContentType, page.Uri))
            {
                return null;
            }

            var findings = new List<PageFindings> { SpecDiscovery.Scan(page.Text, page.Uri) };
            if (html)
            {
                foreach (var script in SpecDiscovery.Scripts(page.Text, page.Uri))
                {
                    var loaded = await GetAsync(script, ct, optional: true);
                    if (loaded.Ok)
                    {
                        findings.Add(SpecDiscovery.Scan(loaded.Text, loaded.Uri));
                    }
                }
            }

            if (findings.Select(f => f.InlineDocument).FirstOrDefault(d => d is not null) is { } inline)
            {
                return SpecFetchResult.Document(page.Uri.ToString(), inline, _tried);
            }

            var candidates = new List<SpecChoice>();
            foreach (var configUrl in findings.Select(f => f.ConfigUrl).OfType<string>().Distinct())
            {
                var config = await GetAsync(new Uri(configUrl), ct, optional: true);
                if (config.Ok)
                {
                    candidates.AddRange(SpecDiscovery.ConfigChoices(config.Text, config.Uri));
                }
            }

            if (candidates.Count == 0)
            {
                candidates.AddRange(findings.SelectMany(f => f.Candidates));
            }

            candidates = candidates.DistinctBy(c => c.Url).ToList();
            switch (candidates.Count)
            {
                case 0:
                    return null;
                case 1:
                    var document = await GetAsync(new Uri(candidates[0].Url), ct);
                    if (document.Status is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                    {
                        return Unauthorized(document);
                    }

                    if (!document.Ok || !IsSpec(document))
                    {
                        return Error.Validation(
                            "spec.not_found",
                            L.T("spec_fetch.found_but_invalid", "Sayfada belge adresi bulundu ({url}) ama {problem}.", ("url", candidates[0].Url), ("problem", document.Ok ? L.T("spec_fetch.not_a_spec", "içeriği OpenAPI/Swagger değil") : L.T("spec_fetch.returned_status", "{status} döndü", ("status", (int)document.Status)))));
                    }

                    return SpecFetchResult.Document(document.Uri.ToString(), document.Text, _tried);
                default:
                    return SpecFetchResult.Select(candidates, _tried);
            }
        }

        private async Task<List<SpecChoice>> VersionsAsync(Uri versionsPage, CancellationToken ct)
        {
            var page = await GetAsync(versionsPage, ct, optional: true);
            if (!page.Ok)
            {
                return [];
            }

            if (!SpecDiscovery.IsHtml(page.Text, page.ContentType))
            {
                return SpecDiscovery.ConfigChoices(page.Text, page.Uri);
            }

            var findings = new List<PageFindings> { SpecDiscovery.Scan(page.Text, page.Uri) };
            foreach (var script in SpecDiscovery.Scripts(page.Text, page.Uri))
            {
                var loaded = await GetAsync(script, ct, optional: true);
                if (loaded.Ok)
                {
                    findings.Add(SpecDiscovery.Scan(loaded.Text, loaded.Uri));
                }
            }

            return findings.SelectMany(f => f.Candidates).DistinctBy(c => c.Url).ToList();
        }

        private static bool IsSpec(Page page) =>
            !SpecDiscovery.IsHtml(page.Text, page.ContentType) && ApiSpec.LooksLikeSpec(page.Text);

        private static Error Unauthorized(Page page) => Error.Validation(
            "spec.unauthorized",
            L.T("spec_fetch.unauthorized", "Belge erişim istiyor ({status}). \"Erişim\" bölümüne Bearer token ya da gerekli header'ı girip tekrar deneyin.", ("status", (int)page.Status)));

        /// <summary>
        /// Adresi çeker. Bağlantı hatası (DNS, reddedildi, SSL, engellendi) aramayı durdurur; optional ise yok sayılır.
        /// </summary>
        private async Task<Page> GetAsync(Uri uri, CancellationToken ct, bool optional = false)
        {
            if (!optional)
            {
                _tried.Add(uri.ToString());
            }

            using var message = new HttpRequestMessage(HttpMethod.Get, uri);
            message.Headers.TryAddWithoutValidation("Accept", "application/json, application/yaml, text/yaml, text/html;q=0.9, */*;q=0.8");
            message.Headers.TryAddWithoutValidation("User-Agent", "Apivator");
            if (SpecDiscovery.SameOrigin(uri, start))
            {
                foreach (var header in headers.Where(h => h.Enabled && !string.IsNullOrWhiteSpace(h.Key)))
                {
                    message.Headers.Remove(header.Key);
                    message.Headers.TryAddWithoutValidation(header.Key, header.Value);
                }
            }

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(settings.TimeoutSeconds));
            try
            {
                using var response = await client.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
                var final = response.RequestMessage?.RequestUri ?? uri;
                var contentType = response.Content.Headers.ContentType?.MediaType;
                if (!response.IsSuccessStatusCode)
                {
                    return new Page(final, response.StatusCode, contentType, string.Empty);
                }

                if (response.Content.Headers.ContentLength > ApiSpec.MaxBytes)
                {
                    throw TooLarge();
                }

                await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
                using var buffer = new MemoryStream();
                var chunk = new byte[81920];
                int read;
                while ((read = await stream.ReadAsync(chunk, timeout.Token)) > 0)
                {
                    if (buffer.Length + read > ApiSpec.MaxBytes)
                    {
                        throw TooLarge();
                    }

                    buffer.Write(chunk, 0, read);
                }

                return new Page(final, response.StatusCode, contentType, Decode(buffer.ToArray(), response.Content.Headers.ContentType?.CharSet));
            }
            catch (HttpRequestException) when (optional)
            {
                return new Page(uri, HttpStatusCode.BadGateway, null, string.Empty);
            }
            catch (HttpRequestException ex)
            {
                var (code, text) = NetworkErrors.Describe(ex, uri, settings.SslErrorHint);
                throw new FetchFailed(Error.Validation($"spec.{code}", text));
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                if (optional)
                {
                    return new Page(uri, HttpStatusCode.GatewayTimeout, null, string.Empty);
                }

                throw new FetchFailed(Error.Validation("spec.timeout", L.T("spec_fetch.host_timeout", "{host} {seconds} saniye içinde yanıt vermedi.", ("host", uri.Host), ("seconds", settings.TimeoutSeconds))));
            }
        }

        private static FetchFailed TooLarge() =>
            new(Error.Validation("spec.too_large", L.T("spec_fetch.too_large", "Belge {max} MB sınırını aşıyor.", ("max", ApiSpec.MaxBytes / 1024 / 1024))));

        private static string Decode(byte[] bytes, string? charset)
        {
            Encoding encoding;
            try
            {
                encoding = string.IsNullOrWhiteSpace(charset) ? Encoding.UTF8 : Encoding.GetEncoding(charset.Trim('"'));
            }
            catch (ArgumentException)
            {
                encoding = Encoding.UTF8;
            }

            var text = encoding.GetString(bytes);
            return text.Length > 0 && text[0] == '﻿' ? text[1..] : text;
        }
    }
}
