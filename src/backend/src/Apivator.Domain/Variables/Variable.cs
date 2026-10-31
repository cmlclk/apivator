namespace Apivator.Domain.Variables;

/// <summary>
/// Environment, collection veya global değişkeni. <see cref="Value"/> ekiple paylaşılan başlangıç değeridir;
/// her kullanıcının "güncel değeri" yalnızca kendi istemcisinde tutulur ve sunucuya gelmez.
/// </summary>
public sealed record Variable(string Key, string Value, bool Enabled = true, bool IsSecret = false);

public enum VariableRuleViolation
{
    KeyTooLong,
    KeyHasBraces,
    ValueTooLong,
    TooMany,
}

public static class VariableRules
{
    public const int MaxCount = 500;
    public const int KeyMaxLength = 200;
    public const int ValueMaxLength = 16 * 1024;

    /// <summary>
    /// Anahtarı boş satırları atar, anahtarları kırpar. Kurala uymayan ilk satır için ihlali ve satırın anahtarını döner;
    /// kullanıcıya gösterilecek metin Application katmanında üretilir (<c>VariableRuleMessages</c>).
    /// </summary>
    public static (IReadOnlyList<Variable> Variables, VariableRuleViolation? Violation, string? Key) CleanChecked(IEnumerable<Variable>? variables)
    {
        var cleaned = new List<Variable>();
        foreach (var variable in variables ?? [])
        {
            var key = variable.Key?.Trim() ?? string.Empty;
            if (key.Length == 0)
            {
                continue;
            }

            if (key.Length > KeyMaxLength)
            {
                return ([], VariableRuleViolation.KeyTooLong, key);
            }

            if (key.Contains("{{", StringComparison.Ordinal) || key.Contains("}}", StringComparison.Ordinal))
            {
                return ([], VariableRuleViolation.KeyHasBraces, key);
            }

            if ((variable.Value?.Length ?? 0) > ValueMaxLength)
            {
                return ([], VariableRuleViolation.ValueTooLong, key);
            }

            cleaned.Add(variable with { Key = key, Value = variable.Value ?? string.Empty });
        }

        return cleaned.Count > MaxCount
            ? ([], VariableRuleViolation.TooMany, null)
            : (cleaned, null, null);
    }
}
