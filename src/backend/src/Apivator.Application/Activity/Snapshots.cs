using System.Text.Json;
using Apivator.Domain.Collections;
using Apivator.Domain.Variables;

namespace Apivator.Application.Activity;

/// <summary>Bir isteğin kaydedilen hâli (geçmiş ve eski sürüme dönme için).</summary>
public sealed record RequestSnapshot(string Name, RequestDefinition Definition, Guid CollectionId, Guid? FolderId);

public sealed record EnvironmentSnapshot(string Name, IReadOnlyList<Variable> Variables);

public sealed record CollectionSnapshot(
    string Name,
    string? Description,
    RequestAuth Auth,
    IReadOnlyList<Variable> Variables,
    ScriptSet Scripts);

public static class Snapshots
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);

    public static string Write<T>(T value) => JsonSerializer.Serialize(value, Options);

    public static T? Read<T>(string? json)
        where T : class => json is null ? null : JsonSerializer.Deserialize<T>(json, Options);
}

/// <summary>
/// Bir kaydetmenin değişiklik kaydında nasıl görüneceği. Geri yükleme gibi işlemler kaydetmeden önce ayarlar;
/// değişiklik kaydı bunu "güncellendi" yerine "geri yüklendi" olarak yazar.
/// </summary>
public sealed class ChangeLogScope
{
    public bool Restoring { get; set; }

    /// <summary>Geri yüklenen sürüm (ayrıntı olarak yazılır).</summary>
    public int? RestoredFromVersion { get; set; }
}
