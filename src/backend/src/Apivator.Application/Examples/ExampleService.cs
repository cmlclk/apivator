using Apivator.Application.Abstractions;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Workspaces;
using Apivator.Domain.Collections;
using Apivator.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Application.Examples;

public sealed record ExampleDto(
    Guid Id,
    Guid RequestId,
    string Name,
    int Status,
    IReadOnlyList<KeyValueItem> Headers,
    string Body,
    RequestDefinition Request,
    DateTimeOffset UpdatedAt);

/// <summary>Ağaçta gösterilmek üzere örneğin özeti.</summary>
public sealed record ExampleSummaryDto(Guid Id, Guid RequestId, string Name, int Status);

public sealed record CreateExampleRequest(
    string Name,
    int Status,
    IReadOnlyList<KeyValueItem>? Headers,
    string? Body,
    RequestDefinition? Request);

/// <summary>Boş bırakılan alanlar değişmez.</summary>
public sealed record UpdateExampleRequest(string? Name, int? Status, IReadOnlyList<KeyValueItem>? Headers, string? Body);

public interface IExampleService
{
    Task<Result<IReadOnlyList<ExampleDto>>> ListAsync(Guid requestId, Guid userId, CancellationToken ct = default);

    Task<Result<ExampleDto>> GetAsync(Guid exampleId, Guid userId, CancellationToken ct = default);

    Task<Result<ExampleDto>> CreateAsync(Guid requestId, CreateExampleRequest request, Guid userId, CancellationToken ct = default);

    Task<Result<ExampleDto>> UpdateAsync(Guid exampleId, UpdateExampleRequest request, Guid userId, CancellationToken ct = default);

    Task<Result> DeleteAsync(Guid exampleId, Guid userId, CancellationToken ct = default);
}

internal sealed class ExampleService(IApplicationDbContext db, IWorkspaceAccess access, TimeProvider clock) : IExampleService
{
    private static Error RequestNotFound => Error.NotFound("request.not_found", L.T("request.not_found", "İstek bulunamadı."));
    private static Error ExampleNotFound => Error.NotFound("example.not_found", L.T("example.not_found", "Örnek bulunamadı."));

    public async Task<Result<IReadOnlyList<ExampleDto>>> ListAsync(Guid requestId, Guid userId, CancellationToken ct = default)
    {
        if (await RequireRequestAsync(requestId, userId, WorkspaceRole.Viewer, ct) is { } denied)
        {
            return denied;
        }

        var examples = await db.Examples.AsNoTracking()
            .Where(e => e.RequestId == requestId)
            .OrderBy(e => e.SortOrder).ThenBy(e => e.CreatedAt)
            .ToListAsync(ct);
        return examples.Select(ToDto).ToList();
    }

    public async Task<Result<ExampleDto>> GetAsync(Guid exampleId, Guid userId, CancellationToken ct = default)
    {
        var (example, error) = await LoadAsync(exampleId, userId, WorkspaceRole.Viewer, ct);
        return error is not null ? error : ToDto(example!);
    }

    public async Task<Result<ExampleDto>> CreateAsync(Guid requestId, CreateExampleRequest request, Guid userId, CancellationToken ct = default)
    {
        if (await RequireRequestAsync(requestId, userId, WorkspaceRole.Editor, ct) is { } denied)
        {
            return denied;
        }

        if (Validate(request.Name, request.Body) is { } invalid)
        {
            return invalid;
        }

        var definition = request.Request
            ?? await db.Requests.Where(r => r.Id == requestId).Select(r => r.Definition).FirstAsync(ct);
        var sortOrder = await db.Examples.Where(e => e.RequestId == requestId).MaxAsync(e => (int?)e.SortOrder, ct) ?? -1;
        var example = ResponseExample.Create(
            requestId, request.Name, request.Status, request.Headers ?? [], request.Body ?? string.Empty, definition, sortOrder + 1, clock.GetUtcNow());
        db.Examples.Add(example);
        await db.SaveChangesAsync(ct);
        return ToDto(example);
    }

    public async Task<Result<ExampleDto>> UpdateAsync(Guid exampleId, UpdateExampleRequest request, Guid userId, CancellationToken ct = default)
    {
        var (example, error) = await LoadAsync(exampleId, userId, WorkspaceRole.Editor, ct);
        if (error is not null)
        {
            return error;
        }

        if (request.Name is not null || request.Body is not null)
        {
            if (Validate(request.Name ?? example!.Name, request.Body) is { } invalid)
            {
                return invalid;
            }
        }

        example!.Update(request.Name, request.Status, request.Headers, request.Body, clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        return ToDto(example);
    }

    public async Task<Result> DeleteAsync(Guid exampleId, Guid userId, CancellationToken ct = default)
    {
        var (example, error) = await LoadAsync(exampleId, userId, WorkspaceRole.Editor, ct);
        if (error is not null)
        {
            return error;
        }

        db.Examples.Remove(example!);
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    private static Error? Validate(string? name, string? body)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            return Error.Validation("validation", L.T("collection.name_required", "Ad boş olamaz."));
        }

        return body is { Length: > ResponseExample.BodyMaxLength }
            ? Error.Validation("validation", L.T("example.body_max", "Örnek yanıt en fazla {mb} MB olabilir.", ("mb", ResponseExample.BodyMaxLength / (1024 * 1024))))
            : null;
    }

    private async Task<Error?> RequireRequestAsync(Guid requestId, Guid userId, WorkspaceRole minimum, CancellationToken ct)
    {
        var collectionId = await db.Requests
            .Where(r => r.Id == requestId)
            .Select(r => (Guid?)r.CollectionId)
            .FirstOrDefaultAsync(ct);
        if (collectionId is null)
        {
            return RequestNotFound;
        }

        var denied = await access.RequireCollectionAsync(collectionId.Value, userId, minimum, ct);
        return denied is null ? null : denied == WorkspaceAccess.NotFound ? RequestNotFound : denied;
    }

    private async Task<(ResponseExample? Example, Error? Error)> LoadAsync(Guid exampleId, Guid userId, WorkspaceRole minimum, CancellationToken ct)
    {
        var example = await db.Examples.FirstOrDefaultAsync(e => e.Id == exampleId, ct);
        if (example is null)
        {
            return (null, ExampleNotFound);
        }

        var denied = await RequireRequestAsync(example.RequestId, userId, minimum, ct);
        return denied is null ? (example, null) : (null, denied == RequestNotFound ? ExampleNotFound : denied);
    }

    internal static ExampleDto ToDto(ResponseExample e) =>
        new(e.Id, e.RequestId, e.Name, e.Status, e.Headers, e.Body, e.Request, e.UpdatedAt);
}
