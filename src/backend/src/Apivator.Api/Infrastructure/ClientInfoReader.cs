using Apivator.Application.Account;
using Apivator.Infrastructure.Identity;

namespace Apivator.Api.Infrastructure;

internal static class ClientInfoReader
{
    /// <summary>Masaüstü uygulaması ve CLI kendini bu başlıkla tanıtır ("desktop", "cli"); web göndermez.</summary>
    public const string AppHeader = "X-Apivator-App";

    public static ClientInfo From(HttpContext context) => new(
        context.Request.Headers.UserAgent.ToString(),
        context.Connection.RemoteIpAddress?.ToString(),
        context.Request.Headers[AppHeader].FirstOrDefault());

    /// <summary>Access token'daki oturum kimliği ("sid"); API anahtarıyla gelen isteklerde yoktur.</summary>
    public static Guid? SessionId(HttpContext context) =>
        Guid.TryParse(context.User.FindFirst(TokenService.SessionClaim)?.Value, out var id) ? id : null;
}
