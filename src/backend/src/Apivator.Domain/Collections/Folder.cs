using Apivator.Domain.Common;

namespace Apivator.Domain.Collections;

public sealed class Folder : Entity, IFolderSettings
{
    public const int NameMaxLength = 120;

    private Folder()
    {
        Name = string.Empty;
    }

    public Guid CollectionId { get; private set; }

    /// <summary>Boşsa collection'ın kökündedir.</summary>
    public Guid? ParentFolderId { get; private set; }

    public string Name { get; private set; }

    /// <summary>Markdown açıklama; dokümantasyon sayfasında klasör başlığının altında gösterilir.</summary>
    public string? Description { get; private set; }

    public int SortOrder { get; private set; }

    /// <summary>Varsayılan: üst klasörden / collection'dan miras al.</summary>
    public RequestAuth Auth { get; private set; } = RequestAuth.Inherit;

    /// <summary>Klasördeki (ve alt klasörlerdeki) her istekten önce/sonra çalışan script'ler.</summary>
    public ScriptSet Scripts { get; private set; } = ScriptSet.Empty;

    public DateTimeOffset CreatedAt { get; private set; }

    public static Folder Create(Guid collectionId, Guid? parentFolderId, string name, int sortOrder, DateTimeOffset now) => new()
    {
        CollectionId = collectionId,
        ParentFolderId = parentFolderId,
        Name = Names.Clean(name, NameMaxLength),
        SortOrder = sortOrder,
        CreatedAt = now,
    };

    public void Rename(string name) => Name = Names.Clean(name, NameMaxLength);

    public void SetAuth(RequestAuth auth) => Auth = auth.WithoutSecrets();

    public void SetScripts(ScriptSet scripts) => Scripts = scripts.Normalize();

    public void Describe(string? description) =>
        Description = string.IsNullOrWhiteSpace(description) ? null : description.Trim();

    public void MoveTo(Guid collectionId, Guid? parentFolderId, int sortOrder)
    {
        if (parentFolderId == Id)
        {
            throw new InvalidOperationException("Klasör kendi içine taşınamaz.");
        }

        CollectionId = collectionId;
        ParentFolderId = parentFolderId;
        SortOrder = sortOrder;
    }

    /// <summary>Üst klasör başka bir collection'a taşınınca alt klasörler de onunla gider.</summary>
    public void ChangeCollection(Guid collectionId) => CollectionId = collectionId;

    public void SetSortOrder(int sortOrder) => SortOrder = sortOrder;

    /// <summary>Git senkronunda uzaktaki dosyanın kimliğiyle oluşturulan klasörün kimliği (yalnızca ilk kayıttan önce).</summary>
    public void AssignId(Guid id) => Id = id;
}
