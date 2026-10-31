using System.Text.Json.Serialization;

namespace Apivator.Domain.Collections;

[JsonConverter(typeof(JsonStringEnumConverter<BodyMode>))]
public enum BodyMode
{
    None,
    Raw,
    UrlEncoded,
    FormData,
    Binary,
    GraphQL,
}

[JsonConverter(typeof(JsonStringEnumConverter<RawLanguage>))]
public enum RawLanguage
{
    Json,
    Text,
    Xml,
    Html,
    JavaScript,
}

public sealed record RequestBody
{
    public static readonly RequestBody None = new();

    public BodyMode Mode { get; init; } = BodyMode.None;

    public RawLanguage RawLanguage { get; init; } = RawLanguage.Json;

    public string Raw { get; init; } = string.Empty;

    /// <summary>x-www-form-urlencoded ve form-data alanları. form-data'da dosya alanının değeri dosya adıdır.</summary>
    public IReadOnlyList<KeyValueItem> Form { get; init; } = [];

    /// <summary>
    /// Binary modda gönderilecek dosyanın adı. Dosyanın kendisi saklanmaz (Postman'deki gibi); istemci her
    /// gönderimde içeriği ekler. GraphQL modunda sorgu <see cref="Raw"/>'dadır.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? FileName { get; init; }

    /// <summary>GraphQL değişkenleri (JSON metni).</summary>
    public string GraphqlVariables { get; init; } = string.Empty;
}
