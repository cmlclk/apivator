using Apivator.Application.Common.Localization;
using Apivator.Domain.Variables;

namespace Apivator.Application.Common;

/// <summary>Domain'in değişken kuralı ihlallerini etkin dilde kullanıcı metnine çevirir.</summary>
public static class VariableRuleMessages
{
    /// <summary><see cref="VariableRules.CleanChecked"/>'in yerelleştirilmiş karşılığı: kurala uymayan ilk satır için hata metni döner.</summary>
    public static (IReadOnlyList<Variable> Variables, string? Error) Clean(IEnumerable<Variable>? variables)
    {
        var (cleaned, violation, key) = VariableRules.CleanChecked(variables);
        return (cleaned, violation is { } v ? Text(v, key) : null);
    }

    public static string Text(VariableRuleViolation violation, string? key) => violation switch
    {
        VariableRuleViolation.KeyTooLong => L.T("variable.key_length", "Değişken adı en fazla {max} karakter olabilir.", ("max", VariableRules.KeyMaxLength)),
        VariableRuleViolation.KeyHasBraces => L.T("variable.key_braces", "'{key}': değişken adı süslü parantez içeremez.", ("key", key)),
        VariableRuleViolation.ValueTooLong => L.T("variable.value_length", "'{key}': değer en fazla {max} KB olabilir.", ("key", key), ("max", VariableRules.ValueMaxLength / 1024)),
        _ => L.T("variable.too_many", "En fazla {max} değişken tanımlanabilir.", ("max", VariableRules.MaxCount)),
    };
}
