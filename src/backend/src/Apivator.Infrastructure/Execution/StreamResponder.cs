using System.Text.Json;
using System.Text.Json.Serialization;
using Apivator.Application.Execution;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;

namespace Apivator.Infrastructure.Execution;

/// <summary>Akan isteği (SSE) NDJSON olarak yanıta yazar; API ve masaüstü ajanı aynı kodu kullanır.</summary>
public static class StreamResponder
{
    public static async Task WriteAsync(
        ExecuteHttpRequest request,
        IRequestPipeline pipeline,
        IRequestStreamer streamer,
        JsonSerializerOptions serializerOptions,
        HttpContext http,
        CancellationToken ct)
    {
        var options = new JsonSerializerOptions(serializerOptions) { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };
        http.Features.Get<IHttpResponseBodyFeature>()?.DisableBuffering();
        http.Response.ContentType = "application/x-ndjson; charset=utf-8";
        http.Response.Headers.CacheControl = "no-cache";

        async Task Emit(StreamEvent e)
        {
            await JsonSerializer.SerializeAsync(http.Response.Body, e, options, CancellationToken.None);
            await http.Response.Body.WriteAsync("\n"u8.ToArray(), CancellationToken.None);
            await http.Response.Body.FlushAsync(CancellationToken.None);
        }

        var (ready, failure) = await pipeline.PrepareAsync(request, ct);
        if (failure is not null)
        {
            await Emit(new StreamEvent("error") { Message = failure.Error?.Message });
            return;
        }

        try
        {
            await streamer.StreamAsync(ready!, Emit, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // İstemci durdurdu.
        }
    }
}
