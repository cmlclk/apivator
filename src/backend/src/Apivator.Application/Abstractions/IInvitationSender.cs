namespace Apivator.Application.Abstractions;

public sealed record InvitationEmail(string To, string OrganizationName, string InvitedBy, string? WorkspaceName, string Token, string? Language = null);

/// <summary>Davet e-postasını gönderir (bağlantı uygulamanın genel adresiyle kurulur).</summary>
public interface IInvitationSender
{
    Task SendAsync(InvitationEmail invitation, CancellationToken ct = default);
}
