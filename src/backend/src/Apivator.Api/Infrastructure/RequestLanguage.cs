using Apivator.Application.Abstractions;
using Apivator.Application.Common.Localization;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Apivator.Api.Infrastructure;

/// <summary>
/// İsteğin dilini belirler (Faz 8.2): <c>?lang=</c> (canlı kanal başlık gönderemez) → <c>Accept-Language</c> →
/// oturum açmış kullanıcının kayıtlı tercihi → Türkçe. Web istemcisi etkin arayüz dilini her istekte başlıkla
/// gönderir; tercih yalnızca başlık göndermeyen istemciler (CLI, API anahtarı) için okunur.
/// </summary>
internal static class RequestLanguage
{
    private const string ExplicitKey = "apivator.lang.explicit";

    /// <summary>Hata işleyicisinden önce: başlıktaki dil yakalanmamış hataların iletisine de uygulanır.</summary>
    public static IApplicationBuilder UseRequestLanguage(this IApplicationBuilder app) =>
        app.Use(async (context, next) =>
        {
            var language = Lang.Match(context.Request.Query["lang"].ToString())
                ?? Lang.FromAcceptLanguage(context.Request.Headers.AcceptLanguage.ToString());
            if (language is not null)
            {
                context.Items[ExplicitKey] = true;
            }

            using (Lang.Use(language))
            {
                await next(context);
            }
        });

    /// <summary>Kimlik doğrulamadan sonra: istek dil belirtmediyse kullanıcının kayıtlı tercihi.</summary>
    public static IApplicationBuilder UseUserLanguage(this IApplicationBuilder app) =>
        app.Use(async (context, next) =>
        {
            if (context.Items.ContainsKey(ExplicitKey)
                || !Guid.TryParse(context.User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value, out var userId))
            {
                await next(context);
                return;
            }

            var cache = context.RequestServices.GetRequiredService<IMemoryCache>();
            var language = await cache.GetOrCreateAsync(("lang", userId), async entry =>
            {
                entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(1);
                var users = context.RequestServices.GetRequiredService<IUserDirectory>();
                return await users.PreferredLanguageAsync(userId, context.RequestAborted);
            });

            using (Lang.Use(language))
            {
                await next(context);
            }
        });
}
