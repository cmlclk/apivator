using Apivator.Domain.Collections;

namespace Apivator.Application.Execution;

/// <summary>
/// Yetkilendirme mirası (istemcideki resolveAuth ile aynı kural): istek "Inherit" ise en yakın üst klasörün,
/// o da yoksa collection'ın yetkilendirmesi kullanılır.
/// </summary>
public static class AuthInheritance
{
    public static RequestAuth Resolve<TFolder>(RequestAuth? requestAuth, Guid? folderId, IReadOnlyDictionary<Guid, TFolder> folders, RequestAuth collectionAuth)
        where TFolder : IFolderSettings
    {
        if (requestAuth is not null && requestAuth.Type != AuthType.Inherit)
        {
            return requestAuth;
        }

        var current = folderId;
        for (var guard = 0; current is { } id && guard < 50; guard++)
        {
            if (!folders.TryGetValue(id, out var folder))
            {
                break;
            }

            if (folder.Auth.Type != AuthType.Inherit)
            {
                return folder.Auth;
            }

            current = folder.ParentFolderId;
        }

        return collectionAuth.Type == AuthType.Inherit ? RequestAuth.None : collectionAuth;
    }

    /// <summary>Collection → üst klasörden alt klasöre → istek sırasıyla script'ler.</summary>
    public static (List<string> PreRequest, List<string> PostResponse) ScriptChain<TFolder>(
        ScriptSet collectionScripts,
        Guid? folderId,
        IReadOnlyDictionary<Guid, TFolder> folders,
        ScriptSet requestScripts)
        where TFolder : IFolderSettings
    {
        var chain = new List<ScriptSet> { collectionScripts };
        var folderScripts = new List<ScriptSet>();
        var current = folderId;
        for (var guard = 0; current is { } id && guard < 50 && folders.TryGetValue(id, out var folder); guard++)
        {
            folderScripts.Insert(0, folder.Scripts);
            current = folder.ParentFolderId;
        }

        chain.AddRange(folderScripts);
        chain.Add(requestScripts);
        return (
            chain.Select(s => s.PreRequest).Where(s => !string.IsNullOrWhiteSpace(s)).ToList(),
            chain.Select(s => s.PostResponse).Where(s => !string.IsNullOrWhiteSpace(s)).ToList());
    }
}
