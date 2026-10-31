using Apivator.Domain.Organizations;
using Apivator.Domain.Workspaces;

namespace Apivator.Application.Account;

public static class AccountLimits
{
    /// <summary>Profil görseli üst sınırı (istemci yüklemeden önce 256×256'ya küçültür).</summary>
    public const int AvatarMaxBytes = 512 * 1024;
}

/// <summary>Girişin yapıldığı istemci; oturum listesinde cihazı tanımak için saklanır.</summary>
public sealed record ClientInfo(string? UserAgent, string? IpAddress, string? App)
{
    public static readonly ClientInfo Unknown = new(null, null, null);
}

public sealed record ProfileWorkspaceDto(Guid Id, string Name, WorkspaceType Type, WorkspaceRole Role);

public sealed record ProfileOrganizationDto(
    Guid Id,
    string Name,
    bool IsPersonal,
    OrganizationRole Role,
    int MemberCount,
    IReadOnlyList<ProfileWorkspaceDto> Workspaces);

public sealed record ProfileDto(
    Guid Id,
    string Email,
    string DisplayName,
    bool EmailConfirmed,
    string? PendingEmail,
    DateTimeOffset CreatedAt,
    long? AvatarVersion,
    IReadOnlyList<ProfileOrganizationDto> Organizations);

public sealed record UpdateProfileRequest(string DisplayName);

public sealed record ChangeEmailRequest(string NewEmail, string Password);

public sealed record ConfirmEmailChangeRequest(Guid UserId, string Email, string Token);

public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);

/// <param name="Device">Tarayıcı ve işletim sistemi (ör. "Chrome · Windows") ya da "Apivator Masaüstü · Windows".</param>
/// <param name="App">"web", "desktop" ya da "cli".</param>
public sealed record SessionDto(
    Guid Id,
    string Device,
    string App,
    string? IpAddress,
    DateTimeOffset StartedAt,
    DateTimeOffset LastUsedAt,
    bool Current);

public sealed record PreferencesDto(
    string Theme,
    Guid? DefaultWorkspaceId,
    bool EmailMentions,
    bool EmailMergeRequests,
    bool EmailMonitorAlerts,
    string? Language = null,
    bool SaveHistoryResponses = false);

public sealed record OrganizationRefDto(Guid Id, string Name, int MemberCount);

/// <summary>
/// Hesap silinirse ne olur: <see cref="MustTransfer"/> boş değilse silme yapılamaz (önce sahiplik devredilmeli);
/// <see cref="WillDelete"/> içindeki organizasyonlarda başka üye yok, hesapla birlikte silinir.
/// </summary>
public sealed record AccountDeletionCheckDto(
    IReadOnlyList<OrganizationRefDto> MustTransfer,
    IReadOnlyList<OrganizationRefDto> WillDelete);

public sealed record DeleteAccountRequest(string Password);

public sealed record ConfirmAccountDeletionRequest(Guid UserId, string Token);

public sealed record AccountExportFile(string FileName, byte[] Content);

public sealed record AvatarFile(string ContentType, byte[] Data, long Version);
