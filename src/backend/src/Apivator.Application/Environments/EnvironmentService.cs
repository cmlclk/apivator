using Apivator.Application.Abstractions;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Workspaces;
using Apivator.Domain.Environments;
using Apivator.Domain.Variables;
using Apivator.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Application.Environments;

internal sealed class EnvironmentService(IApplicationDbContext db, IWorkspaceAccess access, TimeProvider clock) : IEnvironmentService
{
    private static Error NotFound => Error.NotFound("environment.not_found", L.T("environment.not_found", "Environment bulunamadı."));

    public async Task<Result<IReadOnlyList<EnvironmentDto>>> ListAsync(Guid workspaceId, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireAsync(workspaceId, userId, WorkspaceRole.Viewer, ct) is { } denied)
        {
            return denied;
        }

        var environments = await db.Environments.AsNoTracking()
            .Where(e => e.WorkspaceId == workspaceId)
            .OrderBy(e => e.Name)
            .ToListAsync(ct);
        return environments.Select(ToDto).ToList();
    }

    public async Task<Result<EnvironmentDto>> CreateAsync(Guid workspaceId, CreateEnvironmentRequest request, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireAsync(workspaceId, userId, WorkspaceRole.Editor, ct) is { } denied)
        {
            return denied;
        }

        if (NameError(request.Name) is { } invalidName)
        {
            return invalidName;
        }

        var (variables, invalid) = VariableRuleMessages.Clean(request.Variables);
        if (invalid is not null)
        {
            return Error.Validation("validation", invalid);
        }

        var environment = WorkspaceEnvironment.Create(workspaceId, request.Name, variables, userId, clock.GetUtcNow());
        db.Environments.Add(environment);
        await db.SaveChangesAsync(ct);
        return ToDto(environment);
    }

    public async Task<Result<EnvironmentDto>> UpdateAsync(Guid environmentId, UpdateEnvironmentRequest request, Guid userId, CancellationToken ct = default)
    {
        var (environment, error) = await LoadAsync(environmentId, userId, ct);
        if (error is not null)
        {
            return error;
        }

        if (NameError(request.Name) is { } invalidName)
        {
            return invalidName;
        }

        var (variables, invalid) = VariableRuleMessages.Clean(request.Variables);
        if (invalid is not null)
        {
            return Error.Validation("validation", invalid);
        }

        if (environment!.Version != request.Version)
        {
            return Error.Conflict(
                "environment.version_conflict",
                L.T("environment.version_conflict", "Bu environment siz açtıktan sonra başka biri tarafından değiştirildi. Pencereyi kapatıp tekrar açın."));
        }

        environment.Update(request.Name, variables, clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        return ToDto(environment);
    }

    public async Task<Result> DeleteAsync(Guid environmentId, Guid userId, CancellationToken ct = default)
    {
        var (environment, error) = await LoadAsync(environmentId, userId, ct);
        if (error is not null)
        {
            return error;
        }

        db.Environments.Remove(environment!);
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    public async Task<Result<GlobalsDto>> GetGlobalsAsync(Guid workspaceId, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireAsync(workspaceId, userId, WorkspaceRole.Viewer, ct) is { } denied)
        {
            return denied;
        }

        var globals = await db.Workspaces.AsNoTracking()
            .Where(w => w.Id == workspaceId)
            .Select(w => w.Globals)
            .FirstAsync(ct);
        return new GlobalsDto(workspaceId, globals);
    }

    public async Task<Result<GlobalsDto>> UpdateGlobalsAsync(Guid workspaceId, UpdateGlobalsRequest request, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireAsync(workspaceId, userId, WorkspaceRole.Editor, ct) is { } denied)
        {
            return denied;
        }

        var (variables, invalid) = VariableRuleMessages.Clean(request.Variables);
        if (invalid is not null)
        {
            return Error.Validation("validation", invalid);
        }

        var workspace = await db.Workspaces.FirstAsync(w => w.Id == workspaceId, ct);
        workspace.SetGlobals(variables);
        await db.SaveChangesAsync(ct);
        return new GlobalsDto(workspaceId, workspace.Globals);
    }

    private async Task<(WorkspaceEnvironment? Environment, Error? Error)> LoadAsync(Guid environmentId, Guid userId, CancellationToken ct)
    {
        var environment = await db.Environments.FirstOrDefaultAsync(e => e.Id == environmentId, ct);
        if (environment is null)
        {
            return (null, NotFound);
        }

        var denied = await access.RequireAsync(environment.WorkspaceId, userId, WorkspaceRole.Editor, ct);
        return denied is null ? (environment, null) : (null, denied == WorkspaceAccess.NotFound ? NotFound : denied);
    }

    private static Error? NameError(string? name) =>
        string.IsNullOrWhiteSpace(name)
            ? Error.Validation("validation", L.T("environment.name_required", "Environment adı boş olamaz."))
            : name.Trim().Length > WorkspaceEnvironment.NameMaxLength
                ? Error.Validation("validation", L.T("environment.name_max_length", "Environment adı en fazla {max} karakter olabilir.", ("max", WorkspaceEnvironment.NameMaxLength)))
                : null;

    private static EnvironmentDto ToDto(WorkspaceEnvironment e) =>
        new(e.Id, e.WorkspaceId, e.Name, e.Variables, e.Version, e.UpdatedAt);
}
