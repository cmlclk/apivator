namespace Apivator.Application.Abstractions;

public interface ICurrentUser
{
    Guid? Id { get; }

    /// <summary>Değişiklik kayıtlarında gösterilen ad (oturum token'ından).</summary>
    string? DisplayName => null;

    /// <summary>İstek bir API anahtarıyla doğrulandıysa anahtarın Id'si (denetim kaydı için).</summary>
    Guid? ApiKeyId => null;

    bool IsAuthenticated => Id is not null;

    /// <summary>Kimliği doğrulanmış kullanıcının Id'si; yoksa istisna fırlatır.</summary>
    Guid RequiredId => Id ?? throw new InvalidOperationException("Kimliği doğrulanmış kullanıcı yok.");
}
