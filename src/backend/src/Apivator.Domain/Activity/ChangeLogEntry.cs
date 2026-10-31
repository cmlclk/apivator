using System.Text.Json.Serialization;
using Apivator.Domain.Common;

namespace Apivator.Domain.Activity;

[JsonConverter(typeof(JsonStringEnumConverter<ChangeTarget>))]
public enum ChangeTarget
{
    Collection,
    Folder,
    Request,
    Environment,
    Example,
}

[JsonConverter(typeof(JsonStringEnumConverter<ChangeAction>))]
public enum ChangeAction
{
    Created,
    Updated,
    Renamed,
    Moved,
    Deleted,
    Restored,
}

/// <summary>
/// Bir workspace'teki tek bir değişiklik: kim, ne zaman, neyi. İstek, environment ve collection ayarları için
/// değişiklik sonrası hâlin anlık görüntüsü (jsonb) saklanır; fark ve eski sürüme dönme bundan hesaplanır.
/// </summary>
public sealed class ChangeLogEntry : Entity
{
    public const int NameMaxLength = 200;

    /// <summary>Hedef başına saklanan en fazla sürüm; eskiler kaydederken budanır.</summary>
    public const int MaxSnapshotsPerTarget = 100;

    private ChangeLogEntry()
    {
        TargetName = string.Empty;
        UserName = string.Empty;
    }

    public Guid WorkspaceId { get; private set; }

    public ChangeTarget TargetType { get; private set; }

    public Guid TargetId { get; private set; }

    /// <summary>İstek ve klasörlerde bağlı olduğu collection (etkinlik akışında bağlam için).</summary>
    public Guid? CollectionId { get; private set; }

    /// <summary>Değişiklik anındaki ad; hedef silinse de akışta okunur kalır.</summary>
    public string TargetName { get; private set; }

    public ChangeAction Action { get; private set; }

    /// <summary>Yeniden adlandırmada eski ad gibi kısa bir ek bilgi.</summary>
    public string? Detail { get; private set; }

    public Guid? UserId { get; private set; }

    public string UserName { get; private set; }

    /// <summary>İsteklerde ve environment'larda kaydedilen sürüm numarası.</summary>
    public int? Version { get; private set; }

    /// <summary>Değişiklikten sonraki hâl (JSON). Silmede silinmeden önceki hâl.</summary>
    public string? Snapshot { get; private set; }

    /// <summary>Toplu işlemin parçası (içe aktarma, kopyalama): geçmişte durur, etkinlik akışında gösterilmez.</summary>
    public bool Quiet { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public static ChangeLogEntry Create(
        Guid workspaceId,
        ChangeTarget targetType,
        Guid targetId,
        Guid? collectionId,
        string targetName,
        ChangeAction action,
        string? detail,
        Guid? userId,
        string? userName,
        int? version,
        string? snapshot,
        bool quiet,
        DateTimeOffset now) => new()
        {
            WorkspaceId = workspaceId,
            TargetType = targetType,
            TargetId = targetId,
            CollectionId = collectionId,
            TargetName = Truncate(targetName, NameMaxLength),
            Action = action,
            Detail = detail is null ? null : Truncate(detail, NameMaxLength),
            UserId = userId,
            UserName = Truncate(string.IsNullOrWhiteSpace(userName) ? "Sistem" : userName, NameMaxLength),
            Version = version,
            Snapshot = snapshot,
            Quiet = quiet,
            CreatedAt = now,
        };

    private static string Truncate(string value, int max) => value.Length > max ? value[..max] : value;
}
