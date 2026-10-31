using System.Text.Json;
using Apivator.Application.Common.Localization;
using Apivator.Application.Runs;
using Apivator.Domain.Variables;

namespace Apivator.Application.Import;

/// <summary>Bir dosyadan okunan environment ya da globals.</summary>
public sealed record VariableFile(string Name, IReadOnlyList<Variable> Variables);

/// <summary>
/// Postman v2.0/v2.1 dosyalarını (Apivator'ın dışa aktardıkları dahil) veritabanına yazmadan çalıştırılabilir hâle
/// getirir. Komut satırı aracı dosyadan çalıştırırken kullanır.
/// </summary>
public static class PostmanFiles
{
    public static (RunSourceDto Source, IReadOnlyList<string> Warnings) ReadCollection(JsonElement root)
    {
        if (PostmanParser.IsLegacyV1(root))
        {
            throw new FormatException(L.T("import.postman_v1_format", "Postman v1 biçimi desteklenmiyor; Postman'den v2.1 olarak dışa aktarın."));
        }

        if (!PostmanParser.IsCollection(root))
        {
            throw new FormatException(L.T("import.postman_not_collection", "Bu dosya bir Postman collection'ı değil (info ve item alanları bekleniyor)."));
        }

        var parser = new PostmanParser();
        var parsed = parser.ParseCollection(root);
        var folders = new List<RunFolderSource>();
        var requests = new List<RunRequestSource>();

        void Visit(IReadOnlyList<ParsedItem> items, Guid? parentId)
        {
            var order = 0;
            foreach (var item in items)
            {
                switch (item)
                {
                    case ParsedFolder folder:
                        var id = Guid.NewGuid();
                        folders.Add(new RunFolderSource(id, parentId, folder.Name, order++, folder.Auth, folder.Scripts));
                        Visit(folder.Children, id);
                        break;
                    case ParsedRequest request:
                        requests.Add(new RunRequestSource(Guid.NewGuid(), parentId, request.Name, order++, request.Definition));
                        break;
                }
            }
        }

        Visit(parsed.Items, null);
        var source = new RunSourceDto(Guid.Empty, parsed.Name, parsed.Auth, parsed.Scripts, parsed.Variables, folders, requests);
        return (source, parser.Warnings);
    }

    /// <summary>Postman environment ya da globals dosyası ("values" listesi).</summary>
    public static VariableFile ReadVariables(JsonElement root)
    {
        if (!PostmanParser.IsEnvironment(root))
        {
            throw new FormatException(L.T("import.postman_not_environment", "Bu dosya bir Postman environment ya da globals dosyası değil (values alanı bekleniyor)."));
        }

        var parsed = PostmanParser.ParseEnvironment(root);
        return new VariableFile(parsed.Name, parsed.Variables);
    }
}
