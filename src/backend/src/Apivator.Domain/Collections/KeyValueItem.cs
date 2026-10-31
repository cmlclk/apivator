using System.Text.Json.Serialization;

namespace Apivator.Domain.Collections;

[JsonConverter(typeof(JsonStringEnumConverter<FormFieldType>))]
public enum FormFieldType
{
    Text,
    File,
}

/// <summary>
/// Header, query parametresi veya form alanı. Devre dışı olanlar kaydedilir ama gönderilmez.
/// form-data'daki dosya alanlarında <see cref="Value"/> dosya adıdır.
/// </summary>
public sealed record KeyValueItem(
    string Key,
    string Value,
    bool Enabled = true,
    string? Description = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] FormFieldType Type = FormFieldType.Text);
