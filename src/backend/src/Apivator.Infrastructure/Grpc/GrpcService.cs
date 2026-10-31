using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Execution;
using Apivator.Infrastructure.Execution;
using Microsoft.Extensions.Options;

namespace Apivator.Infrastructure.Grpc;

/// <summary>.proto dosyalarından ya da server reflection'dan servis/metot listesini çıkarır.</summary>
internal sealed class GrpcService(IExecutionHttpClientSource clients, IOptionsMonitor<ProxyOptions> options) : IGrpcService
{
    public const int MaxProtoFiles = Domain.Collections.GrpcSettings.MaxProtoFiles;

    private static readonly JsonSerializerOptions SampleJson = new()
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public async Task<Result<GrpcSchemaDto>> DescribeAsync(GrpcDescribeRequest request, CancellationToken cancellationToken = default)
    {
        ProtoSchema schema;
        var warnings = new List<string>();
        if (request.UseReflection)
        {
            if (!GrpcCall.TryParseAddress(request.Url, out var address, out var addressError))
            {
                return Error.Validation("grpc.invalid_address", addressError);
            }

            var settings = options.CurrentValue;
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(settings.TimeoutSeconds));
            try
            {
                var (files, reflectionWarnings) = await ReflectionClient.LoadAsync(
                    clients.CreateClient(), address, request.Metadata ?? [], settings.WebSocketMaxMessageBytes * 8, timeout.Token);
                schema = ProtoSchema.FromFileDescriptors(files);
                warnings.AddRange(reflectionWarnings);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                return Error.Validation("grpc.timeout", L.T("grpc.timeout", "Sunucu {seconds} saniye içinde reflection yanıtı vermedi.", ("seconds", settings.TimeoutSeconds)));
            }
            catch (HttpRequestException ex)
            {
                return Error.Validation("grpc.connection_failed", Explain(ex, address, settings.SslErrorHint));
            }
            catch (ProtoException ex)
            {
                return Error.Validation("grpc.reflection_failed", ex.Message);
            }
        }
        else
        {
            var files = request.ProtoFiles ?? [];
            if (files.Count == 0)
            {
                return Error.Validation("grpc.no_proto", L.T("grpc.no_proto", ".proto dosyası yüklenmedi."));
            }

            if (files.Count > MaxProtoFiles || files.Sum(f => (long)f.Content.Length) > ProtoSchema.MaxProtoBytes)
            {
                return Error.Validation(
                    "grpc.proto_too_large",
                    L.T("grpc.proto_limits", "En fazla {files} dosya ve toplam {max} MB yüklenebilir.", ("files", MaxProtoFiles), ("max", ProtoSchema.MaxProtoBytes / 1024 / 1024)));
            }

            var (parsed, errors) = ProtoSchema.FromProtoFiles(files.Select(f => (f.Name, f.Content)));
            if (parsed is null)
            {
                return Error.Validation("grpc.proto_invalid", string.Join("\n", errors.Take(20)));
            }

            schema = parsed;
        }

        var codec = new ProtoJson(schema);
        var services = new List<GrpcServiceDto>();
        foreach (var (name, methods) in schema.Services.OrderBy(s => s.Service, StringComparer.Ordinal))
        {
            var items = new List<GrpcMethodDto>();
            foreach (var method in methods)
            {
                string sample;
                JsonObject? inputSchema = null;
                JsonObject? outputSchema = null;
                try
                {
                    sample = JsonSerializer.Serialize(codec.Sample(method.InputType), SampleJson);
                    inputSchema = codec.JsonSchema(method.InputType);
                    outputSchema = codec.JsonSchema(method.OutputType);
                }
                catch (ProtoException ex)
                {
                    sample = "{}";
                    warnings.Add($"{name}/{method.Name}: {ex.Message}");
                }

                items.Add(new GrpcMethodDto(
                    method.Name,
                    $"/{name}/{method.Name}",
                    method.ClientStreaming,
                    method.ServerStreaming,
                    method.InputType.TrimStart('.'),
                    method.OutputType.TrimStart('.'),
                    sample,
                    inputSchema,
                    outputSchema));
            }

            services.Add(new GrpcServiceDto(name, items));
        }

        if (services.Count == 0)
        {
            warnings.Add(L.T("grpc.no_services", "Tanımlarda servis yok."));
        }

        return new GrpcSchemaDto(services, Convert.ToBase64String(schema.ToDescriptorSet()), warnings);
    }

    internal static string Explain(HttpRequestException ex, Uri address, string? sslHint)
    {
        var (code, message) = NetworkErrors.Describe(ex, address, sslHint);
        if (code == "network" && (ex.Message.Contains("HTTP/2", StringComparison.OrdinalIgnoreCase) || ex.HttpRequestError == HttpRequestError.VersionNegotiationError))
        {
            return address.Scheme == "http"
                ? L.T("grpc.h2c", "Sunucu TLS'siz HTTP/2 (h2c) konuşmuyor. TLS kullanıyorsa adresi grpcs:// ile yazın. ({message})", ("message", ex.Message))
                : L.T("grpc.no_http2", "Sunucu HTTP/2 desteklemiyor; gRPC için HTTP/2 gerekir. ({message})", ("message", ex.Message));
        }

        if (code == "network" && address.Scheme == "https" && ex.HttpRequestError == HttpRequestError.SecureConnectionError)
        {
            return L.T("grpc.tls_failed", "TLS bağlantısı kurulamadı. Sunucu TLS kullanmıyorsa adresi grpc:// ile yazın. ({message})", ("message", ex.Message));
        }

        return message;
    }
}
