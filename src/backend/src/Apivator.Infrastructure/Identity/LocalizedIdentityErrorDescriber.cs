using Apivator.Application.Common.Localization;
using Microsoft.AspNetCore.Identity;

namespace Apivator.Infrastructure.Identity;

internal sealed class LocalizedIdentityErrorDescriber : IdentityErrorDescriber
{
    public override IdentityError PasswordTooShort(int length) =>
        new() { Code = nameof(PasswordTooShort), Description = L.T("identity.password_too_short", "Şifre en az {length} karakter olmalı.", ("length", length)) };

    public override IdentityError PasswordRequiresDigit() =>
        new() { Code = nameof(PasswordRequiresDigit), Description = L.T("identity.password_requires_digit", "Şifre en az bir rakam içermeli.") };

    public override IdentityError PasswordRequiresLower() =>
        new() { Code = nameof(PasswordRequiresLower), Description = L.T("identity.password_requires_lower", "Şifre en az bir küçük harf içermeli.") };

    public override IdentityError PasswordRequiresUpper() =>
        new() { Code = nameof(PasswordRequiresUpper), Description = L.T("identity.password_requires_upper", "Şifre en az bir büyük harf içermeli.") };

    public override IdentityError PasswordRequiresNonAlphanumeric() =>
        new() { Code = nameof(PasswordRequiresNonAlphanumeric), Description = L.T("identity.password_requires_symbol", "Şifre en az bir özel karakter içermeli.") };

    public override IdentityError DuplicateEmail(string email) =>
        new() { Code = nameof(DuplicateEmail), Description = L.T("identity.email_taken", "Bu e-posta adresiyle kayıtlı bir hesap var.") };

    public override IdentityError DuplicateUserName(string userName) =>
        new() { Code = nameof(DuplicateUserName), Description = L.T("identity.email_taken", "Bu e-posta adresiyle kayıtlı bir hesap var.") };

    public override IdentityError InvalidEmail(string? email) =>
        new() { Code = nameof(InvalidEmail), Description = L.T("identity.invalid_email", "Geçerli bir e-posta adresi girin.") };

    public override IdentityError InvalidToken() =>
        new() { Code = nameof(InvalidToken), Description = L.T("identity.invalid_link", "Link geçersiz veya süresi dolmuş.") };
}
