using Apivator.Domain.Audit;

namespace Apivator.Infrastructure.Audit;

/// <summary>Bir kaydetmedeki denetim olaylarını biriktirir; kişisel organizasyonlardakileri atlar.</summary>
internal sealed class AuditWriter(AuditLookup lookup, AuditActor actor, DateTimeOffset now)
{
    public AuditLookup Lookup => lookup;

    public List<AuditEntry> Entries { get; } = [];

    public async Task OrganizationAsync(Guid organizationId, string action, string targetType, Guid? targetId, string targetName, params (string Key, string? Value)[] data)
    {
        if (await lookup.IsAuditedAsync(organizationId))
        {
            Entries.Add(AuditEntry.Create(organizationId, action, actor, targetType, targetId, targetName, now, data: ToDictionary(data)));
        }
    }

    public async Task WorkspaceAsync(Guid workspaceId, string action, string targetType, Guid? targetId, string targetName, params (string Key, string? Value)[] data)
    {
        if (await lookup.WorkspaceAsync(workspaceId) is { } workspace && await lookup.IsAuditedAsync(workspace.OrganizationId))
        {
            Entries.Add(AuditEntry.Create(
                workspace.OrganizationId, action, actor, targetType, targetId, targetName, now, workspaceId, workspace.Name, ToDictionary(data)));
        }
    }

    private static Dictionary<string, string?> ToDictionary((string Key, string? Value)[] data) =>
        data.Where(d => d.Value is not null).ToDictionary(d => d.Key, d => d.Value, StringComparer.Ordinal);
}
