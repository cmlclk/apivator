using System.Net.Mail;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;

namespace Apivator.Application.Auth;

/// <summary>İstek gövdesi doğrulaması. Şifre kuralları ayrıca Identity tarafından uygulanır.</summary>
public static class AuthValidator
{
    public const int DisplayNameMaxLength = 80;

    public static Error? Validate(RegisterRequest request)
    {
        var errors = new Dictionary<string, string[]>();

        if (!IsValidEmail(request.Email))
        {
            errors["email"] = [L.T("auth_validation.email", "Geçerli bir e-posta adresi girin.")];
        }

        if (string.IsNullOrWhiteSpace(request.DisplayName))
        {
            errors["displayName"] = [L.T("auth_validation.display_name_required", "Ad soyad zorunludur.")];
        }
        else if (request.DisplayName.Trim().Length > DisplayNameMaxLength)
        {
            errors["displayName"] = [L.T("auth_validation.display_name_length", "Ad soyad en fazla {max} karakter olabilir.", ("max", DisplayNameMaxLength))];
        }

        if (string.IsNullOrEmpty(request.Password))
        {
            errors["password"] = [L.T("auth_validation.password_required", "Şifre zorunludur.")];
        }

        return errors.Count == 0 ? null : Error.Validation("validation", L.T("auth_validation.invalid_input", "Gönderilen bilgiler geçersiz."), errors);
    }

    public static Error? Validate(LoginRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrEmpty(request.Password))
        {
            return Error.Validation("validation", L.T("auth_validation.email_password_required", "E-posta ve şifre zorunludur."));
        }

        return null;
    }

    public static bool IsValidEmail(string? email)
    {
        if (string.IsNullOrWhiteSpace(email) || email.Length > 254)
        {
            return false;
        }

        return MailAddress.TryCreate(email.Trim(), out var address)
            && string.Equals(address.Address, email.Trim(), StringComparison.OrdinalIgnoreCase)
            && address.Host.Contains('.', StringComparison.Ordinal);
    }
}
