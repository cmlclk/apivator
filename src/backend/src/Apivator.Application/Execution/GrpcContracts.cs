using System.Net.WebSockets;
using System.Text.Json.Nodes;
using Apivator.Application.Common;

namespace Apivator.Application.Execution;

/// <summary>Yüklenen bir .proto dosyası (import edilen dosyalar da ayrı ayrı gelir).</summary>
public sealed record ProtoFileDto(string Name, string Content);

/// <summary>
/// Servis tanımlarını çıkarma isteği: ya .proto dosyalarından ya da sunucunun reflection servisinden
/// (<see cref="UseReflection"/>; adres ve metadata yalnızca bunun için kullanılır).
/// </summary>
public sealed record GrpcDescribeRequest(
    string? Url,
    IReadOnlyList<HttpHeaderDto>? Metadata,
    IReadOnlyList<ProtoFileDto>? ProtoFiles,
    bool UseReflection);

/// <param name="InputSchema">Girdi mesajının JSON Schema'sı (model üretimi için).</param>
/// <param name="OutputSchema">Çıktı mesajının JSON Schema'sı.</param>
public sealed record GrpcMethodDto(
    string Name,
    string Path,
    bool ClientStreaming,
    bool ServerStreaming,
    string InputType,
    string OutputType,
    string Sample,
    JsonObject? InputSchema = null,
    JsonObject? OutputSchema = null);

public sealed record GrpcServiceDto(string Name, IReadOnlyList<GrpcMethodDto> Methods);

/// <summary>
/// Servisler ve metotlar; <see cref="DescriptorSet"/> (base64 FileDescriptorSet) çağrı başlatılırken geri gönderilir,
/// böylece köprü tanımları yeniden ayrıştırmak ya da sunucuya tekrar sormak zorunda kalmaz.
/// </summary>
public sealed record GrpcSchemaDto(IReadOnlyList<GrpcServiceDto> Services, string DescriptorSet, IReadOnlyList<string> Warnings);

public interface IGrpcService
{
    Task<Result<GrpcSchemaDto>> DescribeAsync(GrpcDescribeRequest request, CancellationToken cancellationToken = default);
}

/// <summary>
/// Tarayıcı ↔ gRPC sunucusu köprüsü. Tarayıcı HTTP/2 çerçevelerine ve trailer'lara erişemediği için çağrı köprüden
/// (sunucu ya da masaüstünde yerel ajan) yapılır; mesajlar iki yönde JSON olarak aktarılır. Unary, sunucu akışı,
/// istemci akışı ve çift yönlü akış aynı protokolle yürür.
/// </summary>
public interface IGrpcRelay
{
    Task RunAsync(WebSocket client, CancellationToken cancellationToken = default);
}
