using Microsoft.Extensions.Configuration;

namespace Apivator.Infrastructure.Persistence;

/// <summary>
/// Veritabanı sağlayıcısı seçimi: <c>Database:Provider</c> = <c>Postgres</c> (varsayılan, ekip sunucusu) |
/// <c>Sqlite</c> (kişisel kullanım; bağlantı cümlesi <c>ConnectionStrings:Sqlite</c>).
/// </summary>
public static class DatabaseProvider
{
    public const string Postgres = "Postgres";

    public const string Sqlite = "Sqlite";

    internal const string MigrationsHistoryTable = "__ef_migrations_history";

    public static string Get(IConfiguration configuration)
    {
        var value = configuration["Database:Provider"];
        if (string.IsNullOrWhiteSpace(value) || string.Equals(value, Postgres, StringComparison.OrdinalIgnoreCase))
        {
            return Postgres;
        }

        return string.Equals(value, Sqlite, StringComparison.OrdinalIgnoreCase)
            ? Sqlite
            : throw new InvalidOperationException($"Database:Provider geçersiz: '{value}'. Postgres ya da Sqlite olmalı.");
    }

    public static bool IsSqlite(IConfiguration configuration) => Get(configuration) == Sqlite;
}
