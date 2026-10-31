using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Apivator.Infrastructure.Persistence;

/// <summary>
/// SQLite bağlamı (kişisel kullanım / yerel mod). Model PostgreSQL ile aynıdır; yalnızca sağlayıcıya özgü kısımlar
/// uyarlanır. Kendi migration seti <c>Persistence/Migrations/Sqlite</c> altındadır.
/// </summary>
public sealed class SqliteAppDbContext(DbContextOptions<SqliteAppDbContext> options) : AppDbContext(options)
{
    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        base.ConfigureConventions(configurationBuilder);

        // SQLite DateTimeOffset'i metin olarak saklar; karşılaştırma ve sıralama sorguda çevrilemez. UTC tick
        // (INTEGER) olarak saklanır: sıralanabilir ve PostgreSQL timestamptz gibi her zaman UTC döner.
        configurationBuilder.Properties<DateTimeOffset>().HaveConversion<UtcTicksConverter>();
    }

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        foreach (var property in builder.Model.GetEntityTypes().SelectMany(e => e.GetProperties()))
        {
            // jsonb → JSON metni.
            if (string.Equals(property.GetColumnType(), "jsonb", StringComparison.OrdinalIgnoreCase))
            {
                property.SetColumnType("TEXT");
            }

            if (property.GetDefaultValueSql() is { } sql && sql.Contains("::", StringComparison.Ordinal))
            {
                property.SetDefaultValueSql(sql[..sql.IndexOf("::", StringComparison.Ordinal)]);
            }
        }
    }

    private sealed class UtcTicksConverter() : ValueConverter<DateTimeOffset, long>(
        v => v.UtcTicks,
        v => new DateTimeOffset(v, TimeSpan.Zero));
}

/// <summary>Her bağlantıda WAL ve eşzamanlı yazımda bekleme: arka plan servisleri ile istekler aynı dosyaya yazar.</summary>
internal sealed class SqlitePragmaInterceptor : DbConnectionInterceptor
{
    private const string Pragmas = "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=10000;";

    public override void ConnectionOpened(DbConnection connection, ConnectionEndEventData eventData)
    {
        using var command = connection.CreateCommand();
        command.CommandText = Pragmas;
        command.ExecuteNonQuery();
    }

    public override async Task ConnectionOpenedAsync(DbConnection connection, ConnectionEndEventData eventData, CancellationToken cancellationToken = default)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = Pragmas;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}

/// <summary>Yalnızca <c>dotnet ef migrations add --context SqliteAppDbContext</c> için.</summary>
internal sealed class SqliteDesignTimeFactory : IDesignTimeDbContextFactory<SqliteAppDbContext>
{
    public SqliteAppDbContext CreateDbContext(string[] args) => new(new DbContextOptionsBuilder<SqliteAppDbContext>()
        .UseSqlite("Data Source=design.db", o => o.MigrationsHistoryTable(DatabaseProvider.MigrationsHistoryTable))
        .Options);
}
