using System.Buffers;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Apivator.Application.Common.Localization;

namespace Apivator.Infrastructure.Grpc;

/// <summary>google.protobuf'ın iyi bilinen tiplerinin proto3 JSON karşılıkları.</summary>
internal static class WellKnown
{
    private const string Prefix = ".google.protobuf.";
    private const long MaxSeconds = 315_576_000_000;

    private static readonly HashSet<string> Wrappers = new(StringComparer.Ordinal)
    {
        "DoubleValue", "FloatValue", "Int64Value", "UInt64Value", "Int32Value", "UInt32Value", "BoolValue", "StringValue", "BytesValue",
    };

    private static string? Name(string type)
    {
        var dotted = type.StartsWith('.') ? type : "." + type;
        return dotted.StartsWith(Prefix, StringComparison.Ordinal) ? dotted[Prefix.Length..] : null;
    }

    public static bool IsWellKnown(string type) => Name(type) is
        "Timestamp" or "Duration" or "Struct" or "Value" or "ListValue" or "Empty" or "FieldMask" or "Any"
        || (Name(type) is { } n && Wrappers.Contains(n));

    // ------------------------------------------------------------------ JSON → ikili

    public static bool Encode(ProtoJson codec, ArrayBufferWriter<byte> writer, string type, JsonElement json, int depth, string path)
    {
        var name = Name(type);
        switch (name)
        {
            case "Timestamp":
                if (json.ValueKind == JsonValueKind.Null)
                {
                    return true;
                }

                var (seconds, nanos) = ParseTimestamp(json, path);
                WriteSecondsNanos(writer, seconds, nanos);
                return true;
            case "Duration":
                if (json.ValueKind == JsonValueKind.Null)
                {
                    return true;
                }

                var (ds, dn) = ParseDuration(json, path);
                WriteSecondsNanos(writer, ds, dn);
                return true;
            case "Empty":
                return true;
            case "FieldMask":
                if (json.ValueKind != JsonValueKind.String)
                {
                    throw new ProtoException(Where(path) + L.T("grpc.fieldmask", "FieldMask virgülle ayrılmış metin olmalı (\"ad,fiyat.para\")."));
                }

                foreach (var p in json.GetString()!.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                {
                    ProtoJson.WriteTag(writer, 1, 2);
                    ProtoJson.WriteLength(writer, Encoding.UTF8.GetBytes(SnakeCase(p)));
                }

                return true;
            case "Struct":
                EncodeStruct(writer, json, depth, path);
                return true;
            case "Value":
                EncodeValue(writer, json, depth, path);
                return true;
            case "ListValue":
                EncodeList(writer, json, depth, path);
                return true;
            case "Any":
                EncodeAny(codec, writer, json, depth, path);
                return true;
            case { } w when Wrappers.Contains(w):
                if (json.ValueKind == JsonValueKind.Null)
                {
                    return true;
                }

                EncodeWrapper(writer, w, json, path);
                return true;
            default:
                return false;
        }
    }

    private static void WriteSecondsNanos(ArrayBufferWriter<byte> writer, long seconds, int nanos)
    {
        if (seconds != 0)
        {
            ProtoJson.WriteTag(writer, 1, 0);
            ProtoJson.WriteVarint(writer, (ulong)seconds);
        }

        if (nanos != 0)
        {
            ProtoJson.WriteTag(writer, 2, 0);
            ProtoJson.WriteVarint(writer, (ulong)(long)nanos);
        }
    }

    private static (long Seconds, int Nanos) ParseTimestamp(JsonElement json, string path)
    {
        if (json.ValueKind != JsonValueKind.String
            || !DateTimeOffset.TryParse(json.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var value))
        {
            throw new ProtoException(Where(path) + L.T("grpc.timestamp", "Timestamp RFC 3339 metni olmalı (\"2026-01-31T10:00:00Z\")."));
        }

        var ticks = value.UtcTicks - DateTimeOffset.UnixEpoch.UtcTicks;
        var seconds = Math.DivRem(ticks, TimeSpan.TicksPerSecond, out var rest);
        if (rest < 0)
        {
            seconds--;
            rest += TimeSpan.TicksPerSecond;
        }

        return (seconds, (int)(rest * 100));
    }

    private static (long Seconds, int Nanos) ParseDuration(JsonElement json, string path)
    {
        var text = json.ValueKind == JsonValueKind.String ? json.GetString()! : string.Empty;
        if (!text.EndsWith('s')
            || !decimal.TryParse(text[..^1], NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var total)
            || Math.Abs(total) > MaxSeconds)
        {
            throw new ProtoException(Where(path) + L.T("grpc.duration", "Duration saniye cinsinden \"s\" ile bitmeli (\"1.5s\")."));
        }

        var seconds = (long)decimal.Truncate(total);
        var nanos = (int)decimal.Round((total - seconds) * 1_000_000_000m);
        return (seconds, nanos);
    }

    private static void EncodeWrapper(ArrayBufferWriter<byte> writer, string wrapper, JsonElement json, string path)
    {
        switch (wrapper)
        {
            case "DoubleValue":
                ProtoJson.WriteTag(writer, 1, 1);
                ProtoJson.WriteFixed64(writer, BitConverter.DoubleToUInt64Bits(ProtoJson.Double(json, path)));
                break;
            case "FloatValue":
                ProtoJson.WriteTag(writer, 1, 5);
                ProtoJson.WriteFixed32(writer, BitConverter.SingleToUInt32Bits((float)ProtoJson.Double(json, path)));
                break;
            case "Int64Value":
                ProtoJson.WriteTag(writer, 1, 0);
                ProtoJson.WriteVarint(writer, (ulong)ProtoJson.Int64(json, path));
                break;
            case "UInt64Value":
                ProtoJson.WriteTag(writer, 1, 0);
                ProtoJson.WriteVarint(writer, ProtoJson.UInt64(json, path));
                break;
            case "Int32Value":
                ProtoJson.WriteTag(writer, 1, 0);
                ProtoJson.WriteVarint(writer, (ulong)(long)ProtoJson.Int32(json, path));
                break;
            case "UInt32Value":
                ProtoJson.WriteTag(writer, 1, 0);
                ProtoJson.WriteVarint(writer, ProtoJson.UInt32(json, path));
                break;
            case "BoolValue":
                ProtoJson.WriteTag(writer, 1, 0);
                ProtoJson.WriteVarint(writer, json.ValueKind switch
                {
                    JsonValueKind.True => 1UL,
                    JsonValueKind.False => 0UL,
                    _ => throw new ProtoException(Where(path) + L.T("grpc.expected_bool", "true/false bekleniyordu.")),
                });
                break;
            case "StringValue":
                ProtoJson.WriteTag(writer, 1, 2);
                ProtoJson.WriteLength(writer, Encoding.UTF8.GetBytes(json.ValueKind == JsonValueKind.String
                    ? json.GetString()!
                    : throw new ProtoException(Where(path) + L.T("grpc.expected_string", "metin bekleniyordu."))));
                break;
            default:
                ProtoJson.WriteTag(writer, 1, 2);
                ProtoJson.WriteLength(writer, ProtoJson.Bytes(json, path));
                break;
        }
    }

    private static void EncodeStruct(ArrayBufferWriter<byte> writer, JsonElement json, int depth, string path)
    {
        if (json.ValueKind == JsonValueKind.Null)
        {
            return;
        }

        if (json.ValueKind != JsonValueKind.Object)
        {
            throw new ProtoException(Where(path) + L.T("grpc.struct", "Struct için JSON nesnesi bekleniyordu."));
        }

        foreach (var property in json.EnumerateObject())
        {
            var entry = new ArrayBufferWriter<byte>();
            ProtoJson.WriteTag(entry, 1, 2);
            ProtoJson.WriteLength(entry, Encoding.UTF8.GetBytes(property.Name));
            var value = new ArrayBufferWriter<byte>();
            EncodeValue(value, property.Value, depth + 1, path);
            ProtoJson.WriteTag(entry, 2, 2);
            ProtoJson.WriteLength(entry, value.WrittenSpan);
            ProtoJson.WriteTag(writer, 1, 2);
            ProtoJson.WriteLength(writer, entry.WrittenSpan);
        }
    }

    private static void EncodeList(ArrayBufferWriter<byte> writer, JsonElement json, int depth, string path)
    {
        if (json.ValueKind != JsonValueKind.Array)
        {
            throw new ProtoException(Where(path) + L.T("grpc.listvalue", "ListValue için dizi bekleniyordu."));
        }

        foreach (var item in json.EnumerateArray())
        {
            var value = new ArrayBufferWriter<byte>();
            EncodeValue(value, item, depth + 1, path);
            ProtoJson.WriteTag(writer, 1, 2);
            ProtoJson.WriteLength(writer, value.WrittenSpan);
        }
    }

    private static void EncodeValue(ArrayBufferWriter<byte> writer, JsonElement json, int depth, string path)
    {
        if (depth > 64)
        {
            throw new ProtoException(L.T("grpc.too_deep", "Mesaj çok derin iç içe."));
        }

        switch (json.ValueKind)
        {
            case JsonValueKind.Null:
                ProtoJson.WriteTag(writer, 1, 0);
                ProtoJson.WriteVarint(writer, 0);
                break;
            case JsonValueKind.Number:
                ProtoJson.WriteTag(writer, 2, 1);
                ProtoJson.WriteFixed64(writer, BitConverter.DoubleToUInt64Bits(json.GetDouble()));
                break;
            case JsonValueKind.String:
                ProtoJson.WriteTag(writer, 3, 2);
                ProtoJson.WriteLength(writer, Encoding.UTF8.GetBytes(json.GetString()!));
                break;
            case JsonValueKind.True or JsonValueKind.False:
                ProtoJson.WriteTag(writer, 4, 0);
                ProtoJson.WriteVarint(writer, json.ValueKind == JsonValueKind.True ? 1UL : 0UL);
                break;
            case JsonValueKind.Object:
                var inner = new ArrayBufferWriter<byte>();
                EncodeStruct(inner, json, depth + 1, path);
                ProtoJson.WriteTag(writer, 5, 2);
                ProtoJson.WriteLength(writer, inner.WrittenSpan);
                break;
            default:
                var list = new ArrayBufferWriter<byte>();
                EncodeList(list, json, depth + 1, path);
                ProtoJson.WriteTag(writer, 6, 2);
                ProtoJson.WriteLength(writer, list.WrittenSpan);
                break;
        }
    }

    private static void EncodeAny(ProtoJson codec, ArrayBufferWriter<byte> writer, JsonElement json, int depth, string path)
    {
        if (json.ValueKind == JsonValueKind.Null)
        {
            return;
        }

        if (json.ValueKind != JsonValueKind.Object || !json.TryGetProperty("@type", out var typeUrl) || typeUrl.ValueKind != JsonValueKind.String)
        {
            throw new ProtoException(Where(path) + L.T("grpc.any", "Any için \"@type\" alanı olan nesne bekleniyordu."));
        }

        var url = typeUrl.GetString()!;
        var inner = "." + url[(url.LastIndexOf('/') + 1)..];
        var body = new ArrayBufferWriter<byte>();
        if (IsWellKnown(inner))
        {
            if (json.TryGetProperty("value", out var value))
            {
                codec.EncodeNested(body, inner, value, depth + 1, path);
            }
        }
        else
        {
            var rest = JsonNode.Parse(json.GetRawText())!.AsObject();
            rest.Remove("@type");
            using var document = JsonDocument.Parse(rest.ToJsonString());
            codec.EncodeNested(body, inner, document.RootElement, depth + 1, path);
        }

        ProtoJson.WriteTag(writer, 1, 2);
        ProtoJson.WriteLength(writer, Encoding.UTF8.GetBytes(url));
        ProtoJson.WriteTag(writer, 2, 2);
        ProtoJson.WriteLength(writer, body.WrittenSpan);
    }

    // ------------------------------------------------------------------ ikili → JSON

    public static (bool Handled, JsonNode? Value) Decode(ProtoJson codec, string type, ReadOnlySpan<byte> data, int depth)
    {
        var name = Name(type);
        switch (name)
        {
            case "Timestamp":
                var (seconds, nanos) = ReadSecondsNanos(data);
                return (true, JsonValue.Create(FormatTimestamp(seconds, nanos)));
            case "Duration":
                var (ds, dn) = ReadSecondsNanos(data);
                return (true, JsonValue.Create(FormatDuration(ds, dn)));
            case "Empty":
                return (true, new JsonObject());
            case "FieldMask":
                var paths = new List<string>();
                var reader = new ProtoJson.Reader(data);
                while (!reader.End)
                {
                    var (number, wire) = reader.Tag();
                    if (number == 1 && wire == 2)
                    {
                        paths.Add(CamelCase(Encoding.UTF8.GetString(reader.LengthDelimited())));
                    }
                    else
                    {
                        reader.Skip(wire);
                    }
                }

                return (true, JsonValue.Create(string.Join(',', paths)));
            case "Struct":
                return (true, DecodeStruct(data, depth));
            case "Value":
                return (true, DecodeValue(data, depth));
            case "ListValue":
                return (true, DecodeList(data, depth));
            case "Any":
                return (true, DecodeAny(codec, data, depth));
            case { } w when Wrappers.Contains(w):
                return (true, DecodeWrapper(w, data));
            default:
                return (false, null);
        }
    }

    private static (long Seconds, int Nanos) ReadSecondsNanos(ReadOnlySpan<byte> data)
    {
        long seconds = 0;
        var nanos = 0;
        var reader = new ProtoJson.Reader(data);
        while (!reader.End)
        {
            var (number, wire) = reader.Tag();
            if (number == 1 && wire == 0)
            {
                seconds = (long)reader.Varint();
            }
            else if (number == 2 && wire == 0)
            {
                nanos = (int)reader.Varint();
            }
            else
            {
                reader.Skip(wire);
            }
        }

        return (seconds, nanos);
    }

    internal static string FormatTimestamp(long seconds, int nanos)
    {
        var value = DateTimeOffset.FromUnixTimeSeconds(Math.Clamp(seconds, -62135596800, 253402300799));
        return value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture) + Fraction(nanos) + "Z";
    }

