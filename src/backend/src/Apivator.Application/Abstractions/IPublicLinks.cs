namespace Apivator.Application.Abstractions;

/// <summary>Uygulamanın dışarıya verilen adresleri (App:PublicUrl üzerinden).</summary>
public interface IPublicLinks
{
    /// <summary>Yayınlanmış dokümanın sayfası: <c>{PublicUrl}/docs/{slug}</c>.</summary>
    string Docs(string slug);
}
