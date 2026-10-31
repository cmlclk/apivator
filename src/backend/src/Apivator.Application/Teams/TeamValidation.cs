using Apivator.Application.Common;
using Apivator.Application.Common.Localization;

namespace Apivator.Application.Teams;

internal static class TeamValidation
{
    public static Error? Name(string? name, int max, string what) =>
        string.IsNullOrWhiteSpace(name)
            ? Error.Validation("validation", L.T("team_validation.name_required", "{what} adı boş olamaz.", ("what", Noun(what))))
            : name.Trim().Length > max
                ? Error.Validation("validation", L.T("team_validation.name_length", "{what} adı en fazla {max} karakter olabilir.", ("what", Noun(what)), ("max", max)))
                : null;

    // Çağıranlar Türkçe adı verir ("Takım", "Organizasyon", "Workspace"); etkin dile çevrilir.
    private static string Noun(string what) => what switch
    {
        "Takım" => L.T("team_validation.noun_team", "Takım"),
        "Organizasyon" => L.T("team_validation.noun_organization", "Organizasyon"),
        "Workspace" => L.T("team_validation.noun_workspace", "Workspace"),
        _ => what,
    };

    public static Error? Email(string? email) =>
        string.IsNullOrWhiteSpace(email) || email.Length > 256 || !email.Contains('@', StringComparison.Ordinal) || email.Trim().Contains(' ', StringComparison.Ordinal)
            ? Error.Validation("validation", L.T("team_validation.email", "Geçerli bir e-posta adresi girin."))
            : null;

    public static Error PersonalOrganization =>
        Error.Validation("organization.personal", L.T("organization.personal", "Kişisel organizasyona üye, takım ya da takım workspace'i eklenemez. Yeni bir organizasyon oluşturun."));
}
