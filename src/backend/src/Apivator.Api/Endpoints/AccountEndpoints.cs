using Apivator.Api.Infrastructure;
using Apivator.Application.Abstractions;
using Apivator.Application.Account;
using Apivator.Application.Common.Localization;
using Microsoft.Net.Http.Headers;

namespace Apivator.Api.Endpoints;

/// <summary>Hesap ve profil (6.3): profil, avatar, e-posta/şifre değiştirme, oturumlar, tercihler, dışa aktarma ve silme.</summary>
internal static class AccountEndpoints
{
    public static void MapAccountEndpoints(this IEndpointRouteBuilder routes)
    {
        var me = routes.MapGroup("/me").WithTags("Account").RequireAuthorization();

        // Şifre isteyen işlemler giriş denemeleriyle aynı sıkı sınıra bağlıdır.
        var sensitive = routes.MapGroup("/me").WithTags("Account").RequireAuthorization().RequireRateLimiting(RateLimitPolicies.Auth);

        // İki adımlı doğrulama ve güvenlik geçmişi (6.4).
        me.MapGet("/2fa", async (ISecurityService security, ICurrentUser user, CancellationToken ct) =>
            (await security.StatusAsync(user.RequiredId, ct)).ToOk());
        sensitive.MapPost("/2fa/setup", async (ISecurityService security, ICurrentUser user, CancellationToken ct) =>
            (await security.BeginSetupAsync(user.RequiredId, ct)).ToOk());
        sensitive.MapPost("/2fa/enable", async (TwoFactorCodeRequest request, ISecurityService security, ICurrentUser user, CancellationToken ct) =>
            (await security.EnableAsync(user.RequiredId, request, ct)).ToOk());
        sensitive.MapPost("/2fa/disable", async (DisableTwoFactorRequest request, ISecurityService security, ICurrentUser user, CancellationToken ct) =>
            (await security.DisableAsync(user.RequiredId, request, ct)).ToHttp());
        sensitive.MapPost("/2fa/recovery-codes", async (TwoFactorCodeRequest request, ISecurityService security, ICurrentUser user, CancellationToken ct) =>
            (await security.RegenerateRecoveryCodesAsync(user.RequiredId, request, ct)).ToOk());
        me.MapGet("/security-events", async (ISecurityService security, ICurrentUser user, CancellationToken ct) =>
            Results.Ok(await security.EventsAsync(user.RequiredId, ct)));

        me.MapGet("/profile", async (IAccountService account, ICurrentUser user, CancellationToken ct) =>
            (await account.GetProfileAsync(user.RequiredId, ct)).ToOk());

        me.MapPatch("/profile", async (UpdateProfileRequest request, IAccountService account, ICurrentUser user, CancellationToken ct) =>
            (await account.UpdateProfileAsync(user.RequiredId, request, ct)).ToOk());

        // Gövde ham görsel (PNG, JPEG, WebP); istemci önceden küçültüp kırpar.
        me.MapPut("/avatar", async (HttpRequest http, IAccountService account, ICurrentUser user, CancellationToken ct) =>
            {
                if (http.ContentLength is > AccountLimits.AvatarMaxBytes)
                {
                    return Results.Problem(detail: L.T("account.avatar_too_large", "Görsel en fazla {kb} KB olabilir.", ("kb", AccountLimits.AvatarMaxBytes / 1024)), statusCode: StatusCodes.Status413PayloadTooLarge);
                }

                using var buffer = new MemoryStream();
                await http.Body.CopyToAsync(buffer, ct);
                var result = await account.SetAvatarAsync(user.RequiredId, http.ContentType, buffer.ToArray(), ct);
                return result.IsSuccess ? Results.Ok(new { avatarVersion = result.Value }) : result.Error!.ToProblem();
            })
            .WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(AccountLimits.AvatarMaxBytes + 1024));

        me.MapDelete("/avatar", async (IAccountService account, ICurrentUser user, CancellationToken ct) =>
            (await account.RemoveAvatarAsync(user.RequiredId, ct)).ToHttp());

        sensitive.MapPost("/email", async (ChangeEmailRequest request, IAccountService account, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await account.RequestEmailChangeAsync(user.RequiredId, request, ct);
            return result.IsSuccess ? Results.Accepted() : result.Error!.ToProblem();
        });

