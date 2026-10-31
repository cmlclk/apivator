using System.Text.Json.Serialization;

namespace Apivator.Domain.Organizations;

/// <summary>API'de sayı yerine ad olarak (ör. "Admin") taşınır.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<OrganizationRole>))]
public enum OrganizationRole
{
    Member = 0,
    Admin = 1,
    Owner = 2,
}
