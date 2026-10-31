namespace Apivator.Application.Auth;

public sealed record RegisterRequest(string Email, string Password, string DisplayName);

public sealed record LoginRequest(string Email, string Password);

/// <summary>Web istemcisi refresh token'ı cookie ile, desktop/CLI gövdede gönderir.</summary>
public sealed record RefreshRequest(string? RefreshToken);

public sealed record ConfirmEmailRequest(Guid UserId, string Token);

public sealed record ForgotPasswordRequest(string Email);

public sealed record ResetPasswordRequest(string Email, string Token, string NewPassword);

/// <param name="AvatarVersion">Profil görseli varsa sürümü (<c>/api/users/{id}/avatar?v=…</c>); yoksa null.</param>
/// <param name="TwoFactorRequiredBy">İki adımlı doğrulamayı zorunlu kılan organizasyonlar (kapalıysa workspace'leri görünmez).</param>
public sealed record UserDto(
    Guid Id,
    string Email,
    string DisplayName,
    bool EmailConfirmed,
    long? AvatarVersion = null,
    bool TwoFactorEnabled = false,
    IReadOnlyList<string>? TwoFactorRequiredBy = null);

public sealed record AuthResult(
    string AccessToken,
    DateTimeOffset AccessTokenExpiresAt,
    string RefreshToken,
    DateTimeOffset RefreshTokenExpiresAt,
    UserDto User);
