using Apivator.Domain.Common;
using Apivator.Domain.Workspaces;

namespace Apivator.Domain.Organizations;

/// <summary>
/// Organizasyona e-posta ile davet. Token yalnızca hash'i ile saklanır; düz hâli yalnızca e-postadaki bağlantıda
/// bulunur. İsteğe bağlı olarak kabul edilince belirli bir workspace'e de rolüyle eklenir.
/// </summary>
public sealed class Invitation : Entity
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromDays(7);

    private Invitation()
    {
        Email = string.Empty;
        TokenHash = string.Empty;
    }

    public Guid OrganizationId { get; private set; }

    /// <summary>Küçük harfe çevrilmiş e-posta.</summary>
    public string Email { get; private set; }

    public OrganizationRole Role { get; private set; }

    public Guid? WorkspaceId { get; private set; }

    public WorkspaceRole? WorkspaceRole { get; private set; }

    public string TokenHash { get; private set; }

    public Guid InvitedById { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset ExpiresAt { get; private set; }

    public DateTimeOffset? AcceptedAt { get; private set; }

    public Guid? AcceptedById { get; private set; }

    public DateTimeOffset? RevokedAt { get; private set; }

    /// <summary>Davet e-postasının dili (gönderenin seçimi); null ise organizasyonun varsayılan dili.</summary>
    public string? Language { get; private set; }

    public static Invitation Create(
        Guid organizationId,
        string email,
        OrganizationRole role,
        Guid? workspaceId,
        WorkspaceRole? workspaceRole,
        string tokenHash,
        Guid invitedById,
        DateTimeOffset now,
        string? language = null)
    {
        if (role == OrganizationRole.Owner)
        {
            throw new ArgumentException("Davetle sahip (Owner) atanamaz.", nameof(role));
        }

        return new Invitation
        {
            OrganizationId = organizationId,
            Email = NormalizeEmail(email),
            Role = role,
            WorkspaceId = workspaceId,
            WorkspaceRole = workspaceId is null ? null : workspaceRole ?? Workspaces.WorkspaceRole.Editor,
            TokenHash = tokenHash,
            InvitedById = invitedById,
            CreatedAt = now,
            ExpiresAt = now + Lifetime,
            Language = language,
        };
    }

    public static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();

    public bool IsPending(DateTimeOffset now) => AcceptedAt is null && RevokedAt is null && ExpiresAt > now;

    public void Accept(Guid userId, DateTimeOffset now)
    {
        if (!IsPending(now))
        {
            throw new InvalidOperationException("Davet artık geçerli değil.");
        }

        AcceptedAt = now;
        AcceptedById = userId;
    }

    public void Revoke(DateTimeOffset now) => RevokedAt ??= now;
}
