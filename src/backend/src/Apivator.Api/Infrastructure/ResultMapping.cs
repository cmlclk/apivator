using Apivator.Application.Common;

namespace Apivator.Api.Infrastructure;

/// <summary>Application katmanının <see cref="Error"/> tipini RFC 9457 ProblemDetails yanıtına çevirir.</summary>
internal static class ResultMapping
{
    public static IResult ToProblem(this Error error)
    {
        var status = error.Type switch
        {
            ErrorType.Validation => StatusCodes.Status400BadRequest,
            ErrorType.Unauthorized => StatusCodes.Status401Unauthorized,
            ErrorType.Forbidden => StatusCodes.Status403Forbidden,
            ErrorType.NotFound => StatusCodes.Status404NotFound,
            ErrorType.Conflict => StatusCodes.Status409Conflict,
            ErrorType.Locked => StatusCodes.Status423Locked,
            _ => StatusCodes.Status500InternalServerError,
        };

        var extensions = new Dictionary<string, object?> { ["code"] = error.Code };

        return error.Details is { Count: > 0 } details
            ? Results.ValidationProblem(details.ToDictionary(), detail: error.Message, extensions: extensions)
            : Results.Problem(detail: error.Message, statusCode: status, extensions: extensions);
    }

    public static IResult ToOk<T>(this Result<T> result) =>
        result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();

    public static IResult ToHttp(this Result result) =>
        result.IsSuccess ? Results.NoContent() : result.Error!.ToProblem();
}