        me.MapDelete("/email/pending", async (IAccountService account, ICurrentUser user, CancellationToken ct) =>
            (await account.CancelEmailChangeAsync(user.RequiredId, ct)).ToHttp());

        sensitive.MapPost("/password", async (ChangePasswordRequest request, IAccountService account, ICurrentUser user, HttpContext http, CancellationToken ct) =>
            (await account.ChangePasswordAsync(user.RequiredId, ClientInfoReader.SessionId(http), request, ct)).ToHttp());

        me.MapGet("/sessions", async (IAccountService account, ICurrentUser user, HttpContext http, CancellationToken ct) =>
            Results.Ok(await account.ListSessionsAsync(user.RequiredId, ClientInfoReader.SessionId(http), ct)));

        me.MapDelete("/sessions/{id:guid}", async (Guid id, IAccountService account, ICurrentUser user, CancellationToken ct) =>
            (await account.RevokeSessionAsync(user.RequiredId, id, ct)).ToHttp());

        me.MapPost("/sessions/revoke-others", async (IAccountService account, ICurrentUser user, HttpContext http, CancellationToken ct) =>
            Results.Ok(new { revoked = await account.RevokeOtherSessionsAsync(user.RequiredId, ClientInfoReader.SessionId(http), ct) }));

        me.MapGet("/preferences", async (IAccountService account, ICurrentUser user, CancellationToken ct) =>
            (await account.GetPreferencesAsync(user.RequiredId, ct)).ToOk());

        me.MapPut("/preferences", async (PreferencesDto request, IAccountService account, ICurrentUser user, CancellationToken ct) =>
            (await account.UpdatePreferencesAsync(user.RequiredId, request, ct)).ToOk());

        me.MapGet("/export", async (IAccountService account, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await account.ExportAsync(user.RequiredId, ct);
            return result.IsSuccess
                ? Results.File(result.Value.Content, "application/zip", result.Value.FileName)
                : result.Error!.ToProblem();
        });

        me.MapGet("/deletion", async (IAccountService account, ICurrentUser user, CancellationToken ct) =>
            (await account.CheckDeletionAsync(user.RequiredId, ct)).ToOk());

        sensitive.MapPost("/deletion", async (DeleteAccountRequest request, IAccountService account, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await account.RequestDeletionAsync(user.RequiredId, request, ct);
            return result.IsSuccess ? Results.Accepted() : result.Error!.ToProblem();
        });

        // E-postadaki bağlantılar: oturum gerekmez (bağlantı başka bir tarayıcıda açılabilir); token doğrular.
        var links = routes.MapGroup("/auth").WithTags("Account").RequireRateLimiting(RateLimitPolicies.Auth);

        links.MapPost("/confirm-email-change", async (ConfirmEmailChangeRequest request, IAccountService account, CancellationToken ct) =>
            (await account.ConfirmEmailChangeAsync(request, ct)).ToHttp());

        links.MapPost("/delete-account", async (ConfirmAccountDeletionRequest request, IAccountService account, HttpContext http, CancellationToken ct) =>
        {
            var result = await account.ConfirmDeletionAsync(request, ct);
            if (result.IsSuccess)
            {
                RefreshTokenCookie.Clear(http);
            }

            return result.ToHttp();
        });

        // Profil görselleri herkese açıktır (adres kullanıcı kimliğini içerir); <img> başlık taşıyamaz.
        routes.MapGet("/users/{id:guid}/avatar", async (Guid id, IAccountService account, HttpContext http, CancellationToken ct) =>
            {
                var avatar = await account.GetAvatarAsync(id, ct);
                if (avatar is null)
                {
                    return Results.NotFound();
                }

                http.Response.Headers[HeaderNames.CacheControl] = http.Request.Query.ContainsKey("v")
                    ? "public, max-age=31536000, immutable"
                    : "public, max-age=300";
                http.Response.Headers[HeaderNames.XContentTypeOptions] = "nosniff";
                return Results.File(avatar.Data, avatar.ContentType);
            })
            .WithTags("Account")
            .AllowAnonymous()
            .RequireRateLimiting(RateLimitPolicies.Docs);
    }
}
