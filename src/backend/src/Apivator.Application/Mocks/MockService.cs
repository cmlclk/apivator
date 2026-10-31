using Apivator.Application.Abstractions;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Workspaces;
using Apivator.Domain.Collections;
using Apivator.Domain.Mocks;
using Apivator.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Application.Mocks;

public sealed record MockServerDto(
    Guid Id,
    Guid WorkspaceId,
    Guid CollectionId,
    string CollectionName,
    Guid? EnvironmentId,
    string Name,
    string Key,
    string Path,
    bool IsPrivate,
    int DelayMs,
    bool Enabled,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record CreateMockRequest(Guid CollectionId, string Name, Guid? EnvironmentId = null, bool IsPrivate = false, int DelayMs = 0);

public sealed record UpdateMockRequest(string Name, Guid? EnvironmentId, bool IsPrivate, int DelayMs, bool Enabled);

public sealed record MockCallDto(
    Guid Id,
    DateTimeOffset At,
    string Method,
    string Path,
    int Status,
    Guid? ExampleId,
    string? MatchedName,
    string? Error,
    int DurationMs,
    IReadOnlyList<KeyValueItem> RequestHeaders,
    string RequestBody);

/// <summary>Mock'un sunduğu bir uç nokta: bir örnek ve onu getiren method + yol.</summary>
public sealed record MockRouteDto(Guid ExampleId, Guid RequestId, string RequestName, string ExampleName, string Method, string Path, int Status);

public interface IMockService
{
    Task<Result<IReadOnlyList<MockServerDto>>> ListAsync(Guid workspaceId, Guid userId, CancellationToken ct = default);

    Task<Result<MockServerDto>> CreateAsync(Guid workspaceId, CreateMockRequest request, Guid userId, CancellationToken ct = default);

    Task<Result<MockServerDto>> UpdateAsync(Guid mockId, UpdateMockRequest request, Guid userId, CancellationToken ct = default);

    Task<Result<MockServerDto>> RegenerateKeyAsync(Guid mockId, Guid userId, CancellationToken ct = default);

    Task<Result> DeleteAsync(Guid mockId, Guid userId, CancellationToken ct = default);

    /// <summary>En yeniden eskiye; <paramref name="before"/> verilirse o kayıttan öncekiler.</summary>
    Task<Result<IReadOnlyList<MockCallDto>>> CallsAsync(Guid mockId, Guid userId, int limit = 100, Guid? before = null, CancellationToken ct = default);

    Task<Result> ClearCallsAsync(Guid mockId, Guid userId, CancellationToken ct = default);

    /// <summary>Mock'un yanıt verdiği method ve yollar (collection sırasıyla).</summary>
    Task<Result<IReadOnlyList<MockRouteDto>>> RoutesAsync(Guid mockId, Guid userId, CancellationToken ct = default);
}

internal sealed class MockService(IApplicationDbContext db, IWorkspaceAccess access, MockSource source, TimeProvider clock) : IMockService
{
    private static Error MockNotFound => Error.NotFound("mock.not_found", L.T("mock.not_found", "Mock bulunamadı."));
    private static Error CollectionNotFound => Error.NotFound("collection.not_found", L.T("collection.not_found", "Collection bulunamadı."));
    private static Error EnvironmentNotFound => Error.Validation("mock.environment", L.T("mock.environment", "Environment bu workspace'te değil."));

    public async Task<Result<IReadOnlyList<MockServerDto>>> ListAsync(Guid workspaceId, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireAsync(workspaceId, userId, WorkspaceRole.Viewer, ct) is { } denied)
        {
            return denied;
        }

        var rows = await db.MockServers.AsNoTracking()
            .Where(m => m.WorkspaceId == workspaceId)
            .Join(db.Collections, m => m.CollectionId, c => c.Id, (m, c) => new { Mock = m, c.Name })
            .OrderBy(x => x.Mock.CreatedAt)
            .ToListAsync(ct);
        return rows.Select(r => ToDto(r.Mock, r.Name)).ToList();
    }

    public async Task<Result<MockServerDto>> CreateAsync(Guid workspaceId, CreateMockRequest request, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireAsync(workspaceId, userId, WorkspaceRole.Editor, ct) is { } denied)
        {
            return denied;
        }

        var collection = await db.Collections.AsNoTracking().FirstOrDefaultAsync(c => c.Id == request.CollectionId && c.WorkspaceId == workspaceId, ct);
        if (collection is null)
        {
            return CollectionNotFound;
        }

        if (await ValidateAsync(workspaceId, request.Name, request.EnvironmentId, request.DelayMs, ct) is { } invalid)
        {
            return invalid;
        }

        if (await db.MockServers.CountAsync(m => m.WorkspaceId == workspaceId, ct) >= MockServer.MaxPerWorkspace)
        {
            return Error.Validation("mock.limit", L.T("mock.limit", "Bir workspace'te en fazla {max} mock olabilir.", ("max", MockServer.MaxPerWorkspace)));
        }

        var mock = MockServer.Create(workspaceId, collection.Id, request.EnvironmentId, request.Name, request.IsPrivate, request.DelayMs, userId, clock.GetUtcNow());
        db.MockServers.Add(mock);
        await db.SaveChangesAsync(ct);
        return ToDto(mock, collection.Name);
    }

    public async Task<Result<MockServerDto>> UpdateAsync(Guid mockId, UpdateMockRequest request, Guid userId, CancellationToken ct = default)
    {
        var (mock, error) = await LoadAsync(mockId, userId, WorkspaceRole.Editor, ct);
        if (error is not null)
        {
            return error;
        }

        if (await ValidateAsync(mock!.WorkspaceId, request.Name, request.EnvironmentId, request.DelayMs, ct) is { } invalid)
        {
            return invalid;
        }

        mock.Update(request.Name, request.EnvironmentId, request.IsPrivate, request.DelayMs, request.Enabled, clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        return await WithCollectionNameAsync(mock, ct);
    }

    public async Task<Result<MockServerDto>> RegenerateKeyAsync(Guid mockId, Guid userId, CancellationToken ct = default)
    {
        var (mock, error) = await LoadAsync(mockId, userId, WorkspaceRole.Editor, ct);
        if (error is not null)
        {
            return error;
        }

        mock!.RegenerateKey(clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        return await WithCollectionNameAsync(mock, ct);
    }

    public async Task<Result> DeleteAsync(Guid mockId, Guid userId, CancellationToken ct = default)
    {
        var (mock, error) = await LoadAsync(mockId, userId, WorkspaceRole.Editor, ct);
        if (error is not null)
        {
            return error;
        }

        db.MockServers.Remove(mock!);
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    public async Task<Result<IReadOnlyList<MockCallDto>>> CallsAsync(Guid mockId, Guid userId, int limit = 100, Guid? before = null, CancellationToken ct = default)
    {
        var (mock, error) = await LoadAsync(mockId, userId, WorkspaceRole.Viewer, ct);
        if (error is not null)
        {
            return error;
        }

        var query = db.MockCalls.AsNoTracking().Where(c => c.MockServerId == mock!.Id);
        if (before is { } b && await db.MockCalls.AsNoTracking().Where(c => c.Id == b).Select(c => (DateTimeOffset?)c.At).FirstOrDefaultAsync(ct) is { } at)
        {
            query = query.Where(c => c.At < at);
        }

        var calls = await query
            .OrderByDescending(c => c.At).ThenByDescending(c => c.Id)
            .Take(Math.Clamp(limit, 1, 200))
            .ToListAsync(ct);
        return calls.Select(c => new MockCallDto(
            c.Id, c.At, c.Method, c.Path, c.Status, c.ExampleId, c.MatchedName, c.Error, c.DurationMs, c.RequestHeaders, c.RequestBody)).ToList();
    }

    public async Task<Result> ClearCallsAsync(Guid mockId, Guid userId, CancellationToken ct = default)
    {
        var (mock, error) = await LoadAsync(mockId, userId, WorkspaceRole.Editor, ct);
        if (error is not null)
        {
            return error;
        }

        await db.MockCalls.Where(c => c.MockServerId == mock!.Id).ExecuteDeleteAsync(ct);
        return Result.Success();
    }

    public async Task<Result<IReadOnlyList<MockRouteDto>>> RoutesAsync(Guid mockId, Guid userId, CancellationToken ct = default)
    {
        var (mock, error) = await LoadAsync(mockId, userId, WorkspaceRole.Viewer, ct);
        if (error is not null)
        {
            return error;
        }

        var lookup = await source.LookupAsync(mock!, ct);
        var candidates = await source.CandidatesAsync(mock!.CollectionId, ct);
        return candidates.Select(c =>
        {
            var (segments, query) = MockMatcher.ParseTemplate(c.Request.Url, lookup);
            var path = "/" + string.Join('/', segments);
            if (query.Count > 0)
            {
                path += "?" + string.Join('&', query.Select(q => q.Value.Length > 0 ? $"{q.Key}={q.Value}" : q.Key));
            }

            return new MockRouteDto(c.ExampleId, c.RequestId, c.RequestName, c.ExampleName, c.Request.Method.ToUpperInvariant(), path, c.Status);
        }).ToList();
    }

    private async Task<Error?> ValidateAsync(Guid workspaceId, string? name, Guid? environmentId, int delayMs, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Trim().Length > MockServer.NameMaxLength)
        {
            return Error.Validation("validation", L.T("mock.name_length", "Mock adı 1–{max} karakter olmalı.", ("max", MockServer.NameMaxLength)));
        }

        if (delayMs is < 0 or > MockServer.MaxDelayMs)
        {
            return Error.Validation("validation", L.T("mock.delay_range", "Gecikme 0 ile {max} ms arasında olmalı.", ("max", MockServer.MaxDelayMs)));
        }

        if (environmentId is { } envId && !await db.Environments.AnyAsync(e => e.Id == envId && e.WorkspaceId == workspaceId, ct))
        {
            return EnvironmentNotFound;
        }

        return null;
    }

    private async Task<(MockServer? Mock, Error? Error)> LoadAsync(Guid mockId, Guid userId, WorkspaceRole minimum, CancellationToken ct)
    {
        var mock = await db.MockServers.FirstOrDefaultAsync(m => m.Id == mockId, ct);
        if (mock is null)
        {
            return (null, MockNotFound);
        }

        var denied = await access.RequireAsync(mock.WorkspaceId, userId, minimum, ct);
        return denied is null ? (mock, null) : (null, denied == WorkspaceAccess.NotFound ? MockNotFound : denied);
    }

    private async Task<MockServerDto> WithCollectionNameAsync(MockServer mock, CancellationToken ct) =>
        ToDto(mock, await db.Collections.Where(c => c.Id == mock.CollectionId).Select(c => c.Name).FirstOrDefaultAsync(ct) ?? string.Empty);

    internal static MockServerDto ToDto(MockServer m, string collectionName) => new(
        m.Id, m.WorkspaceId, m.CollectionId, collectionName, m.EnvironmentId, m.Name, m.Key, MockPaths.For(m.Key),
        m.IsPrivate, m.DelayMs, m.Enabled, m.CreatedAt, m.UpdatedAt);
}

public static class MockPaths
{
    public const string Prefix = "/mock";

    public static string For(string key) => $"{Prefix}/{key}";
}