    internal static string FormatDuration(long seconds, int nanos)
    {
        var negative = seconds < 0 || nanos < 0;
        return (negative ? "-" : string.Empty) + Math.Abs(seconds).ToString(CultureInfo.InvariantCulture) + Fraction(Math.Abs(nanos)) + "s";
    }

    /// <summary>Kesir 0, 3, 6 ya da 9 basamakla yazılır (proto3 JSON kuralı).</summary>
    private static string Fraction(int nanos)
    {
        if (nanos == 0)
        {
            return string.Empty;
        }

        return nanos % 1_000_000 == 0 ? "." + (nanos / 1_000_000).ToString("000", CultureInfo.InvariantCulture)
            : nanos % 1000 == 0 ? "." + (nanos / 1000).ToString("000000", CultureInfo.InvariantCulture)
            : "." + nanos.ToString("000000000", CultureInfo.InvariantCulture);
    }

    private static JsonNode? DecodeWrapper(string wrapper, ReadOnlySpan<byte> data)
    {
        var reader = new ProtoJson.Reader(data);
        JsonNode? value = wrapper switch
        {
            "Int64Value" or "UInt64Value" => JsonValue.Create("0"),
            "BoolValue" => JsonValue.Create(false),
            "StringValue" or "BytesValue" => JsonValue.Create(string.Empty),
            _ => JsonValue.Create(0),
        };
        while (!reader.End)
        {
            var (number, wire) = reader.Tag();
            if (number != 1)
            {
                reader.Skip(wire);
                continue;
            }

            value = wrapper switch
            {
                "DoubleValue" => JsonValue.Create(BitConverter.UInt64BitsToDouble(reader.Fixed64())),
                "FloatValue" => JsonValue.Create(BitConverter.UInt32BitsToSingle(reader.Fixed32())),
                "Int64Value" => JsonValue.Create(((long)reader.Varint()).ToString(CultureInfo.InvariantCulture)),
                "UInt64Value" => JsonValue.Create(reader.Varint().ToString(CultureInfo.InvariantCulture)),
                "Int32Value" => JsonValue.Create((int)reader.Varint()),
                "UInt32Value" => JsonValue.Create((uint)reader.Varint()),
                "BoolValue" => JsonValue.Create(reader.Varint() != 0),
                "StringValue" => JsonValue.Create(Encoding.UTF8.GetString(reader.LengthDelimited())),
                _ => JsonValue.Create(Convert.ToBase64String(reader.LengthDelimited())),
            };
        }

        return value;
    }

