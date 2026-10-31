using Apivator.Application.Account;
using Apivator.Application.Common;

namespace Apivator.Application.Auth;

public interface IAuthService
{
    Task<Result<AuthResult>> RegisterAsync(RegisterRequest request, ClientInfo client, CancellationToken cancellationToken = default);

    /// <summary>İki adımlı doğrulama açıksa oturum yerine ikinci adım belirteci döner.</summary>
    Task<Result<LoginOutcome>> LoginAsync(LoginRequest request, ClientInfo client, CancellationToken cancellationToken = default);

    /// <summary>Girişin ikinci adımı: authenticator kodu ya da yedek kod.</summary>
    Task<Result<AuthResult>> LoginTwoFactorAsync(TwoFactorLoginRequest request, ClientInfo client, CancellationToken cancellationToken = default);

    Task<Result<AuthResult>> RefreshAsync(string refreshToken, ClientInfo client, CancellationToken cancellationToken = default);

    Task LogoutAsync(string refreshToken, CancellationToken cancellationToken = default);

    Task<Result<UserDto>> GetUserAsync(Guid userId, CancellationToken cancellationToken = default);

    Task<Result> ConfirmEmailAsync(ConfirmEmailRequest request, CancellationToken cancellationToken = default);

    Task<Result> ResendConfirmationAsync(Guid userId, CancellationToken cancellationToken = default);

    /// <summary>Kullanıcı var olsun ya da olmasın her zaman başarılı döner (e-posta taramasını önler).</summary>
    Task ForgotPasswordAsync(ForgotPasswordRequest request, CancellationToken cancellationToken = default);

    Task<Result> ResetPasswordAsync(ResetPasswordRequest request, CancellationToken cancellationToken = default);
}
