using Apivator.Domain.Common;
using Apivator.Domain.Variables;

namespace Apivator.Domain.Collections;

public sealed class Collection : Entity
{
    public const int NameMaxLength = 120;

    private Collection()
    {
        Name = string.Empty;
    }

    public Guid WorkspaceId { get; private set; }

    public string Name { get; private set; }

    public string? Description { get; private set; }

    /// <summary>Collection'daki istekler varsayılan olarak bunu miras alır. Collection miras alamaz.</summary>
    public RequestAuth Auth { get; private set; } = RequestAuth.None;

    /// <summary>Collection değişkenleri; environment değişkenleri bunları ezer.</summary>
    public IReadOnlyList<Variable> Variables { get; private set; } = [];

    /// <summary>Collection'daki her istekten önce/sonra çalışan script'ler.</summary>
    public ScriptSet Scripts { get; private set; } = ScriptSet.Empty;

    /// <summary>
    /// true ise bu collection'ı yalnızca workspace yöneticileri ve collection'da Editor rolü verilenler düzenleyebilir;
    /// diğer üyeler görüntüleyicidir.
    /// </summary>
    public bool EditingRestricted { get; private set; }

    public Guid CreatedById { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public static Collection Create(Guid workspaceId, string name, Guid userId, DateTimeOffset now) => new()
    {
        WorkspaceId = workspaceId,
        Name = Names.Clean(name, NameMaxLength),
        CreatedById = userId,
        CreatedAt = now,
        UpdatedAt = now,
    };

    /// <summary>Collection başka bir workspace'e taşınır (klasörler ve istekler onunla gider).</summary>
    public void MoveTo(Guid workspaceId, DateTimeOffset now)
    {
        WorkspaceId = workspaceId;
        UpdatedAt = now;
    }

    public void RestrictEditing(bool restricted, DateTimeOffset now)
    {
        EditingRestricted = restricted;
        UpdatedAt = now;
    }

    public void Rename(string name, DateTimeOffset now)
    {
        Name = Names.Clean(name, NameMaxLength);
        UpdatedAt = now;
    }

    public void SetVariables(IReadOnlyList<Variable> variables, DateTimeOffset now)
    {
        Variables = variables;
        UpdatedAt = now;
    }

    public void SetAuth(RequestAuth auth, DateTimeOffset now)
    {
        Auth = (auth.Type == AuthType.Inherit ? auth with { Type = AuthType.None } : auth).WithoutSecrets();
        UpdatedAt = now;
    }

    public void SetScripts(ScriptSet scripts, DateTimeOffset now)
    {
        Scripts = scripts.Normalize();
        UpdatedAt = now;
    }

    public void Describe(string? description, DateTimeOffset now)
    {
        Description = string.IsNullOrWhiteSpace(description) ? null : description.Trim();
        UpdatedAt = now;
    }
}
