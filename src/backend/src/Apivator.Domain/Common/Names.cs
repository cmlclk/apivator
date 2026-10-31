namespace Apivator.Domain.Common;

public static class Names
{
    /// <summary>Boşlukları kırpar, boş adı reddeder, uzun adı keser.</summary>
    public static string Clean(string? value, int maxLength)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            throw new ArgumentException("Ad boş olamaz.", nameof(value));
        }

        return trimmed.Length > maxLength ? trimmed[..maxLength] : trimmed;
    }
}
