using System.Diagnostics;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Unicode;
using Apivator.Application.Abstractions;
using Apivator.Application.ApiKeys;
using Apivator.Application.Common.Localization;
using Apivator.Application.Execution;
using Apivator.Application.Workspaces;
using Apivator.Domain.Collections;
using Apivator.Domain.Mocks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Apivator.Application.Mocks;

public sealed class MockOptions
{
    public const string SectionName = "Mocks";

    /// <summary>Mock başına saklanan en fazla çağrı kaydı.</summary>
    public int MaxCallsPerMock { get; set; } = MockCall.MaxPerMock;

    /// <summary>Eski kayıtların temizlenme sıklığı: ortalama her N çağrıda bir.</summary>
    public int PruneEvery { get; set; } = 20;

    /// <summary>Mock'a gönderilebilecek en büyük istek body'si.</summary>
    public int MaxRequestBytes { get; set; } = 1024 * 1024;
}

/// <summary>Mock'un döneceği yanıt. <see cref="DelayMs"/> kadar beklendikten sonra yazılır.</summary>
public sealed record MockOutcome(int Status, IReadOnlyList<KeyValueItem> Headers, string Body, int DelayMs);

public interface IMockRuntime
{
    /// <summary>Gelen isteği yanıtlar ve çağrıyı kaydeder. Bilinmeyen ya da kapalı mock için 404 döner.</summary>
    Task<MockOutcome> HandleAsync(string key, MockIncoming incoming, CancellationToken ct = default);
}

