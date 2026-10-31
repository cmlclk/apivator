using System.Collections.Concurrent;
using Apivator.Application.Abstractions;
using Apivator.Infrastructure.Sso;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Npgsql;
using Testcontainers.PostgreSql;

namespace Apivator.Api.IntegrationTests;

/// <summary>
/// Testler gerçek bir PostgreSQL'e karşı çalışır. Varsayılan olarak Testcontainers ile geçici bir container
/// başlatılır (Docker gerekir). Docker yoksa APIVATOR_TEST_POSTGRES ortam değişkenine boş bir veritabanının
/// bağlantı cümlesi verilebilir; veritabanı test başında sıfırlanır.
/// APIVATOR_TEST_PROVIDER=Sqlite ise testler geçici bir SQLite dosyasında koşar (yerel mod); PostgreSQL gerekmez.
/// </summary>
public sealed class ApivatorApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly string? _externalConnectionString = Environment.GetEnvironmentVariable("APIVATOR_TEST_POSTGRES");
    private PostgreSqlContainer? _postgres;
    private string? _sqlitePath;

    /// <summary>Testler SQLite üzerinde mi koşuyor (APIVATOR_TEST_PROVIDER=Sqlite).</summary>
    public static bool IsSqlite { get; } =
        string.Equals(Environment.GetEnvironmentVariable("APIVATOR_TEST_PROVIDER"), "Sqlite", StringComparison.OrdinalIgnoreCase);

    public FakeEmailSender Emails { get; } = new();

    /// <summary>SSO alan adı doğrulamasının baktığı sahte DNS (testler TXT kaydı ekler).</summary>
    public FakeDomainVerifier Dns { get; } = new();

    private string ConnectionString => _externalConnectionString ?? _postgres!.GetConnectionString();

    public async Task InitializeAsync()
    {
        if (IsSqlite)
        {
            _sqlitePath = Path.Combine(Path.GetTempPath(), $"apivator-test-{Guid.NewGuid():N}.db");
            return;
        }

        if (_externalConnectionString is null)
        {
            _postgres = new PostgreSqlBuilder("postgres:16-alpine").Build();
            await _postgres.StartAsync();
            return;
        }

        await using var connection = new NpgsqlConnection(_externalConnectionString);
        await connection.OpenAsync();
        await using var reset = new NpgsqlCommand("DROP SCHEMA public CASCADE; CREATE SCHEMA public;", connection);
        await reset.ExecuteNonQueryAsync();
    }

    public new async Task DisposeAsync()
    {
        await base.DisposeAsync();
        if (_postgres is not null)
        {
            await _postgres.DisposeAsync();
        }

        if (_sqlitePath is not null)
        {
            SqliteConnection.ClearAllPools();
            foreach (var suffix in new[] { "", "-wal", "-shm" })
            {
                try
                {
                    File.Delete(_sqlitePath + suffix);
                }
                catch (IOException)
                {
                    // Geçici klasörde kalabilir; bir sonraki koşuyu etkilemez.
                }
            }
        }
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        if (_sqlitePath is not null)
        {
            builder.UseSetting("Database:Provider", "Sqlite");
            builder.UseSetting("ConnectionStrings:Sqlite", $"Data Source={_sqlitePath}");
        }
        else
        {
            builder.UseSetting("ConnectionStrings:Postgres", ConnectionString);
        }

        builder.UseSetting("Jwt:SigningKey", "integration-test-signing-key-0123456789abcdef");
        builder.UseSetting("App:PublicUrl", "http://localhost:5173");
        builder.UseSetting("Database:MigrateOnStartup", "true");
        builder.UseSetting("RateLimiting:AuthPermitPerMinute", "10000");
        builder.UseSetting("RateLimiting:ExecutePermitPerMinute", "10000");

        // Üretimdeki gibi özel ağlar kapalı; yalnızca testlerin hedef sunucusu (127.0.0.1) açık.
        builder.UseSetting("Proxy:AllowPrivateNetworks", "false");
        builder.UseSetting("Proxy:AllowedNetworks:0", "127.0.0.1/32");
        builder.UseSetting("Scripts:TimeoutSeconds", "3");
        // Testler zamanlayıcıyı kendileri tetikler (IMonitorScheduler.RunDueAsync).
        builder.UseSetting("Monitors:SchedulerEnabled", "false");
        builder.UseSetting("SourceChecks:SchedulerEnabled", "false");
        builder.UseSetting("GitSync:SchedulerEnabled", "false");
        builder.UseSetting("GitSync:AllowLocalRemotes", "true");
        builder.UseSetting("GitSync:AllowHttp", "true");
        // Testlerin sahte kimlik sağlayıcısı http://127.0.0.1 üzerinde çalışır.
        builder.UseSetting("Sso:AllowInsecureAuthority", "true");

        builder.ConfigureServices(services =>
        {
            services.RemoveAll<IEmailSender>();
            services.AddSingleton<IEmailSender>(Emails);
            services.RemoveAll<IDomainVerifier>();
            services.AddSingleton<IDomainVerifier>(Dns);
        });
    }
}

public sealed class FakeEmailSender : IEmailSender
{
    private readonly ConcurrentQueue<EmailMessage> _sent = new();

    public IReadOnlyCollection<EmailMessage> Sent => _sent;

    public Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default)
    {
        _sent.Enqueue(message);
        return Task.CompletedTask;
    }

    public EmailMessage LastTo(string email) =>
        _sent.Reverse().First(m => string.Equals(m.To, email, StringComparison.OrdinalIgnoreCase));
}

public sealed class FakeDomainVerifier : IDomainVerifier
{
    private readonly ConcurrentDictionary<string, string?> _records = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>DNS'e TXT kaydı eklenmiş gibi davranır.</summary>
    public void Publish(string recordName, string value) => _records[recordName] = value;

    public void Remove(string recordName) => _records.TryRemove(recordName, out _);

    /// <summary>Bu ad sorgulanınca DNS hata verir (SERVFAIL/zaman aşımı gibi; sonuç bilinmiyor).</summary>
    public void Fail(string recordName) => _records[recordName] = null;

    public Task<TxtLookup> LookupAsync(string recordName, string expected, CancellationToken ct) =>
        Task.FromResult(!_records.TryGetValue(recordName, out var value) ? TxtLookup.Missing
            : value is null ? TxtLookup.Unknown
            : value == expected ? TxtLookup.Found
            : TxtLookup.Missing);
}

[CollectionDefinition(Name)]
public sealed class ApiCollection : ICollectionFixture<ApivatorApiFactory>
{
    public const string Name = "api";
}