    private static JsonObject DecodeStruct(ReadOnlySpan<byte> data, int depth)
    {
        var result = new JsonObject();
        var reader = new ProtoJson.Reader(data);
        while (!reader.End)
        {
            var (number, wire) = reader.Tag();
            if (number != 1 || wire != 2)
            {
                reader.Skip(wire);
                continue;
            }

            var entry = new ProtoJson.Reader(reader.LengthDelimited());
            var key = string.Empty;
            JsonNode? value = null;
            while (!entry.End)
            {
                var (n, w) = entry.Tag();
                if (n == 1 && w == 2)
                {
                    key = Encoding.UTF8.GetString(entry.LengthDelimited());
                }
                else if (n == 2 && w == 2)
                {
                    value = DecodeValue(entry.LengthDelimited(), depth + 1);
                }
                else
                {
                    entry.Skip(w);
                }
            }

            result[key] = value;
        }

        return result;
    }

    private static JsonArray DecodeList(ReadOnlySpan<byte> data, int depth)
    {
        var result = new JsonArray();
        var reader = new ProtoJson.Reader(data);
        while (!reader.End)
        {
            var (number, wire) = reader.Tag();
            if (number == 1 && wire == 2)
            {
                result.Add(DecodeValue(reader.LengthDelimited(), depth + 1));
            }
            else
            {
                reader.Skip(wire);
            }
        }

        return result;
    }