internal sealed class MockRuntime(
    IApplicationDbContext db,
    MockSource source,
    IApiKeyService apiKeys,
    IWorkspaceAccess access,
    IOptions<MockOptions> options,
    TimeProvider clock) : IMockRuntime
{
    public const string ApiKeyHeader = "x-api-key";

    private static readonly JsonSerializerOptions ErrorJson = new() { Encoder = JavaScriptEncoder.Create(UnicodeRanges.All) };

    private static readonly HashSet<string> SkippedResponseHeaders = new(StringComparer.OrdinalIgnoreCase)
    {
        "content-length", "transfer-encoding", "content-encoding", "connection", "keep-alive", "upgrade",
        "proxy-connection", "trailer", "te",
    };

    private static readonly HashSet<string> RedactedRequestHeaders = new(StringComparer.OrdinalIgnoreCase)
    {
        "authorization", "proxy-authorization", "cookie", ApiKeyHeader,
    };

    public async Task<MockOutcome> HandleAsync(string key, MockIncoming incoming, CancellationToken ct = default)
    {
        var started = Stopwatch.GetTimestamp();
        var mock = MockServer.IsWellFormedKey(key)
            ? await db.MockServers.AsNoTracking().FirstOrDefaultAsync(m => m.Key == key, ct)
            : null;
        if (mock is null || !mock.Enabled)
        {
            return Failure(404, "mockNotFound", L.T("mock.runtime_not_found", "Bu adreste etkin bir mock yok."), 0);
        }

        MockOutcome outcome;
        Guid? exampleId = null;
        string? matchedName = null;
        string? error = null;
        if (mock.IsPrivate && !await AuthorizedAsync(mock, incoming, ct))
        {
            error = L.T("mock.runtime_key_invalid", "API anahtarı yok ya da geçersiz.");
            outcome = Failure(401, "mockUnauthorized", L.T("mock.runtime_private", "Bu mock gizli. İsteğe {header} header'ında workspace üyesinin API anahtarını ekleyin.", ("header", ApiKeyHeader)), mock.DelayMs);
        }
        else
        {
            var lookup = await source.LookupAsync(mock, ct);
            var candidates = await source.CandidatesAsync(mock.CollectionId, ct);
            var match = MockMatcher.Match(incoming, candidates, lookup);
            if (match is null)
            {
                error = L.T("mock.runtime_no_match_log", "Eşleşen örnek yok.");
                outcome = Failure(
                    404,
                    "mockRequestNotFoundError",
                    L.T("mock.runtime_no_match",
                        "Bu istekle eşleşen bir örnek bulunamadı: {method} {path}. Collection'da bu method ve yolla kaydedilmiş bir örnek yanıt (Example) olduğundan emin olun.",
                        ("method", incoming.Method.ToUpperInvariant()),
                        ("path", incoming.Path)),
                    mock.DelayMs);
            }
            else
            {
                var c = match.Candidate;
                exampleId = c.ExampleId;
                matchedName = $"{c.RequestName} / {c.ExampleName}";
                outcome = Respond(c, lookup, mock.DelayMs);
            }
        }

        var elapsed = (int)Stopwatch.GetElapsedTime(started).TotalMilliseconds;
        await LogAsync(mock.Id, incoming, outcome.Status, exampleId, matchedName, error, elapsed + outcome.DelayMs, ct);
        return outcome;
    }

    private async Task<bool> AuthorizedAsync(MockServer mock, MockIncoming incoming, CancellationToken ct)
    {
        if (!incoming.Headers.TryGetValue(ApiKeyHeader, out var secret) || string.IsNullOrWhiteSpace(secret))
        {
            return false;
        }

        var owner = await apiKeys.AuthenticateAsync(secret.Trim(), ct);
        return owner is not null && await access.RoleAsync(mock.WorkspaceId, owner.UserId, ct) is not null;
    }

    private static MockOutcome Respond(MockCandidate candidate, Func<string, string?> lookup, int delayMs)
    {
        var headers = candidate.Headers
            .Where(h => h.Enabled && !string.IsNullOrWhiteSpace(h.Key) && !SkippedResponseHeaders.Contains(h.Key.Trim()))
            .Select(h => new KeyValueItem(h.Key.Trim(), VariableResolver.Resolve(h.Value, lookup)))
            .ToList();
        var body = VariableResolver.Resolve(candidate.Body, lookup);
        if (!headers.Any(h => h.Key.Equals("content-type", StringComparison.OrdinalIgnoreCase)) && body.Length > 0)
        {
            var trimmed = body.TrimStart();
            headers.Add(new KeyValueItem("Content-Type", trimmed.StartsWith('{') || trimmed.StartsWith('[') ? "application/json; charset=utf-8" : "text/plain; charset=utf-8"));
        }

        return new MockOutcome(candidate.Status, headers, body, delayMs);
    }

    private static MockOutcome Failure(int status, string name, string message, int delayMs) => new(
        status,
        [new KeyValueItem("Content-Type", "application/json; charset=utf-8")],
        JsonSerializer.Serialize(new { error = new { name, message } }, ErrorJson),
        delayMs);

    private async Task LogAsync(Guid mockId, MockIncoming incoming, int status, Guid? exampleId, string? matchedName, string? error, int durationMs, CancellationToken ct)
    {
        var query = string.Join('&', incoming.Query.Select(p => $"{Uri.EscapeDataString(p.Key)}={Uri.EscapeDataString(p.Value)}"));
        var headers = incoming.Headers
            .Select(h => new KeyValueItem(h.Key, RedactedRequestHeaders.Contains(h.Key) ? "•••" : h.Value))
            .ToList();
        db.MockCalls.Add(MockCall.Create(
            mockId,
            clock.GetUtcNow(),
            incoming.Method.ToUpperInvariant(),
            query.Length > 0 ? $"{incoming.Path}?{query}" : incoming.Path,
            headers,
            incoming.Body,
            status,
            exampleId,
            matchedName,
            error,
            durationMs));
        await db.SaveChangesAsync(ct);

        var settings = options.Value;
        if (settings.PruneEvery <= 1 || Random.Shared.Next(settings.PruneEvery) == 0)
        {
            await PruneAsync(mockId, settings.MaxCallsPerMock, ct);
        }
    }

    private async Task PruneAsync(Guid mockId, int keep, CancellationToken ct)
    {
        var cutoff = await db.MockCalls.AsNoTracking()
            .Where(c => c.MockServerId == mockId)
            .OrderByDescending(c => c.At)
            .Skip(Math.Max(keep, 1) - 1)
            .Select(c => (DateTimeOffset?)c.At)
            .FirstOrDefaultAsync(ct);
        if (cutoff is { } at)
        {
            await db.MockCalls.Where(c => c.MockServerId == mockId && c.At < at).ExecuteDeleteAsync(ct);
        }
    }
}
