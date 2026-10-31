using Apivator.Application.Abstractions;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Domain.Access;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Application.ApiKeys;

public sealed record ApiKeyDto(
    Guid Id,
    string Name,
    string Prefix,
    DateTimeOffset CreatedAt,
    DateTimeOffset? ExpiresAt,
    DateTimeOffset? LastUsedAt,
    bool Active);

/// <summary><paramref name="ExpiresInDays"/> boşsa süresiz.</summary>
public sealed record CreateApiKeyRequest(string Name, int? ExpiresInDays = null);

/// <summary>Anahtarın kendisi yalnızca bu yanıtta döner.</summary>
public sealed record CreatedApiKeyDto(ApiKeyDto Key, string Secret);

/// <summary>Doğrulanan anahtarın sahibi (kimlik doğrulama için).</summary>
public sealed record ApiKeyOwner(Guid KeyId, Guid UserId, string DisplayName);

public interface IApiKeyService
{
    Task<IReadOnlyList<ApiKeyDto>> ListAsync(Guid userId, CancellationToken ct = default);

    Task<Result<CreatedApiKeyDto>> CreateAsync(CreateApiKeyRequest request, Guid userId, CancellationToken ct = default);

    Task<Result> RevokeAsync(Guid keyId, Guid userId, CancellationToken ct = default);

    /// <summary>Geçerli (iptal edilmemiş, süresi dolmamış) anahtarın sahibini döner; kullanım zamanını günceller.</summary>
    Task<ApiKeyOwner?> AuthenticateAsync(string secret, CancellationToken ct = default);
}

internal sealed class ApiKeyService(IApplicationDbContext db, IUserDirectory users, TimeProvider clock) : IApiKeyService
{
    private const int MaxExpiryDays = 3650;

    public async Task<IReadOnlyList<ApiKeyDto>> ListAsync(Guid userId, CancellationToken ct = default)
    {
        var now = clock.GetUtcNow();
        var keys = await db.ApiKeys.AsNoTracking()
            .Where(k => k.UserId == userId && k.RevokedAt == null)
            .OrderByDescending(k => k.CreatedAt)
            .ToListAsync(ct);
        return keys.Select(k => ToDto(k, now)).ToList();
    }

    public async Task<Result<CreatedApiKeyDto>> CreateAsync(CreateApiKeyRequest request, Guid userId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Trim().Length > ApiKey.NameMaxLength)
        {
            return Error.Validation("validation", L.T("api_key.name_length", "Anahtar adı 1–{max} karakter olmalı (ör. \"GitHub Actions\").", ("max", ApiKey.NameMaxLength)));
        }

        if (request.ExpiresInDays is < 1 or > MaxExpiryDays)
        {
            return Error.Validation("validation", L.T("api_key.expiry_range", "Geçerlilik 1 ile {max} gün arasında olmalı.", ("max", MaxExpiryDays)));
        }

        var now = clock.GetUtcNow();
        var active = await db.ApiKeys.CountAsync(k => k.UserId == userId && k.RevokedAt == null && (k.ExpiresAt == null || k.ExpiresAt > now), ct);
        if (active >= ApiKey.MaxActivePerUser)
        {
            return Error.Validation("api_key.limit", L.T("api_key.limit", "En fazla {max} etkin anahtarınız olabilir; kullanmadıklarınızı iptal edin.", ("max", ApiKey.MaxActivePerUser)));
        }

        var (key, secret) = ApiKey.Create(userId, request.Name, request.ExpiresInDays is { } days ? now.AddDays(days) : null, now);
        db.ApiKeys.Add(key);
        await db.SaveChangesAsync(ct);
        return new CreatedApiKeyDto(ToDto(key, now), secret);
    }

    public async Task<Result> RevokeAsync(Guid keyId, Guid userId, CancellationToken ct = default)
    {
        var key = await db.ApiKeys.FirstOrDefaultAsync(k => k.Id == keyId && k.UserId == userId, ct);
        if (key is null)
        {
            return Error.NotFound("api_key.not_found", L.T("api_key.not_found", "Anahtar bulunamadı."));
        }

        key.Revoke(clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    public async Task<ApiKeyOwner?> AuthenticateAsync(string secret, CancellationToken ct = default)
    {
        if (!secret.StartsWith(ApiKey.TokenPrefix, StringComparison.Ordinal) || secret.Length > 100)
        {
            return null;
        }

        var hash = ApiKey.HashOf(secret);
        var key = await db.ApiKeys.FirstOrDefaultAsync(k => k.Hash == hash, ct);
        var now = clock.GetUtcNow();
        if (key is null || !key.IsActive(now))
        {
            return null;
        }

        var user = (await users.UsersAsync([key.UserId], ct)).GetValueOrDefault(key.UserId);
        if (user is null)
        {
            return null;
        }

        // Her istekte yazmamak için: son kullanım birkaç dakikada bir güncellenir.
        if (key.LastUsedAt is null || now - key.LastUsedAt > TimeSpan.FromMinutes(5))
        {
            key.MarkUsed(now);
            await db.SaveChangesAsync(ct);
        }

        return new ApiKeyOwner(key.Id, key.UserId, user.DisplayName);
    }

    private static ApiKeyDto ToDto(ApiKey k, DateTimeOffset now) =>
        new(k.Id, k.Name, k.Prefix, k.CreatedAt, k.ExpiresAt, k.LastUsedAt, k.IsActive(now));
}
