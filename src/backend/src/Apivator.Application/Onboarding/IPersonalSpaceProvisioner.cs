namespace Apivator.Application.Onboarding;

public interface IPersonalSpaceProvisioner
{
    /// <summary>Yeni kullanıcı için kişisel organizasyon ve "Kişisel Workspace" oluşturur. SaveChanges çağırmaz.</summary>
    void Provision(Guid userId, string displayName);
}
