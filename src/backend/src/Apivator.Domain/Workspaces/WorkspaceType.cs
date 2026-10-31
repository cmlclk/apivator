using System.Text.Json.Serialization;

namespace Apivator.Domain.Workspaces;

/// <summary>API'de sayı yerine ad olarak (ör. "Admin") taşınır.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<WorkspaceType>))]
public enum WorkspaceType
{
    Personal = 0,
    Team = 1,
    Public = 2,
}
