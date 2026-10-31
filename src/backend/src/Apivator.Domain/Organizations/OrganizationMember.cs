namespace Apivator.Domain.Organizations;

public sealed class OrganizationMember
{
    private OrganizationMember()
    {
    }

    internal OrganizationMember(Guid organizationId, Guid userId, OrganizationRole role, DateTimeOffset joinedAt)
    {
        OrganizationId = organizationId;
        UserId = userId;
        Role = role;
        JoinedAt = joinedAt;
    }

    public Guid OrganizationId { get; private set; }

    public Guid UserId { get; private set; }

    public OrganizationRole Role { get; internal set; }

    public DateTimeOffset JoinedAt { get; private set; }
}
