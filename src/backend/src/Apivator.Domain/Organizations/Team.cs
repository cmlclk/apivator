using Apivator.Domain.Common;

namespace Apivator.Domain.Organizations;

/// <summary>Organizasyon içindeki kullanıcı grubu; workspace'e takım olarak eklenince tüm üyeler aynı rolü alır.</summary>
public sealed class Team : Entity
{
    public const int NameMaxLength = 80;

    private readonly List<TeamMember> _members = [];

    private Team()
    {
        Name = string.Empty;
    }

    public Guid OrganizationId { get; private set; }

    public string Name { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public IReadOnlyCollection<TeamMember> Members => _members;

    public static Team Create(Guid organizationId, string name, DateTimeOffset now) => new()
    {
        OrganizationId = organizationId,
        Name = Clean(name),
        CreatedAt = now,
    };

    public void Rename(string name) => Name = Clean(name);

    /// <summary>Zaten üyeyse bir şey yapmaz.</summary>
    public void AddMember(Guid userId, DateTimeOffset now)
    {
        if (_members.All(m => m.UserId != userId))
        {
            _members.Add(new TeamMember(Id, userId, now));
        }
    }

    public bool RemoveMember(Guid userId) => _members.RemoveAll(m => m.UserId == userId) > 0;

    private static string Clean(string name)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var trimmed = name.Trim();
        return trimmed.Length > NameMaxLength ? trimmed[..NameMaxLength] : trimmed;
    }
}

public sealed class TeamMember
{
    private TeamMember()
    {
    }

    internal TeamMember(Guid teamId, Guid userId, DateTimeOffset joinedAt)
    {
        TeamId = teamId;
        UserId = userId;
        JoinedAt = joinedAt;
    }

    public Guid TeamId { get; private set; }

    public Guid UserId { get; private set; }

    public DateTimeOffset JoinedAt { get; private set; }
}
