using Apivator.Application.Account;

namespace Apivator.Application.Abstractions;

public sealed record UserSummary(Guid Id, string DisplayName, string Email, bool EmailConfirmed, bool TwoFactorEnabled = false);

/// <summary>Kullanıcı bilgileri (kimlik tablosu altyapı katmanındadır).</summary>
public interface IUserDirectory
{
    Task<IReadOnlyDictionary<Guid, string>> DisplayNamesAsync(IEnumerable<Guid> userIds, CancellationToken ct = default);

    Task<IReadOnlyDictionary<Guid, UserSummary>> UsersAsync(IEnumerable<Guid> userIds, CancellationToken ct = default);

    Task<UserSummary?> FindByEmailAsync(string email, CancellationToken ct = default);

    /// <summary>
    /// Bu adrese bu türde bildirim e-postası gönderilebilir mi? Adres bir kullanıcıya aitse onun tercihine bakılır;
    /// kayıtlı olmayan adresler (ör. monitör bildirim listesindeki dağıtım listeleri) her zaman alır.
    /// </summary>
    Task<bool> EmailAllowedAsync(string email, EmailTopic topic, CancellationToken ct = default);

    /// <summary>Kullanıcının kayıtlı arayüz dili ("tr", "en"); tercih yoksa ya da kullanıcı yoksa null.</summary>
    Task<string?> PreferredLanguageAsync(Guid userId, CancellationToken ct = default);

    /// <summary>Kullanıcı geçmişte yanıt gövdelerinin saklanmasını açmış mı (kullanıcı yoksa false).</summary>
    Task<bool> SavesHistoryResponsesAsync(Guid userId, CancellationToken ct = default);

    /// <summary>Bu adres bir kullanıcıya aitse onun kayıtlı dili; değilse ya da tercih yoksa null (e-postalar için).</summary>
    Task<string?> PreferredLanguageByEmailAsync(string email, CancellationToken ct = default);

    /// <summary>Kullanıcının dil tercihi yoksa verilen dili yazar (davetle katılanın başlangıç dili); tercih varsa dokunmaz.</summary>
    Task SetLanguageIfUnsetAsync(Guid userId, string language, CancellationToken ct = default);
}
