using System.Text.Json.Serialization;

namespace Apivator.Domain.Workspaces;

/// <summary>API'de sayı yerine ad olarak (ör. "Admin") taşınır.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<WorkspaceRole>))]
public enum WorkspaceRole
{
    Viewer = 0,
    Editor = 1,
    Admin = 2,
}
