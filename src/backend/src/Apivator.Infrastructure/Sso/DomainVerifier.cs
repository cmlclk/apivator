using DnsClient;
using Microsoft.Extensions.Logging;

namespace Apivator.Infrastructure.Sso;

public enum TxtLookup
{
    /// <summary>Beklenen değerde TXT kaydı var.</summary>
    Found,

    /// <summary>DNS kesin yanıt verdi (NOERROR/NXDOMAIN) ve kayıt yok.</summary>
    Missing,

    /// <summary>DNS'e ulaşılamadı ya da hata döndü (SERVFAIL, zaman aşımı); sonuç bilinmiyor.</summary>
    Unknown,
}

/// <summary>Alan adı sahipliğini DNS TXT kaydıyla doğrular (testlerde sahte uygulamayla değiştirilir).</summary>
public interface IDomainVerifier
{
    /// <summary><paramref name="recordName"/> adındaki TXT kayıtlarından biri tam olarak <paramref name="expected"/> mi?</summary>
    Task<TxtLookup> LookupAsync(string recordName, string expected, CancellationToken ct);
}

internal sealed class DnsDomainVerifier(ILogger<DnsDomainVerifier> logger) : IDomainVerifier
{
    // Önbellek kapalı: kullanıcı kaydı ekleyip hemen "Doğrula"ya bastığında eski (boş) yanıt dönmesin.
    // ThrowDnsErrors: SERVFAIL gibi yanıtlar "kayıt yok" ile karışmasın.
    private static readonly LookupClient Client = new(new LookupClientOptions { UseCache = false, Timeout = TimeSpan.FromSeconds(5), Retries = 1, ThrowDnsErrors = true });

    public async Task<TxtLookup> LookupAsync(string recordName, string expected, CancellationToken ct)
    {
        try
        {
            var result = await Client.QueryAsync(recordName, QueryType.TXT, cancellationToken: ct);
            return result.Answers.TxtRecords().Any(r => string.Join(string.Empty, r.Text).Trim() == expected) ? TxtLookup.Found : TxtLookup.Missing;
        }
        catch (DnsResponseException ex) when (ex.Code == DnsResponseCode.NotExistentDomain)
        {
            return TxtLookup.Missing;
        }
        catch (DnsResponseException ex)
        {
            if (logger.IsEnabled(LogLevel.Warning))
            {
                logger.LogWarning(ex, "TXT kaydı sorgulanamadı: {Record}", recordName);
            }

            return TxtLookup.Unknown;
        }
    }
}
