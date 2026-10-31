using Apivator.Domain.Common;

namespace Apivator.Domain.Audit;

/// <summary>
/// Organizasyonun denetim kaydındaki tek olay: kim, ne zaman, nereden, neyi yaptı. Yalnızca eklenir; değiştirilmez.
/// Adlar olay anındaki hâliyle saklanır, böylece kişi, takım ya da workspace sonradan silinse de kayıt okunur kalır.
/// </summary>
public sealed class AuditEntry : Entity
{
    public const int ActionMaxLength = 60;
    public const int NameMaxLength = 200;
    public const int EmailMaxLength = 256;
    public const int DeviceMaxLength = 120;
    public const int IpAddressMaxLength = 64;
    public const int DataValueMaxLength = 500;

    private AuditEntry()
    {
        Action = string.Empty;
        ActorName = string.Empty;
        TargetType = string.Empty;
        TargetName = string.Empty;
    }

    public Guid OrganizationId { get; private set; }

    /// <summary>Olay bir workspace'e aitse (workspace üyeliği, collection erişimi, mock…).</summary>
    public Guid? WorkspaceId { get; private set; }

    public string? WorkspaceName { get; private set; }

    /// <summary>Kararlı olay kodu, ör. <c>member.role_changed</c> (bkz. <see cref="AuditActions"/>).</summary>
    public string Action { get; private set; }

    /// <summary>İşlemi yapan; sistem işlemlerinde (ör. zamanlanmış görev) null.</summary>
    public Guid? ActorId { get; private set; }

    public string ActorName { get; private set; }

    public string? ActorEmail { get; private set; }

    /// <summary>İşlem bir API anahtarıyla yapıldıysa (CLI, CI).</summary>
    public Guid? ApiKeyId { get; private set; }

    public string? IpAddress { get; private set; }

    /// <summary>"Chrome · Windows", "Apivator Masaüstü" gibi kısa cihaz adı.</summary>
    public string? Device { get; private set; }

    /// <summary>Hedefin türü: organization, member, team, workspace, collection, mock, docs, monitor, api_key, sso…</summary>
    public string TargetType { get; private set; }

    public Guid? TargetId { get; private set; }

    public string TargetName { get; private set; }

    /// <summary>Olaya özgü ek bilgi (eski/yeni rol, e-posta, görünürlük…). Gizli değer yazılmaz.</summary>
    public IReadOnlyDictionary<string, string> Data { get; private set; } = new Dictionary<string, string>();

    public DateTimeOffset CreatedAt { get; private set; }

    public static AuditEntry Create(
        Guid organizationId,
        string action,
        AuditActor actor,
        string targetType,
        Guid? targetId,
        string targetName,
        DateTimeOffset now,
        Guid? workspaceId = null,
        string? workspaceName = null,
        IReadOnlyDictionary<string, string?>? data = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(action);
        ArgumentException.ThrowIfNullOrWhiteSpace(targetType);

        return new AuditEntry
        {
            OrganizationId = organizationId,
            WorkspaceId = workspaceId,
            WorkspaceName = Clip(workspaceName, NameMaxLength),
            Action = Clip(action, ActionMaxLength)!,
            ActorId = actor.UserId,
            ActorName = Clip(string.IsNullOrWhiteSpace(actor.Name) ? "Sistem" : actor.Name, NameMaxLength)!,
            ActorEmail = Clip(actor.Email, EmailMaxLength),
            ApiKeyId = actor.ApiKeyId,
            IpAddress = Clip(actor.IpAddress, IpAddressMaxLength),
            Device = Clip(actor.Device, DeviceMaxLength),
            TargetType = Clip(targetType, ActionMaxLength)!,
            TargetId = targetId,
            TargetName = Clip(string.IsNullOrWhiteSpace(targetName) ? "—" : targetName, NameMaxLength)!,
            Data = (data ?? new Dictionary<string, string?>())
                .Where(p => !string.IsNullOrEmpty(p.Value))
                .ToDictionary(p => p.Key, p => Clip(p.Value, DataValueMaxLength)!, StringComparer.Ordinal),
            CreatedAt = now,
        };
    }

    private static string? Clip(string? value, int max) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Length > max ? value[..max] : value;
}

/// <summary>İşlemi yapan kişi ve istemcisi (olay anındaki hâliyle).</summary>
public sealed record AuditActor(Guid? UserId, string? Name, string? Email, Guid? ApiKeyId = null, string? IpAddress = null, string? Device = null)
{
    public static readonly AuditActor System = new(null, "Sistem", null);
}
