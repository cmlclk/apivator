using System.Diagnostics;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Apivator.Api.Infrastructure;

/// <summary>
/// İstek başına tek log satırı: yöntem, yol, durum, süre ve kullanıcı. Sorgu dizgisi yazılmaz (davet ve sıfırlama
/// token'ları orada olabilir); sağlık kontrolleri ve canlı kanal yazılmaz. "Apivator.Requests" kategorisiyle
/// açılıp kapatılır.
/// </summary>
internal static partial class RequestLogging
{
    public static IApplicationBuilder UseRequestLogging(this IApplicationBuilder app)
    {
        var logger = app.ApplicationServices.GetRequiredService<ILoggerFactory>().CreateLogger("Apivator.Requests");
        return app.Use(async (context, next) =>
        {
            var path = context.Request.Path;
            if (!logger.IsEnabled(LogLevel.Information) || path.StartsWithSegments("/health") || path.StartsWithSegments("/hubs"))
            {
                await next(context);
                return;
            }

            var started = Stopwatch.GetTimestamp();
            try
            {
                await next(context);
            }
            finally
            {
                var elapsed = Stopwatch.GetElapsedTime(started).TotalMilliseconds;
                var user = context.User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value ?? "-";
                var status = context.RequestAborted.IsCancellationRequested ? 499 : context.Response.StatusCode;
                if (status >= 500)
                {
                    LogFailed(logger, context.Request.Method, path.Value ?? "/", status, elapsed, user);
                }
                else
                {
                    LogRequest(logger, context.Request.Method, path.Value ?? "/", status, elapsed, user);
                }
            }
        });
    }

    [LoggerMessage(EventId = 1, Level = LogLevel.Information, Message = "HTTP {Method} {Path} {Status} {ElapsedMs:0} ms {UserId}")]
    private static partial void LogRequest(ILogger logger, string method, string path, int status, double elapsedMs, string userId);

    [LoggerMessage(EventId = 2, Level = LogLevel.Warning, Message = "HTTP {Method} {Path} {Status} {ElapsedMs:0} ms {UserId}")]
    private static partial void LogFailed(ILogger logger, string method, string path, int status, double elapsedMs, string userId);
}
