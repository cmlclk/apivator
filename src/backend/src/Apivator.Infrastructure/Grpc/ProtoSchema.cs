using Apivator.Application.Common.Localization;
using Google.Protobuf.Reflection;

namespace Apivator.Infrastructure.Grpc;

/// <summary>
/// Protobuf tanımlarının çalışma zamanındaki havuzu: mesaj ve enum tipleri tam adlarıyla (".paket.Mesaj"), servis
/// metotları "/paket.Servis/Metot" yoluyla. Kaynak ya yüklenen .proto dosyalarıdır (protobuf-net.Reflection ile
/// ayrıştırılır; google/protobuf/*.proto içinde gelir) ya da sunucunun reflection servisinden alınan
/// FileDescriptorProto'lar.
/// </summary>
internal sealed class ProtoSchema
{
    public const int MaxProtoBytes = Domain.Collections.GrpcSettings.MaxProtoBytes;

    private readonly Dictionary<string, DescriptorProto> _messages = new(StringComparer.Ordinal);
    private readonly Dictionary<string, EnumDescriptorProto> _enums = new(StringComparer.Ordinal);
    private readonly Dictionary<string, (string Service, MethodDescriptorProto Method)> _methods = new(StringComparer.Ordinal);
    private readonly List<FileDescriptorProto> _files = [];

    private ProtoSchema()
    {
    }

    public IReadOnlyList<FileDescriptorProto> Files => _files;

    /// <summary>Servis adı (tam) → metotlar; reflection servisinin kendisi hariç.</summary>
    public IEnumerable<(string Service, IReadOnlyList<MethodDescriptorProto> Methods)> Services =>
        _files.SelectMany(f => f.Services.Select(s => (Name: Qualify(f.Package, s.Name), s.Methods)))
            .Where(s => !s.Name.StartsWith("grpc.reflection.", StringComparison.Ordinal))
            .GroupBy(s => s.Name)
            .Select(g => (g.Key, (IReadOnlyList<MethodDescriptorProto>)g.First().Methods));

    public static string Qualify(string? package, string name) => string.IsNullOrEmpty(package) ? name : $"{package}.{name}";

    /// <summary>.proto metinlerinden; hata varsa satır bilgisiyle anlaşılır mesajlar döner.</summary>
    public static (ProtoSchema? Schema, IReadOnlyList<string> Errors) FromProtoFiles(IEnumerable<(string Name, string Content)> files)
    {
        var set = new FileDescriptorSet();
        var sources = files.ToList();
        set.FileSystem = new InMemoryFileSystem(sources);
        foreach (var (name, content) in sources)
        {
            set.Add(Normalize(name), includeInOutput: true, new StringReader(content));
        }

        set.Process();
        var errors = set.GetErrors().Where(e => e.IsError).Select(e => $"{e.File}:{e.LineNumber}: {e.Message}").ToList();
        if (errors.Count > 0)
        {
            return (null, errors);
        }

        return (FromFileDescriptors(set.Files), []);
    }

    public static ProtoSchema FromFileDescriptors(IEnumerable<FileDescriptorProto> files)
    {
        var schema = new ProtoSchema();
        foreach (var file in files)
        {
            if (schema._files.Any(f => f.Name == file.Name))
            {
                continue;
            }

            schema._files.Add(file);
            var prefix = string.IsNullOrEmpty(file.Package) ? string.Empty : "." + file.Package;
            foreach (var message in file.MessageTypes)
            {
                schema.Register(prefix, message);
            }

            foreach (var e in file.EnumTypes)
            {
                schema._enums[$"{prefix}.{e.Name}"] = e;
            }

            foreach (var service in file.Services)
            {
                var serviceName = Qualify(file.Package, service.Name);
                foreach (var method in service.Methods)
                {
                    schema._methods[$"/{serviceName}/{method.Name}"] = (serviceName, method);
                }
            }
        }

        return schema;
    }

    /// <summary>Tanımlar istemciye taşınıp (çağrıda geri gelir) tekrar kurulabilsin diye: FileDescriptorSet baytları.</summary>
    public byte[] ToDescriptorSet()
    {
        var set = new FileDescriptorSet();
        set.Files.AddRange(_files);
        using var stream = new MemoryStream();
        ProtoBuf.Serializer.Serialize(stream, set);
        return stream.ToArray();
    }

    public static ProtoSchema FromDescriptorSet(byte[] bytes)
    {
        using var stream = new MemoryStream(bytes);
        var set = ProtoBuf.Serializer.Deserialize<FileDescriptorSet>(stream);
        return FromFileDescriptors(set.Files);
    }

    public DescriptorProto Message(string fullName) =>
        _messages.TryGetValue(Dot(fullName), out var message)
            ? message
            : throw new ProtoException(L.T("grpc.message_type_missing", "\"{type}\" mesaj tipi tanımlarda yok.", ("type", fullName.TrimStart('.'))));

    public EnumDescriptorProto? Enum(string fullName) => _enums.GetValueOrDefault(Dot(fullName));

    public (string Service, MethodDescriptorProto Method)? Method(string path) =>
        _methods.TryGetValue(path, out var method) ? method : null;

    private void Register(string prefix, DescriptorProto message)
    {
        var name = $"{prefix}.{message.Name}";
        _messages[name] = message;
        foreach (var nested in message.NestedTypes)
        {
            Register(name, nested);
        }

        foreach (var e in message.EnumTypes)
        {
            _enums[$"{name}.{e.Name}"] = e;
        }
    }

    private static string Dot(string name) => name.StartsWith('.') ? name : "." + name;

    private static string Normalize(string name) => name.Replace('\\', '/').TrimStart('/');

    /// <summary>Yüklenen dosyalar arasındaki import'lar için; google/protobuf/* kütüphanenin içinden gelir.</summary>
    private sealed class InMemoryFileSystem(List<(string Name, string Content)> files) : IFileSystem
    {
        private (string Name, string Content)? Find(string path)
        {
            var normalized = Normalize(path);
            foreach (var file in files)
            {
                var name = Normalize(file.Name);
                // Import yolu klasörlü olabilir ("magaza/v1/urun.proto"); yüklenen dosya yalnızca adıyla gelir.
                if (name == normalized || normalized.EndsWith("/" + name, StringComparison.Ordinal) || name.EndsWith("/" + normalized, StringComparison.Ordinal))
                {
                    return file;
                }
            }

            return null;
        }

        public bool Exists(string path) => Find(path) is not null;

        public TextReader OpenText(string path) => new StringReader(Find(path)?.Content ?? string.Empty);
    }
}

internal sealed class ProtoException(string message) : Exception(message);
