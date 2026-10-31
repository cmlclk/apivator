using Apivator.Application.Common.Localization;
using Apivator.Application.Onboarding;
using Apivator.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Apivator.Infrastructure.Identity;

/// <summary>
/// Yerel mod (kişisel kullanım): bu bilgisayardaki tek kullanıcı. Şifresi yoktur, giriş yapmaz; kimliği masaüstü
/// uygulamasının her açılışta ürettiği token ile doğrulanır. İlk açılışta kişisel workspace'iyle birlikte oluşturulur.
/// </summary>
public static class LocalUser
{
    public static readonly Guid Id = new("00000000-0000-7000-8000-00000000a11e");

    public const string Email = "local@apivator.local";

    /// <summary>Yerel kullanıcı yoksa oluşturur (kişisel organizasyon ve workspace dahil); varsa dokunmaz.</summary>
    public static async Task EnsureAsync(IServiceProvider services, CancellationToken cancellationToken = default)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        if (await db.Users.AnyAsync(u => u.Id == Id, cancellationToken))
        {
            return;
        }

        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var user = new ApplicationUser
        {
            Id = Id,
            UserName = Email,
            Email = Email,
            EmailConfirmed = true,
            LockoutEnabled = false,
            DisplayName = L.T("local_mode.user_name", "Yerel kullanıcı"),
            CreatedAt = scope.ServiceProvider.GetRequiredService<TimeProvider>().GetUtcNow(),
        };

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var created = await users.CreateAsync(user);
        if (!created.Succeeded)
        {
            throw new InvalidOperationException("Yerel kullanıcı oluşturulamadı: " + string.Join("; ", created.Errors.Select(e => e.Description)));
        }

        scope.ServiceProvider.GetRequiredService<IPersonalSpaceProvisioner>().Provision(user.Id, user.DisplayName);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }
}