    private static JsonNode? DecodeValue(ReadOnlySpan<byte> data, int depth)
    {
        if (depth > 64)
        {
            throw new ProtoException(L.T("grpc.response_too_deep", "Yanıt mesajı çok derin iç içe."));
        }

        JsonNode? result = null;
        var reader = new ProtoJson.Reader(data);
        while (!reader.End)
        {
            var (number, wire) = reader.Tag();
            switch (number)
            {
                case 1 when wire == 0:
                    reader.Varint();
                    result = null;
                    break;
                case 2 when wire == 1:
                    result = JsonValue.Create(BitConverter.UInt64BitsToDouble(reader.Fixed64()));
                    break;
                case 3 when wire == 2:
                    result = JsonValue.Create(Encoding.UTF8.GetString(reader.LengthDelimited()));
                    break;
                case 4 when wire == 0:
                    result = JsonValue.Create(reader.Varint() != 0);
                    break;
                case 5 when wire == 2:
                    result = DecodeStruct(reader.LengthDelimited(), depth + 1);
                    break;
                case 6 when wire == 2:
                    result = DecodeList(reader.LengthDelimited(), depth + 1);
                    break;
                default:
                    reader.Skip(wire);
                    break;
            }
        }

        return result;
    }

    private static JsonObject DecodeAny(ProtoJson codec, ReadOnlySpan<byte> data, int depth)
    {
        var url = string.Empty;
        var body = ReadOnlySpan<byte>.Empty;
        var reader = new ProtoJson.Reader(data);
        while (!reader.End)
        {
            var (number, wire) = reader.Tag();
            if (number == 1 && wire == 2)
            {
                url = Encoding.UTF8.GetString(reader.LengthDelimited());
            }
            else if (number == 2 && wire == 2)
            {
                body = reader.LengthDelimited();
            }
            else
            {
                reader.Skip(wire);
            }
        }

        var result = new JsonObject { ["@type"] = url };
        var inner = "." + url[(url.LastIndexOf('/') + 1)..];
        JsonNode? decoded;
        try
        {
            decoded = url.Length == 0 ? null : codec.DecodeNested(inner, body, depth + 1);
        }
        catch (ProtoException)
        {
            // Tip tanımlarda yoksa ham bayt gösterilir.
            result["value"] = Convert.ToBase64String(body);
            return result;
        }

        if (decoded is JsonObject fields && !IsWellKnown(inner))
        {
            foreach (var (key, value) in fields.ToList())
            {
                fields.Remove(key);
                result[key] = value;
            }
        }
        else
        {
            result["value"] = decoded;
        }

        return result;
    }

