using Apivator.Application.Common;
using Apivator.Domain.Audit;

namespace Apivator.Application.Audit;

public sealed class AuditOptions
{
    public const string SectionName = "Audit";

    /// <summary>Kayıtlar bu kadar gün saklanır; 0 ise silinmez.</summary>
    public int RetentionDays { get; set; } = 365;

    /// <summary>Tek dışa aktarmada en fazla satır.</summary>
    public int MaxExportRows { get; set; } = 100_000;
}

/// <param name="Action">Tam olay kodu (<c>member.role_changed</c>) ya da kategori (<c>member</c>).</param>
/// <param name="Search">Kişi adı/e-postası ya da hedef adında geçen metin.</param>
/// <param name="Cursor">Önceki sayfanın <see cref="AuditPageDto.NextCursor"/> değeri.</param>
public sealed record AuditQuery(
    DateTimeOffset? From = null,
    DateTimeOffset? To = null,
    string? Action = null,
    Guid? ActorId = null,
    Guid? WorkspaceId = null,
    string? Search = null,
    string? Cursor = null,
    int? Limit = null);

public sealed record AuditEntryDto(
    Guid Id,
    DateTimeOffset CreatedAt,
    string Action,
    Guid? ActorId,
    string ActorName,
    string? ActorEmail,
    bool ViaApiKey,
    string? IpAddress,
    string? Device,
    string TargetType,
    Guid? TargetId,
    string TargetName,
    Guid? WorkspaceId,
    string? WorkspaceName,
    IReadOnlyDictionary<string, string> Data);

/// <param name="RetentionDays">0 ise kayıtlar silinmez.</param>
public sealed record AuditPageDto(IReadOnlyList<AuditEntryDto> Items, string? NextCursor, int RetentionDays);

public enum AuditExportFormat
{
    Csv,
    Json,
}

public interface IAuditService
{
    /// <summary>Organizasyon sahibi ve yöneticileri görebilir; en yeni önce, sayfalı.</summary>
    Task<Result<AuditPageDto>> ListAsync(Guid organizationId, AuditQuery query, Guid userId, CancellationToken ct = default);

    /// <summary>
    /// Yetkiyi kontrol eder, dışa aktarmayı denetim kaydına yazar ve filtreye uyan kayıtları (en eski önce) akıtır.
    /// </summary>
    Task<Result<IAsyncEnumerable<AuditEntryDto>>> ExportAsync(Guid organizationId, AuditQuery query, AuditExportFormat format, Guid userId, CancellationToken ct = default);
}

/// <summary>
/// Varlık değişikliği olmayan olayları (yönetici işlemleri, dışa aktarma, SSO girişi) denetim kaydına ekler.
/// Varlık değişiklikleri (üyelik, rol, workspace, yayın…) kaydetme anında otomatik yazılır.
/// Kayıt çağıranın SaveChanges'i ile yazılır. Kişisel organizasyonlarda kayıt tutulmaz.
/// </summary>
public interface IAuditLog
{
    // Çağıranlar ct parametresini konumsal veriyor; yeni isteğe bağlı parametreler uyumluluk için sona eklendi.
    [System.Diagnostics.CodeAnalysis.SuppressMessage("Design", "CA1068")]
    Task RecordAsync(
        Guid organizationId,
        string action,
        string targetType,
        Guid? targetId,
        string targetName,
        IReadOnlyDictionary<string, string?>? data = null,
        AuditActor? actor = null,
        CancellationToken ct = default,
        Guid? workspaceId = null,
        string? workspaceName = null);
}
