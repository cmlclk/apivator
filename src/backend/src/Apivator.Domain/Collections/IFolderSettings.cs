namespace Apivator.Domain.Collections;

/// <summary>Yetkilendirme ve script mirası için bir klasörden gereken bilgiler.</summary>
public interface IFolderSettings
{
    Guid? ParentFolderId { get; }

    RequestAuth Auth { get; }

    ScriptSet Scripts { get; }
}
