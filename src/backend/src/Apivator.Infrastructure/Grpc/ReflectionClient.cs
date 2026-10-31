using System.Buffers;
using System.Text;
using Apivator.Application.Common.Localization;
using Apivator.Application.Execution;
using Google.Protobuf.Reflection;

namespace Apivator.Infrastructure.Grpc;

/// <summary>
/// gRPC server reflection istemcisi (grpc.reflection.v1, yoksa v1alpha; ikisinin kablo biçimi aynı). Tek bir çift
/// yönlü akışta servis listesini, her servisin tanım dosyasını ve eksik bağımlılıkları sırayla ister. Mesajlar küçük
/// ve sabit olduğu için elle kodlanır.
/// </summary>
internal static class ReflectionClient
{
    private const string V1 = "/grpc.reflection.v1.ServerReflection/ServerReflectionInfo";
    private const string V1Alpha = "/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo";
    private const int MaxFiles = 500;

    public static async Task<(IReadOnlyList<FileDescriptorProto> Files, IReadOnlyList<string> Warnings)> LoadAsync(
        HttpClient client,
        Uri address,
        IReadOnlyList<HttpHeaderDto> metadata,
        int maxMessageBytes,
        CancellationToken cancellationToken)
    {
        try
        {
            return await LoadAsync(client, address, V1, metadata, maxMessageBytes, cancellationToken);
        }
        catch (ReflectionUnavailableException)
        {
            try
            {
                return await LoadAsync(client, address, V1Alpha, metadata, maxMessageBytes, cancellationToken);
            }
            catch (ReflectionUnavailableException ex)
            {
                throw new ProtoException(L.T("grpc.reflection_unavailable", "Sunucu reflection servisini sunmuyor ({message}). .proto dosyalarını yükleyin.", ("message", ex.Message)));
            }
        }
    }

    private static async Task<(IReadOnlyList<FileDescriptorProto>, IReadOnlyList<string>)> LoadAsync(
        HttpClient client,
        Uri address,
        string path,
        IReadOnlyList<HttpHeaderDto> metadata,
        int maxMessageBytes,
        CancellationToken cancellationToken)
    {
        using var call = GrpcCall.Start(client, address, path, metadata, deadline: null, maxMessageBytes, cancellationToken);
        var files = new Dictionary<string, FileDescriptorProto>(StringComparer.Ordinal);
        var warnings = new List<string>();

        async Task<ReadOnlyMemory<byte>> Ask(int field, string value)
        {
            call.Send(Request(field, value));
            var response = await call.ReadAsync();
            if (response is null)
            {
                throw Failure(call.FinalStatus());
            }

            return response;
        }

        // 1) Servis listesi.
        var services = new List<string>();
        Parse(await Ask(7, "*"), out var listed, out _, out var listError);
        if (listError is not null)
        {
            throw new ProtoException(L.T("grpc.reflection_no_list", "Reflection servis listesini vermedi: {error}", ("error", listError)));
        }

        services.AddRange(listed.Where(s => !s.StartsWith("grpc.reflection.", StringComparison.Ordinal)));

        // 2) Her servisin tanım dosyası (yanıt bağımlılıkları da içerebilir).
        foreach (var service in services)
        {
            if (files.Values.Any(f => f.Services.Any(s => ProtoSchema.Qualify(f.Package, s.Name) == service)))
            {
                continue;
            }

            Parse(await Ask(4, service), out _, out var descriptors, out var error);
            if (error is not null)
            {
                warnings.Add($"{service}: {error}");
            }

            Add(files, descriptors);
        }

        // 3) Eksik bağımlılıklar.
        var missing = new Queue<string>(MissingDependencies(files));
        var attempted = new HashSet<string>(StringComparer.Ordinal);
        while (missing.TryDequeue(out var name) && files.Count < MaxFiles)
        {
            if (files.ContainsKey(name) || !attempted.Add(name))
            {
                continue;
            }

            Parse(await Ask(3, name), out _, out var descriptors, out var error);
            if (error is not null || descriptors.Count == 0)
            {
                // google/protobuf/*.proto sunucuda kayıtlı olmayabilir; kütüphanenin içindekiler kullanılır.
                if (BuiltIn(name) is { } builtIn)
                {
                    files[name] = builtIn;
                }
                else
                {
                    warnings.Add(L.T("grpc.dependency_failed", "{name} bağımlılığı alınamadı{detail}", ("name", name), ("detail", error is null ? "." : $": {error}")));
                }
            }

            Add(files, descriptors);
            foreach (var next in MissingDependencies(files))
            {
                missing.Enqueue(next);
            }
        }

        call.CompleteRequest();
        return ([.. files.Values], warnings);
    }

