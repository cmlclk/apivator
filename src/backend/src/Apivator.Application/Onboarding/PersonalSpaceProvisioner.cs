using Apivator.Application.Abstractions;
using Apivator.Application.Common.Localization;
using Apivator.Domain.Organizations;
using Apivator.Domain.Workspaces;

namespace Apivator.Application.Onboarding;

internal sealed class PersonalSpaceProvisioner(IApplicationDbContext db, TimeProvider clock) : IPersonalSpaceProvisioner
{
    // Kayıt isteğinin dilinde oluşturulur; ad sonradan değiştirilebilir.
    public static string PersonalWorkspaceName => L.T("onboarding.personal_workspace", "Kişisel Workspace");

    public void Provision(Guid userId, string displayName)
    {
        var now = clock.GetUtcNow();
        var organization = Organization.Create(displayName, userId, isPersonal: true, now);
        organization.AddWorkspace(PersonalWorkspaceName, WorkspaceType.Personal, userId, now);
        db.Organizations.Add(organization);
    }
}