    // ------------------------------------------------------------------ örnek

    public static JsonNode? Sample(string type) => Name(type) switch
    {
        "Timestamp" => JsonValue.Create(FormatTimestamp(DateTimeOffset.UtcNow.ToUnixTimeSeconds(), 0)),
        "Duration" => JsonValue.Create("1s"),
        "Empty" or "Struct" => new JsonObject(),
        "Value" => null,
        "ListValue" => new JsonArray(),
        "FieldMask" => JsonValue.Create(string.Empty),
        "Any" => new JsonObject { ["@type"] = "type.googleapis.com/paket.Mesaj" },
        "Int64Value" or "UInt64Value" => JsonValue.Create("0"),
        "BoolValue" => JsonValue.Create(false),
        "StringValue" or "BytesValue" => JsonValue.Create(string.Empty),
        { } w when Wrappers.Contains(w) => JsonValue.Create(0),
        _ => null,
    };

    private static string SnakeCase(string camel)
    {
        var builder = new StringBuilder(camel.Length + 4);
        foreach (var c in camel)
        {
            if (char.IsAsciiLetterUpper(c))
            {
                builder.Append('_').Append(char.ToLowerInvariant(c));
            }
            else
            {
                builder.Append(c);
            }
        }

        return builder.ToString();
    }

    private static string CamelCase(string snake)
    {
        var builder = new StringBuilder(snake.Length);
        var upper = false;
        foreach (var c in snake)
        {
            if (c == '_')
            {
                upper = true;
            }
            else
            {
                builder.Append(upper ? char.ToUpperInvariant(c) : c);
                upper = false;
            }
        }

        return builder.ToString();
    }

    private static string Where(string path) => path.Length == 0 ? string.Empty : $"{path}: ";
}