    private static void Add(Dictionary<string, FileDescriptorProto> files, IEnumerable<FileDescriptorProto> descriptors)
    {
        foreach (var descriptor in descriptors)
        {
            files.TryAdd(descriptor.Name, descriptor);
        }
    }

    private static List<string> MissingDependencies(Dictionary<string, FileDescriptorProto> files) =>
        files.Values.SelectMany(f => f.Dependencies).Where(d => !files.ContainsKey(d)).Distinct().ToList();

    private static FileDescriptorProto? BuiltIn(string name)
    {
        if (!name.StartsWith("google/protobuf/", StringComparison.Ordinal))
        {
            return null;
        }

        var set = new FileDescriptorSet();
        if (!set.Add(name, includeInOutput: true))
        {
            return null;
        }

        set.Process();
        return set.Files.FirstOrDefault(f => f.Name == name);
    }

    /// <summary>ServerReflectionRequest: alan 3 file_by_filename, 4 file_containing_symbol, 7 list_services.</summary>
    private static byte[] Request(int field, string value)
    {
        var writer = new ArrayBufferWriter<byte>();
        ProtoJson.WriteTag(writer, field, 2);
        ProtoJson.WriteLength(writer, Encoding.UTF8.GetBytes(value));
        return writer.WrittenSpan.ToArray();
    }

    /// <summary>ServerReflectionResponse: 4 file_descriptor_response, 6 list_services_response, 7 error_response.</summary>
    private static void Parse(ReadOnlyMemory<byte> data, out List<string> services, out List<FileDescriptorProto> files, out string? error)
    {
        services = [];
        files = [];
        error = null;
        var reader = new ProtoJson.Reader(data.Span);
        while (!reader.End)
        {
            var (number, wire) = reader.Tag();
            if (wire != 2)
            {
                reader.Skip(wire);
                continue;
            }

            var body = reader.LengthDelimited();
            switch (number)
            {
                case 4:
                    var fdr = new ProtoJson.Reader(body);
                    while (!fdr.End)
                    {
                        var (n, w) = fdr.Tag();
                        if (n == 1 && w == 2)
                        {
                            using var stream = new MemoryStream(fdr.LengthDelimited().ToArray());
                            files.Add(ProtoBuf.Serializer.Deserialize<FileDescriptorProto>(stream));
                        }
                        else
                        {
                            fdr.Skip(w);
                        }
                    }

                    break;
                case 6:
                    var list = new ProtoJson.Reader(body);
                    while (!list.End)
                    {
                        var (n, w) = list.Tag();
                        if (n == 1 && w == 2)
                        {
                            var item = new ProtoJson.Reader(list.LengthDelimited());
                            while (!item.End)
                            {
                                var (n2, w2) = item.Tag();
                                if (n2 == 1 && w2 == 2)
                                {
                                    services.Add(Encoding.UTF8.GetString(item.LengthDelimited()));
                                }
                                else
                                {
                                    item.Skip(w2);
                                }
                            }
                        }
                        else
                        {
                            list.Skip(w);
                        }
                    }

                    break;
                case 7:
                    var err = new ProtoJson.Reader(body);
                    var code = 0;
                    var message = string.Empty;
                    while (!err.End)
                    {
                        var (n, w) = err.Tag();
                        if (n == 1 && w == 0)
                        {
                            code = (int)err.Varint();
                        }
                        else if (n == 2 && w == 2)
                        {
                            message = Encoding.UTF8.GetString(err.LengthDelimited());
                        }
                        else
                        {
                            err.Skip(w);
                        }
                    }

                    error = $"{GrpcStatus.Name(code)}{(message.Length > 0 ? $" — {message}" : string.Empty)}";
                    break;
            }
        }
    }

    private static Exception Failure(GrpcCallStatus status) => status.Code == GrpcStatus.Unimplemented
        ? new ReflectionUnavailableException(status.Message.Length > 0 ? $"UNIMPLEMENTED: {status.Message}" : "UNIMPLEMENTED")
        : new ProtoException(L.T("grpc.reflection_failed", "Reflection çağrısı başarısız: {status}{detail}", ("status", status.Name), ("detail", status.Message.Length > 0 ? $" — {status.Message}" : string.Empty)));

    private sealed class ReflectionUnavailableException(string message) : Exception(message);
}
