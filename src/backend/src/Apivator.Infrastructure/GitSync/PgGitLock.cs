using Apivator.Application.GitSync;
using Apivator.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Apivator.Infrastructure.GitSync;

/// <summary>
/// Collection başına PostgreSQL oturum kilidi (pg_advisory_lock): birden fazla API örneğinde aynı collection için
/// gönderme/alma aynı anda çalışmaz. Kilit ayrı bir bağlantıda tutulur; bağlantı kapanınca da düşer.
/// </summary>
internal sealed class PgGitLock(AppDbContext db) : IGitLock
{

    public async Task<IAsyncDisposable> AcquireAsync(Guid collectionId, CancellationToken ct = default)
    {
        var connection = new NpgsqlConnection(db.Database.GetConnectionString());
        try
        {
            await connection.OpenAsync(ct);
            var key = collectionId.ToString();
            await using var command = new NpgsqlCommand("SELECT pg_advisory_lock(hashtextextended(@k, 0))", connection);
            command.Parameters.AddWithValue("k", key);
            await command.ExecuteNonQueryAsync(ct);
            return new Handle(connection, key);
        }
        catch
        {
            await connection.DisposeAsync();
            throw;
        }
    }

    private sealed class Handle(NpgsqlConnection connection, string key) : IAsyncDisposable
    {
        public async ValueTask DisposeAsync()
        {
            try
            {
                await using var command = new NpgsqlCommand("SELECT pg_advisory_unlock(hashtextextended(@k, 0))", connection);
                command.Parameters.AddWithValue("k", key);
                await command.ExecuteNonQueryAsync();
            }
            finally
            {
                await connection.DisposeAsync();
            }
        }
    }
}
