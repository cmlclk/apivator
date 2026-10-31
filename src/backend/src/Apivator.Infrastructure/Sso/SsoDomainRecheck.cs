using Apivator.Application.Audit;
using Apivator.Application.Sso;
using Apivator.Domain.Audit;
using Apivator.Domain.Organizations;
using Apivator.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Apivator.Infrastructure.Sso;

/// <summary>
/// Doğrulanmış SSO alan adlarının TXT kaydını günde bir yeniden kontrol eder. Alan adı el değiştirdiyse eski
/// organizasyon o adreslerle girişi sonsuza kadar yönetemesin diye art arda 3 başarısız kontrolde doğrulama kalkar;
/// doğrulanmış alan adı kalmazsa SSO kapanır. Her olay denetim kaydına yazılır.
/// </summary>
internal sealed class SsoDomainRecheck(
    IServiceScopeFactory scopes,
    IDomainVerifier verifier,
    IOptions<SsoOptions> options,
    TimeProvider clock,
    ILogger<SsoDomainRecheck> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromHours(24);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var wait = TimeSpan.FromMinutes(5);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(wait, clock, stoppingToken);
                await RecheckDomainsAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "SSO alan adları yeniden kontrol edilemedi.");
            }

            wait = TimeSpan.FromHours(6);
        }
    }

    /// <summary>
    /// Son kontrolü 24 saatten eski doğrulanmış alan adlarını kontrol eder; doğrulaması kalkanların sayısı. Her alan
    /// adı önce atomik olarak "kapılır" (last_checked_at güncellenir): birden fazla API örneği aynı turda çalışsa da
    /// bir alan adı bir kez sayılır. DNS'e ulaşılamazsa (sonuç bilinmiyor) başarısızlık sayılmaz.
    /// </summary>
    public async Task<int> RecheckDomainsAsync(CancellationToken ct = default)
    {
        if (!options.Value.RequireDomainVerification)
        {
            return 0;
        }

        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var audit = scope.ServiceProvider.GetRequiredService<IAuditLog>();
        var now = clock.GetUtcNow();
        var due = now - Interval;
        var candidates = await db.SsoDomains.AsNoTracking()
            .Where(d => d.VerifiedAt != null && (d.LastCheckedAt == null || d.LastCheckedAt <= due))
            .Select(d => new { d.Id, d.SsoId, d.Domain, d.VerificationToken })
            .ToListAsync(ct);

        var unverified = 0;
        var actor = new AuditActor(null, "Sistem (alan adı kontrolü)", null);
        foreach (var candidate in candidates)
        {
            var claimed = await db.SsoDomains
                .Where(d => d.Id == candidate.Id && (d.LastCheckedAt == null || d.LastCheckedAt <= due))
                .ExecuteUpdateAsync(s => s.SetProperty(d => d.LastCheckedAt, (DateTimeOffset?)now), ct);
            if (claimed == 0)
            {
                continue;
            }

            var lookup = await verifier.LookupAsync(SsoAdminService.RecordName(candidate.Domain), SsoDomain.RecordPrefix + candidate.VerificationToken, ct);
            if (lookup == TxtLookup.Unknown)
            {
                continue;
            }

            var sso = await db.OrganizationSso.Include(s => s.Domains).FirstAsync(s => s.Id == candidate.SsoId, ct);
            var domain = sso.Domains.First(d => d.Id == candidate.Id);
            var organizationName = await db.Organizations.Where(o => o.Id == sso.OrganizationId).Select(o => o.Name).FirstAsync(ct);
            if (domain.RecordCheck(lookup == TxtLookup.Found, now))
            {
                unverified++;
                await audit.RecordAsync(
                    sso.OrganizationId, AuditActions.SsoDomainUnverified, "sso", sso.OrganizationId, organizationName,
                    new Dictionary<string, string?> { ["domain"] = domain.Domain, ["reason"] = "TXT kaydı art arda bulunamadı" }, actor, ct);
                if (sso.DisableIfNoVerifiedDomain(now))
                {
                    await audit.RecordAsync(
                        sso.OrganizationId, AuditActions.SsoDisabled, "sso", sso.OrganizationId, organizationName,
                        new Dictionary<string, string?> { ["reason"] = "doğrulanmış alan adı kalmadı" }, actor, ct);
                }
            }

            await db.SaveChangesAsync(ct);
            db.ChangeTracker.Clear();
        }

        return unverified;
    }
}
