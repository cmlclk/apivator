using Apivator.Application.Common.Localization;
using Microsoft.AspNetCore.Diagnostics;

namespace Apivator.Api.Infrastructure;

internal sealed class UnhandledExceptionHandler(IProblemDetailsService problemDetails, ILogger<UnhandledExceptionHandler> logger)
    : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        if (exception is BadHttpRequestException badRequest)
        {
            httpContext.Response.StatusCode = badRequest.StatusCode;
            return await problemDetails.TryWriteAsync(new ProblemDetailsContext
            {
                HttpContext = httpContext,
                ProblemDetails = { Status = badRequest.StatusCode, Detail = L.T("api.body_unreadable", "İstek gövdesi okunamadı.") },
            });
        }

        logger.LogError(exception, "Beklenmeyen hata: {Path}", httpContext.Request.Path);
        httpContext.Response.StatusCode = StatusCodes.Status500InternalServerError;
        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = httpContext,
            ProblemDetails = { Status = 500, Detail = L.T("api.unexpected", "Beklenmeyen bir hata oluştu.") },
        });
    }
}
