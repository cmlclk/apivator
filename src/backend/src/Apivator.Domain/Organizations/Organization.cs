using Apivator.Domain.Common;
using Apivator.Domain.Workspaces;

namespace Apivator.Domain.Organizations;

/// <summary>Kullanıcıları, takımları ve workspace'leri bir arada tutan en üst birim.</summary>
public sealed class Organization : Entity
{
    public const int NameMaxLength = 100;

    private readonly List<OrganizationMember> _members = [];
    private readonly List<Workspace> _workspaces = [];

    private Organization()
    {
        Name = string.Empty;
        Slug = string.Empty;
    }

    public string Name { get; private set; }

    public string Slug { get; private set; }

    /// <summary>Kişisel organizasyonlar kayıt sırasında otomatik açılır ve başkası davet edilemez.</summary>
    public bool IsPersonal { get; private set; }

    public Guid OwnerId { get; private set; }

    /// <summary>
    /// true ise üyelerin iki adımlı doğrulaması açık olmalı; açık olmayanlar organizasyonun workspace'lerine
    /// erişemez (kurana kadar workspace'ler görünmez).
    /// </summary>
    public bool RequireTwoFactor { get; private set; }

    /// <summary>Organizasyon e-postalarının ve yeni üyelerin başlangıç dili ("tr", "en").</summary>
    public string DefaultLanguage { get; private set; } = "tr";

    public DateTimeOffset CreatedAt { get; private set; }

    public IReadOnlyCollection<OrganizationMember> Members => _members;

    public IReadOnlyCollection<Workspace> Workspaces => _workspaces;

    public static Organization Create(string name, Guid ownerId, bool isPersonal, DateTimeOffset now)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);

        var organization = new Organization
        {
            Name = name.Trim().Length > NameMaxLength ? name.Trim()[..NameMaxLength] : name.Trim(),
            Slug = Common.Slug.From(name) + "-" + Guid.NewGuid().ToString("N")[..6],
            IsPersonal = isPersonal,
            OwnerId = ownerId,
            CreatedAt = now,
        };

        organization._members.Add(new OrganizationMember(organization.Id, ownerId, OrganizationRole.Owner, now));
        return organization;
    }

    public void SetTwoFactorRequirement(bool required)
    {
        if (IsPersonal && required)
        {
            throw new InvalidOperationException("Kişisel organizasyonda iki adımlı doğrulama zorunlu kılınamaz.");
        }

        RequireTwoFactor = required;
    }

    public void SetDefaultLanguage(string language)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(language);
        DefaultLanguage = language;
    }

    public void Rename(string name)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        Name = name.Trim().Length > NameMaxLength ? name.Trim()[..NameMaxLength] : name.Trim();
    }

    public OrganizationRole? RoleOf(Guid userId) => _members.FirstOrDefault(m => m.UserId == userId)?.Role;

    public void AddMember(Guid userId, OrganizationRole role, DateTimeOffset now)
    {
        if (IsPersonal)
        {
            throw new InvalidOperationException("Kişisel organizasyona üye eklenemez.");
        }

        if (role == OrganizationRole.Owner)
        {
            throw new InvalidOperationException("Sahiplik yalnızca devredilebilir.");
        }

        if (_members.Any(m => m.UserId == userId))
        {
            throw new InvalidOperationException("Kullanıcı zaten bu organizasyonun üyesi.");
        }

        _members.Add(new OrganizationMember(Id, userId, role, now));
    }

    /// <summary>Üye ile yönetici arasında geçiş. Sahiplik için <see cref="TransferOwnership"/>.</summary>
    public void ChangeRole(Guid userId, OrganizationRole role)
    {
        var member = _members.FirstOrDefault(m => m.UserId == userId) ?? throw new InvalidOperationException("Üye bulunamadı.");
        if (member.Role == OrganizationRole.Owner || role == OrganizationRole.Owner)
        {
            throw new InvalidOperationException("Sahiplik yalnızca devredilebilir.");
        }

        member.Role = role;
    }

    /// <summary>Sahiplik başka bir üyeye geçer; eski sahip yönetici olur.</summary>
    public void TransferOwnership(Guid newOwnerId)
    {
        var next = _members.FirstOrDefault(m => m.UserId == newOwnerId) ?? throw new InvalidOperationException("Üye bulunamadı.");
        var current = _members.First(m => m.UserId == OwnerId);
        current.Role = OrganizationRole.Admin;
        next.Role = OrganizationRole.Owner;
        OwnerId = newOwnerId;
    }

    public void RemoveMember(Guid userId)
    {
        if (userId == OwnerId)
        {
            throw new InvalidOperationException("Sahip organizasyondan çıkarılamaz; önce sahipliği devretmeli.");
        }

        _members.RemoveAll(m => m.UserId == userId);
    }

    public Workspace AddWorkspace(string name, WorkspaceType type, Guid createdById, DateTimeOffset now)
    {
        if (IsPersonal && type != WorkspaceType.Personal)
        {
            throw new InvalidOperationException("Kişisel organizasyonda yalnızca kişisel workspace olabilir.");
        }

        var workspace = Workspace.Create(Id, name, type, createdById, now);
        _workspaces.Add(workspace);
        return workspace;
    }
}
