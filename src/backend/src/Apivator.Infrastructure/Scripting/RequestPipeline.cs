using Apivator.Application.Common.Localization;
using Apivator.Application.Execution;

namespace Apivator.Infrastructure.Scripting;

/// <summary>
/// pre-request script'leri → değişken çözümleme → HTTP isteği → post-response script'leri. Script ve değişken
/// gönderilmeyen istekler doğrudan yürütücüye gider.
/// </summary>
internal sealed class RequestPipeline(IRequestExecutor executor, ScriptSandbox sandbox, IOAuth2TokenService oauth) : IRequestPipeline
{
    public async Task<ExecuteHttpResponse> RunAsync(ExecuteHttpRequest request, CancellationToken cancellationToken = default)
    {
        var pre = Named(request.PreRequestScripts, "Pre-request");
        var post = Named(request.PostResponseScripts, "Post-response");
        if (pre.Count == 0 && post.Count == 0 && request.Variables is null)
        {
            var (ready, failure) = await WithOAuth2TokenAsync(request, cancellationToken);
            return failure ?? await executor.ExecuteAsync(ready, cancellationToken);
        }

        var variables = ScriptVariables.From(request.Variables);
        var model = new ScriptRequestModel(
            request.Method,
            request.Url,
            request.Headers ?? [],
            request.Body ?? Domain.Collections.RequestBody.None,
            request.Auth);
        var tests = new List<TestResultDto>();
        var console = new List<ConsoleEntryDto>();
        NextRequestDto? next = null;

        ExecuteHttpResponse Finish(ExecuteHttpResponse response) => response with
        {
            Tests = tests,
            Console = console,
            Variables = request.Variables is null ? null : variables.ToDto(),
            NextRequest = next,
        };

        if (pre.Count > 0)
        {
            var result = sandbox.Run(ScriptSandbox.PreRequest, pre, model, null, variables, request.Info, cancellationToken);
            tests.AddRange(result.Tests);
            console.AddRange(result.Console);
            next = result.NextRequest ?? next;
            model = result.Request;
            if (result.Error is not null)
            {
                return Finish(ExecuteHttpResponse.Failed("script_error", L.T("script.prerequest_failed", "Pre-request script'i hata verdi; istek gönderilmedi. {error}", ("error", result.Error))));
            }

            if (result.Skip)
            {
                return Finish(ExecuteHttpResponse.Failed("skipped", L.T("script.skipped", "İstek pre-request script'inde pm.execution.skipRequest() ile atlandı.")) with { Skipped = true });
            }
        }

        var toSend = request with { Method = model.Method, Url = model.Url, Headers = model.Headers, Body = model.Body, Auth = model.Auth };
        var resolved = VariableResolver.ResolveRequest(toSend, variables.Lookup, out var missing);
        if (missing.Count > 0)
        {
            return Finish(ExecuteHttpResponse.Failed(
                "unresolved_variables",
                L.T("script.undefined_variables", "URL'de tanımsız değişken var: {names}", ("names", string.Join(", ", missing.Select(m => "{{" + m + "}}"))))));
        }

        var (withToken, tokenFailure) = await WithOAuth2TokenAsync(resolved, cancellationToken);
        if (tokenFailure is not null)
        {
            return Finish(tokenFailure);
        }

        var response = await executor.ExecuteAsync(withToken, cancellationToken);

        // Postman'deki gibi: yanıt alınamadıysa test script'leri çalışmaz.
        if (post.Count > 0 && response.Error is null)
        {
            var sentModel = model with { Method = resolved.Method, Url = resolved.Url, Headers = resolved.Headers ?? [], Body = resolved.Body ?? model.Body };
            var result = sandbox.Run(ScriptSandbox.Test, post, sentModel, response, variables, request.Info, cancellationToken);
            tests.AddRange(result.Tests);
            console.AddRange(result.Console);
            next = result.NextRequest ?? next;
        }

        return Finish(response);
    }

    public async Task<(ExecuteHttpRequest? Request, ExecuteHttpResponse? Failure)> PrepareAsync(ExecuteHttpRequest request, CancellationToken cancellationToken = default)
    {
        var resolved = request;
        if (request.Variables is not null)
        {
            var variables = ScriptVariables.From(request.Variables);
            resolved = VariableResolver.ResolveRequest(request, variables.Lookup, out var missing);
            if (missing.Count > 0)
            {
                return (null, ExecuteHttpResponse.Failed(
                    "unresolved_variables",
                    L.T("script.undefined_variables", "URL'de tanımsız değişken var: {names}", ("names", string.Join(", ", missing.Select(m => "{{" + m + "}}"))))));
            }
        }

        var (ready, failure) = await WithOAuth2TokenAsync(resolved, cancellationToken);
        return failure is null ? (ready, null) : (null, failure);
    }

    /// <summary>OAuth 2.0 isteğinde token yoksa (client credentials / password) sunucu alır ve önbellekte tutar.</summary>
    private async Task<(ExecuteHttpRequest Request, ExecuteHttpResponse? Failure)> WithOAuth2TokenAsync(ExecuteHttpRequest request, CancellationToken ct)
    {
        if (request.Auth is not { Type: Domain.Collections.AuthType.OAuth2 } auth || auth.OAuth2AccessToken.Length > 0)
        {
            return (request, null);
        }

        var token = await oauth.GetForRequestAsync(auth, ct);
        return token.IsSuccess
            ? (request with { Auth = auth with { OAuth2AccessToken = token.Value! } }, null)
            : (request, ExecuteHttpResponse.Failed(token.Error!.Code, token.Error.Message));
    }

    private static List<(string Source, string Code)> Named(IReadOnlyList<string>? scripts, string label)
    {
        var list = (scripts ?? []).ToList();
        return list
            .Select((code, i) => (Source: list.Count == 1 ? label : $"{label} #{i + 1}", Code: code))
            .Where(s => !string.IsNullOrWhiteSpace(s.Code))
            .ToList();
    }
}
