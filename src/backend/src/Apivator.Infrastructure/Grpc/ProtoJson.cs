using System.Buffers;
using System.Buffers.Binary;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Apivator.Application.Common.Localization;
using Google.Protobuf.Reflection;
using FieldLabel = Google.Protobuf.Reflection.FieldDescriptorProto.Label;
using FieldType = Google.Protobuf.Reflection.FieldDescriptorProto.Type;

namespace Apivator.Infrastructure.Grpc;

/// <summary>
/// Protobuf mesajlarını tanımlara göre JSON'a ve JSON'dan ikili biçime çevirir (proto3 JSON eşlemesi): alan adları
/// lowerCamel (asıl ad da kabul edilir), 64 bit sayılar metin, bytes base64, enum'lar adıyla, map'ler nesne;
/// Timestamp/Duration/wrapper/Struct/Value/ListValue/FieldMask/Empty/Any doğal JSON biçimleriyle. Okurken
/// varsayılan değerler de yazılır (grpcurl --emit-defaults gibi), mesajın tamamı görünsün diye.
/// </summary>
internal sealed class ProtoJson(ProtoSchema schema)
{
    private const int MaxDepth = 64;

    // ------------------------------------------------------------------ JSON → protobuf

    public byte[] Encode(string messageType, JsonElement json)
    {
        var writer = new ArrayBufferWriter<byte>();
        EncodeMessage(writer, messageType, json, 0, string.Empty);
        return writer.WrittenSpan.ToArray();
    }

    private void EncodeMessage(ArrayBufferWriter<byte> writer, string type, JsonElement json, int depth, string path)
    {
        if (depth > MaxDepth)
        {
            throw new ProtoException(L.T("grpc.too_deep", "Mesaj çok derin iç içe."));
        }

        if (WellKnown.Encode(this, writer, type, json, depth, path))
        {
            return;
        }

        if (json.ValueKind == JsonValueKind.Null)
        {
            return;
        }

        if (json.ValueKind != JsonValueKind.Object)
        {
            throw new ProtoException(Where(path) + L.T("grpc.expected_object_for", "{type} için JSON nesnesi bekleniyordu.", ("type", Short(type))));
        }

        var message = schema.Message(type);
        foreach (var property in json.EnumerateObject())
        {
            var field = message.Fields.FirstOrDefault(f => JsonName(f) == property.Name || f.Name == property.Name)
                ?? throw new ProtoException(Where(path) + L.T("grpc.field_missing", "\"{field}\" alanı {type} mesajında yok.", ("field", property.Name), ("type", Short(type))));
            var fieldPath = path.Length == 0 ? property.Name : $"{path}.{property.Name}";
            if (property.Value.ValueKind == JsonValueKind.Null && field.type != FieldType.TypeMessage)
            {
                continue;
            }

            if (IsMap(field))
            {
                EncodeMap(writer, field, property.Value, depth, fieldPath);
            }
            else if (field.label == FieldLabel.LabelRepeated)
            {
                if (property.Value.ValueKind != JsonValueKind.Array)
                {
                    throw new ProtoException(Where(fieldPath) + L.T("grpc.expected_array", "dizi bekleniyordu."));
                }

                foreach (var item in property.Value.EnumerateArray())
                {
                    EncodeField(writer, field, item, depth, fieldPath);
                }
            }
            else
            {
                EncodeField(writer, field, property.Value, depth, fieldPath);
            }
        }
    }

    private void EncodeMap(ArrayBufferWriter<byte> writer, FieldDescriptorProto field, JsonElement json, int depth, string path)
    {
        if (json.ValueKind != JsonValueKind.Object)
        {
            throw new ProtoException(Where(path) + L.T("grpc.expected_map", "nesne (map) bekleniyordu."));
        }

        var entry = schema.Message(field.TypeName);
        var keyField = entry.Fields.First(f => f.Number == 1);
        var valueField = entry.Fields.First(f => f.Number == 2);
        foreach (var item in json.EnumerateObject())
        {
            var inner = new ArrayBufferWriter<byte>();
            EncodeScalar(inner, keyField, MapKey(keyField, item.Name, path), path);
            EncodeField(inner, valueField, item.Value, depth + 1, $"{path}.{item.Name}");
            WriteTag(writer, field.Number, 2);
            WriteLength(writer, inner.WrittenSpan);
        }
    }

    private static JsonElement MapKey(FieldDescriptorProto keyField, string key, string path)
    {
        var text = keyField.type switch
        {
            FieldType.TypeString => JsonSerializer.Serialize(key),
            FieldType.TypeBool => key is "true" or "false" ? key : throw new ProtoException(Where(path) + L.T("grpc.map_key_bool", "map anahtarı true/false olmalı.")),
            _ => long.TryParse(key, NumberStyles.Integer, CultureInfo.InvariantCulture, out _) || ulong.TryParse(key, NumberStyles.Integer, CultureInfo.InvariantCulture, out _)
                ? JsonSerializer.Serialize(key)
                : throw new ProtoException(Where(path) + L.T("grpc.map_key_number", "map anahtarı sayı olmalı: \"{key}\".", ("key", key))),
        };
        return JsonDocument.Parse(text).RootElement.Clone();
    }

    private void EncodeField(ArrayBufferWriter<byte> writer, FieldDescriptorProto field, JsonElement value, int depth, string path)
    {
        if (field.type == FieldType.TypeMessage)
        {
            var inner = new ArrayBufferWriter<byte>();
            EncodeMessage(inner, field.TypeName, value, depth + 1, path);
            WriteTag(writer, field.Number, 2);
            WriteLength(writer, inner.WrittenSpan);
            return;
        }

        if (field.type == FieldType.TypeGroup)
        {
            throw new ProtoException(Where(path) + L.T("grpc.group_unsupported", "proto2 group alanları desteklenmiyor."));
        }

        EncodeScalar(writer, field, value, path);
    }

    private void EncodeScalar(ArrayBufferWriter<byte> writer, FieldDescriptorProto field, JsonElement value, string path)
    {
        switch (field.type)
        {
            case FieldType.TypeDouble:
                WriteTag(writer, field.Number, 1);
                WriteFixed64(writer, BitConverter.DoubleToUInt64Bits(Double(value, path)));
                break;
            case FieldType.TypeFloat:
                WriteTag(writer, field.Number, 5);
                WriteFixed32(writer, BitConverter.SingleToUInt32Bits((float)Double(value, path)));
                break;
            case FieldType.TypeInt64:
                WriteTag(writer, field.Number, 0);
                WriteVarint(writer, (ulong)Int64(value, path));
                break;
            case FieldType.TypeUint64:
                WriteTag(writer, field.Number, 0);
                WriteVarint(writer, UInt64(value, path));
                break;
            case FieldType.TypeInt32:
                WriteTag(writer, field.Number, 0);
                WriteVarint(writer, (ulong)(long)Int32(value, path));
                break;
            case FieldType.TypeFixed64:
                WriteTag(writer, field.Number, 1);
                WriteFixed64(writer, UInt64(value, path));
                break;
            case FieldType.TypeFixed32:
                WriteTag(writer, field.Number, 5);
                WriteFixed32(writer, UInt32(value, path));
                break;
            case FieldType.TypeBool:
                WriteTag(writer, field.Number, 0);
                WriteVarint(writer, value.ValueKind switch
                {
                    JsonValueKind.True => 1UL,
                    JsonValueKind.False => 0UL,
                    _ => throw new ProtoException(Where(path) + L.T("grpc.expected_bool", "true/false bekleniyordu.")),
                });
                break;
            case FieldType.TypeString:
                WriteTag(writer, field.Number, 2);
                WriteLength(writer, Encoding.UTF8.GetBytes(value.ValueKind == JsonValueKind.String
                    ? value.GetString()!
                    : throw new ProtoException(Where(path) + L.T("grpc.expected_string", "metin bekleniyordu."))));
                break;
            case FieldType.TypeBytes:
                WriteTag(writer, field.Number, 2);
                WriteLength(writer, Bytes(value, path));
                break;
            case FieldType.TypeUint32:
                WriteTag(writer, field.Number, 0);
                WriteVarint(writer, UInt32(value, path));
                break;
            case FieldType.TypeEnum:
                WriteTag(writer, field.Number, 0);
                WriteVarint(writer, (ulong)(long)EnumNumber(field.TypeName, value, path));
                break;
            case FieldType.TypeSfixed32:
                WriteTag(writer, field.Number, 5);
                WriteFixed32(writer, (uint)Int32(value, path));
                break;
            case FieldType.TypeSfixed64:
                WriteTag(writer, field.Number, 1);
                WriteFixed64(writer, (ulong)Int64(value, path));
                break;
            case FieldType.TypeSint32:
                var s32 = Int32(value, path);
                WriteTag(writer, field.Number, 0);
                WriteVarint(writer, (uint)((s32 << 1) ^ (s32 >> 31)));
                break;
            case FieldType.TypeSint64:
                var s64 = Int64(value, path);
                WriteTag(writer, field.Number, 0);
                WriteVarint(writer, (ulong)((s64 << 1) ^ (s64 >> 63)));
                break;
            default:
                throw new ProtoException(Where(path) + L.T("grpc.unsupported_field_type", "desteklenmeyen alan tipi {type}.", ("type", field.type)));
        }
    }

    private int EnumNumber(string enumType, JsonElement value, string path)
    {
        if (value.ValueKind == JsonValueKind.Number)
        {
            return value.GetInt32();
        }

        var definition = schema.Enum(enumType);
        var name = value.ValueKind == JsonValueKind.String ? value.GetString() : null;
        var match = definition?.Values.FirstOrDefault(v => v.Name == name);
        return match?.Number ?? throw new ProtoException(
            Where(path) + L.T("grpc.not_enum_value", "\"{name}\" {type} değerlerinden biri değil{values}", ("name", name), ("type", Short(enumType)), ("values", definition is null ? "." : $" ({string.Join(", ", definition.Values.Select(v => v.Name))}).")));
    }

    // ------------------------------------------------------------------ protobuf → JSON

    public JsonObject Decode(string messageType, ReadOnlySpan<byte> data) =>
        DecodeMessage(messageType, data, 0) as JsonObject ?? [];

    private JsonNode? DecodeMessage(string type, ReadOnlySpan<byte> data, int depth)
    {
        if (depth > MaxDepth)
        {
            throw new ProtoException(L.T("grpc.response_too_deep", "Yanıt mesajı çok derin iç içe."));
        }

        var known = WellKnown.Decode(this, type, data, depth);
        if (known.Handled)
        {
            return known.Value;
        }

        var message = schema.Message(type);
        var result = new JsonObject();
        var reader = new Reader(data);
        while (!reader.End)
        {
            var (number, wire) = reader.Tag();
            var field = message.Fields.FirstOrDefault(f => f.Number == number);
            if (field is null)
            {
                reader.Skip(wire);
                continue;
            }

            var name = JsonName(field);
            if (IsMap(field))
            {
                var map = result[name] as JsonObject ?? [];
                result[name] = map;
                var entry = schema.Message(field.TypeName);
                var entryReader = new Reader(reader.LengthDelimited());
                string key = string.Empty;
                JsonNode? value = DefaultValue(entry.Fields.First(f => f.Number == 2));
                while (!entryReader.End)
                {
                    var (n, w) = entryReader.Tag();
                    var f = entry.Fields.FirstOrDefault(x => x.Number == n);
                    if (f is null)
                    {
                        entryReader.Skip(w);
                    }
                    else if (n == 1)
                    {
                        key = ReadValue(ref entryReader, f, w, depth)?.ToString() ?? string.Empty;
                    }
                    else
                    {
                        value = ReadValue(ref entryReader, f, w, depth);
                    }
                }

                map[key] = value;
            }
            else if (field.label == FieldLabel.LabelRepeated)
            {
                var list = result[name] as JsonArray ?? [];
                result[name] = list;
                if (wire == 2 && IsPackable(field))
                {
                    var packed = new Reader(reader.LengthDelimited());
                    while (!packed.End)
                    {
                        list.Add(ReadValue(ref packed, field, PackedWireType(field), depth));
                    }
                }
                else
                {
                    list.Add(ReadValue(ref reader, field, wire, depth));
                }
            }
            else
            {
                result[name] = ReadValue(ref reader, field, wire, depth);
            }
        }

        // Alanlar tanımdaki sırayla yazılır; gelmeyen skaler/enum/dizi/map alanları varsayılanıyla (oneof üyeleri,
        // proto3 optional ve mesaj alanları hariç: bunların "yok" olması anlamlıdır).
        var ordered = new JsonObject();
        foreach (var field in message.Fields)
        {
            var name = JsonName(field);
            if (result.Remove(name, out var value))
            {
                ordered[name] = value;
            }
            else if (field.ShouldSerializeOneofIndex() || field.Proto3Optional)
            {
                continue;
            }
            else if (IsMap(field))
            {
                ordered[name] = new JsonObject();
            }
            else if (field.label == FieldLabel.LabelRepeated)
            {
                ordered[name] = new JsonArray();
            }
            else if (field.type != FieldType.TypeMessage)
            {
                ordered[name] = DefaultValue(field);
            }
        }

        return ordered;
    }

    private JsonNode? ReadValue(ref Reader reader, FieldDescriptorProto field, int wire, int depth)
    {
        switch (field.type)
        {
            case FieldType.TypeDouble:
                return FloatNode(BitConverter.UInt64BitsToDouble(reader.Fixed64()));
            case FieldType.TypeFloat:
                return FloatNode(BitConverter.UInt32BitsToSingle(reader.Fixed32()));
            case FieldType.TypeInt64:
                return JsonValue.Create(((long)reader.Varint()).ToString(CultureInfo.InvariantCulture));
            case FieldType.TypeUint64:
                return JsonValue.Create(reader.Varint().ToString(CultureInfo.InvariantCulture));
            case FieldType.TypeInt32:
                return JsonValue.Create((int)reader.Varint());
            case FieldType.TypeFixed64:
                return JsonValue.Create(reader.Fixed64().ToString(CultureInfo.InvariantCulture));
            case FieldType.TypeFixed32:
                return JsonValue.Create(reader.Fixed32());
            case FieldType.TypeBool:
                return JsonValue.Create(reader.Varint() != 0);
            case FieldType.TypeString:
                return JsonValue.Create(Encoding.UTF8.GetString(reader.LengthDelimited()));
            case FieldType.TypeBytes:
                return JsonValue.Create(Convert.ToBase64String(reader.LengthDelimited()));
            case FieldType.TypeUint32:
                return JsonValue.Create((uint)reader.Varint());
            case FieldType.TypeEnum:
                var number = (int)reader.Varint();
                var name = schema.Enum(field.TypeName)?.Values.FirstOrDefault(v => v.Number == number)?.Name;
                return name is null ? JsonValue.Create(number) : JsonValue.Create(name);
            case FieldType.TypeSfixed32:
                return JsonValue.Create((int)reader.Fixed32());
            case FieldType.TypeSfixed64:
                return JsonValue.Create(((long)reader.Fixed64()).ToString(CultureInfo.InvariantCulture));
            case FieldType.TypeSint32:
                var z32 = (uint)reader.Varint();
                return JsonValue.Create((int)(z32 >> 1) ^ -(int)(z32 & 1));
            case FieldType.TypeSint64:
                var z64 = reader.Varint();
                return JsonValue.Create((((long)(z64 >> 1)) ^ -(long)(z64 & 1)).ToString(CultureInfo.InvariantCulture));
            case FieldType.TypeMessage:
                return DecodeMessage(field.TypeName, reader.LengthDelimited(), depth + 1);
            default:
                reader.Skip(wire);
                return null;
        }
    }

    private JsonValue? DefaultValue(FieldDescriptorProto field) => field.type switch
    {
        FieldType.TypeDouble or FieldType.TypeFloat => JsonValue.Create(0d),
        FieldType.TypeInt32 or FieldType.TypeUint32 or FieldType.TypeSint32
            or FieldType.TypeFixed32 or FieldType.TypeSfixed32 => JsonValue.Create(0),
        FieldType.TypeInt64 or FieldType.TypeUint64 or FieldType.TypeSint64 or FieldType.TypeFixed64 or FieldType.TypeSfixed64 => JsonValue.Create("0"),
        FieldType.TypeBool => JsonValue.Create(false),
        FieldType.TypeString or FieldType.TypeBytes => JsonValue.Create(string.Empty),
        FieldType.TypeEnum => schema.Enum(field.TypeName)?.Values.FirstOrDefault() is { } first ? JsonValue.Create(first.Name) : JsonValue.Create(0),
        _ => null,
    };

    // ------------------------------------------------------------------ örnek mesaj

    /// <summary>Arayüzdeki "örnek mesaj": her alan varsayılan değeriyle (oneof'tan ilk üye), 3 seviyeye kadar.</summary>
    public JsonNode? Sample(string messageType, int depth = 0)
    {
        if (WellKnown.Sample(messageType) is { } known)
        {
            return known;
        }

        if (depth > 3)
        {
            return new JsonObject();
        }

        var message = schema.Message(messageType);
        var result = new JsonObject();
        var usedOneofs = new HashSet<int>();
        foreach (var field in message.Fields)
        {
            if (field.ShouldSerializeOneofIndex() && !field.Proto3Optional && !usedOneofs.Add(field.OneofIndex))
            {
                continue;
            }

            var name = JsonName(field);
            if (IsMap(field))
            {
                result[name] = new JsonObject();
            }
            else
            {
                var single = field.type == FieldType.TypeMessage ? Sample(field.TypeName, depth + 1) : DefaultValue(field);
                result[name] = field.label == FieldLabel.LabelRepeated ? new JsonArray(single) : single;
            }
        }

        return result;
    }

    /// <summary>
    /// Mesajın JSON eşlemesinin JSON Schema'sı (model üretimi için). Mesajlar <c>$defs</c> altında kısa adlarıyla
    /// (çakışırsa tam adlarıyla) yer alır. 64 bitlik sayılar protobuf JSON eşlemesindeki gibi metindir; skaler alanlar
    /// zorunlu (varsayılan değer), mesaj, oneof ve <c>optional</c> alanlar opsiyonel sayılır.
    /// </summary>
    public JsonObject JsonSchema(string messageType)
    {
        var defs = new JsonObject();
        var names = new Dictionary<string, string>(StringComparer.Ordinal);
        var root = TypeSchema(FieldType.TypeMessage, messageType, defs, names);
        var result = new JsonObject
        {
            ["$schema"] = "https://json-schema.org/draft/2020-12/schema",
            ["title"] = ShortName(messageType),
        };
        foreach (var (key, value) in root)
        {
            result[key] = value?.DeepClone();
        }

        if (defs.Count > 0)
        {
            result["$defs"] = defs;
        }

        return result;
    }

    private static string ShortName(string type) => type.TrimStart('.').Split('.')[^1];

    private static string DefinitionName(string fullName, Dictionary<string, string> names)
    {
        if (names.TryGetValue(fullName, out var existing))
        {
            return existing;
        }

        var name = ShortName(fullName);
        if (names.ContainsValue(name))
        {
            name = fullName.TrimStart('.');
        }

        names[fullName] = name;
        return name;
    }

    private JsonObject TypeSchema(FieldType type, string? typeName, JsonObject defs, Dictionary<string, string> names)
    {
        switch (type)
        {
            case FieldType.TypeDouble or FieldType.TypeFloat:
                return new JsonObject { ["type"] = "number" };
            case FieldType.TypeInt32 or FieldType.TypeSint32 or FieldType.TypeSfixed32 or FieldType.TypeUint32 or FieldType.TypeFixed32:
                return new JsonObject { ["type"] = "integer", ["format"] = "int32" };
            case FieldType.TypeInt64 or FieldType.TypeSint64 or FieldType.TypeSfixed64 or FieldType.TypeUint64 or FieldType.TypeFixed64:
                return new JsonObject { ["type"] = "string", ["format"] = "int64", ["description"] = L.T("grpc.int64_description", "64 bitlik tam sayı (protobuf JSON eşlemesinde metin)") };
            case FieldType.TypeBool:
                return new JsonObject { ["type"] = "boolean" };
            case FieldType.TypeString:
                return new JsonObject { ["type"] = "string" };
            case FieldType.TypeBytes:
                return new JsonObject { ["type"] = "string", ["format"] = "byte" };
            case FieldType.TypeEnum:
                {
                    var name = DefinitionName(typeName!, names);
                    if (!defs.ContainsKey(name) && schema.Enum(typeName!) is { } enumType)
                    {
                        defs[name] = new JsonObject
                        {
                            ["type"] = "string",
                            ["enum"] = new JsonArray(enumType.Values.Select(v => (JsonNode?)JsonValue.Create(v.Name)).ToArray()),
                        };
                    }

                    return new JsonObject { ["$ref"] = $"#/$defs/{name}" };
                }

            default:
                if (WellKnownSchema(typeName!) is { } known)
                {
                    return known;
                }

                return MessageRef(typeName!, defs, names);
        }
    }

    private JsonObject MessageRef(string typeName, JsonObject defs, Dictionary<string, string> names)
    {
        var name = DefinitionName(typeName, names);
        if (defs.ContainsKey(name))
        {
            return new JsonObject { ["$ref"] = $"#/$defs/{name}" };
        }

        // Kendine başvuran mesajlar için önce yer tutucu.
        var definition = new JsonObject { ["type"] = "object" };
        defs[name] = definition;
        var message = schema.Message(typeName);
        var properties = new JsonObject();
        var required = new JsonArray();
        foreach (var field in message.Fields)
        {
            var jsonName = JsonName(field);
            JsonObject property;
            if (IsMap(field))
            {
                var entry = schema.Message(field.TypeName);
                var value = entry.Fields.First(f => f.Number == 2);
                property = new JsonObject { ["type"] = "object", ["additionalProperties"] = TypeSchema(value.type, value.TypeName, defs, names) };
            }
            else
            {
                var item = TypeSchema(field.type, field.TypeName, defs, names);
                property = field.label == FieldLabel.LabelRepeated ? new JsonObject { ["type"] = "array", ["items"] = item } : item;
            }

            properties[jsonName] = property;
            var optional = field.Proto3Optional || field.ShouldSerializeOneofIndex()
                || (field.type == FieldType.TypeMessage && field.label != FieldLabel.LabelRepeated);
            if (!optional)
            {
                required.Add(jsonName);
            }
        }

        definition["properties"] = properties;
        if (required.Count > 0)
        {
            definition["required"] = required;
        }

        return new JsonObject { ["$ref"] = $"#/$defs/{name}" };
    }

    private static JsonObject? WellKnownSchema(string typeName) => typeName.TrimStart('.') switch
    {
        "google.protobuf.Timestamp" => new JsonObject { ["type"] = "string", ["format"] = "date-time" },
        "google.protobuf.Duration" or "google.protobuf.FieldMask" => new JsonObject { ["type"] = "string" },
        "google.protobuf.Struct" or "google.protobuf.Any" => new JsonObject { ["type"] = "object" },
        "google.protobuf.Empty" => new JsonObject { ["type"] = "object", ["additionalProperties"] = false },
        "google.protobuf.Value" => new JsonObject(),
        "google.protobuf.ListValue" => new JsonObject { ["type"] = "array", ["items"] = new JsonObject() },
        "google.protobuf.DoubleValue" or "google.protobuf.FloatValue" => new JsonObject { ["type"] = new JsonArray("number", "null") },
        "google.protobuf.Int32Value" or "google.protobuf.UInt32Value" => new JsonObject { ["type"] = new JsonArray("integer", "null") },
        "google.protobuf.Int64Value" or "google.protobuf.UInt64Value" or "google.protobuf.StringValue" or "google.protobuf.BytesValue" =>
            new JsonObject { ["type"] = new JsonArray("string", "null") },
        "google.protobuf.BoolValue" => new JsonObject { ["type"] = new JsonArray("boolean", "null") },
        _ => null,
    };

    // ------------------------------------------------------------------ yardımcılar

    public ProtoSchema Schema => schema;

    internal void EncodeNested(ArrayBufferWriter<byte> writer, string type, JsonElement json, int depth, string path) =>
        EncodeMessage(writer, type, json, depth, path);

    internal JsonNode? DecodeNested(string type, ReadOnlySpan<byte> data, int depth) => DecodeMessage(type, data, depth);

    private bool IsMap(FieldDescriptorProto field) =>
        field.label == FieldLabel.LabelRepeated && field.type == FieldType.TypeMessage
        && schema.Message(field.TypeName).Options?.MapEntry == true;

    /// <summary>protoc json_name'i doldurur; .proto'dan ayrıştırılan tanımlarda boş olabilir (lowerCamel türetilir).</summary>
    internal static string JsonName(FieldDescriptorProto field)
    {
        if (!string.IsNullOrEmpty(field.JsonName))
        {
            return field.JsonName;
        }

        var builder = new StringBuilder(field.Name.Length);
        var upper = false;
        foreach (var c in field.Name)
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

    private static bool IsPackable(FieldDescriptorProto field) =>
        field.type is not (FieldType.TypeString or FieldType.TypeBytes or FieldType.TypeMessage or FieldType.TypeGroup);

    private static int PackedWireType(FieldDescriptorProto field) => field.type switch
    {
        FieldType.TypeDouble or FieldType.TypeFixed64 or FieldType.TypeSfixed64 => 1,
        FieldType.TypeFloat or FieldType.TypeFixed32 or FieldType.TypeSfixed32 => 5,
        _ => 0,
    };

    private static JsonValue FloatNode(double value) =>
        double.IsNaN(value) ? JsonValue.Create("NaN")
        : double.IsPositiveInfinity(value) ? JsonValue.Create("Infinity")
        : double.IsNegativeInfinity(value) ? JsonValue.Create("-Infinity")
        : JsonValue.Create(value);

    private static string Short(string type) => type.TrimStart('.');

    private static string Where(string path) => path.Length == 0 ? string.Empty : $"{path}: ";

    internal static double Double(JsonElement value, string path) => value.ValueKind switch
    {
        JsonValueKind.Number => value.GetDouble(),
        JsonValueKind.String => value.GetString() switch
        {
            "NaN" => double.NaN,
            "Infinity" => double.PositiveInfinity,
            "-Infinity" => double.NegativeInfinity,
            var s when double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) => d,
            _ => throw new ProtoException(Where(path) + L.T("grpc.expected_number", "sayı bekleniyordu.")),
        },
        _ => throw new ProtoException(Where(path) + L.T("grpc.expected_number", "sayı bekleniyordu.")),
    };

    internal static long Int64(JsonElement value, string path) =>
        value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var n) ? n
        : value.ValueKind == JsonValueKind.String && long.TryParse(value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) ? s
        : throw new ProtoException(Where(path) + L.T("grpc.expected_integer", "tam sayı bekleniyordu."));

    internal static ulong UInt64(JsonElement value, string path) =>
        value.ValueKind == JsonValueKind.Number && value.TryGetUInt64(out var n) ? n
        : value.ValueKind == JsonValueKind.String && ulong.TryParse(value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) ? s
        : throw new ProtoException(Where(path) + L.T("grpc.expected_unsigned", "negatif olmayan tam sayı bekleniyordu."));

    internal static int Int32(JsonElement value, string path) =>
        Int64(value, path) is var n && n is >= int.MinValue and <= int.MaxValue ? (int)n
        : throw new ProtoException(Where(path) + L.T("grpc.out_of_int32", "32 bit tam sayı aralığının dışında."));

    internal static uint UInt32(JsonElement value, string path) =>
        UInt64(value, path) is var n && n <= uint.MaxValue ? (uint)n
        : throw new ProtoException(Where(path) + L.T("grpc.out_of_uint32", "32 bit işaretsiz tam sayı aralığının dışında."));

    internal static byte[] Bytes(JsonElement value, string path)
    {
        if (value.ValueKind != JsonValueKind.String)
        {
            throw new ProtoException(Where(path) + L.T("grpc.expected_base64", "base64 metin bekleniyordu."));
        }

        var text = value.GetString()!.Replace('-', '+').Replace('_', '/');
        text = text.PadRight(text.Length + ((4 - (text.Length % 4)) % 4), '=');
        try
        {
            return Convert.FromBase64String(text);
        }
        catch (FormatException)
        {
            throw new ProtoException(Where(path) + L.T("grpc.invalid_base64", "geçerli base64 değil."));
        }
    }

    internal static void WriteTag(ArrayBufferWriter<byte> writer, int field, int wire) => WriteVarint(writer, ((ulong)field << 3) | (uint)wire);

    internal static void WriteVarint(ArrayBufferWriter<byte> writer, ulong value)
    {
        var span = writer.GetSpan(10);
        var i = 0;
        while (value >= 0x80)
        {
            span[i++] = (byte)(value | 0x80);
            value >>= 7;
        }

        span[i++] = (byte)value;
        writer.Advance(i);
    }

    internal static void WriteFixed32(ArrayBufferWriter<byte> writer, uint value)
    {
        BinaryPrimitives.WriteUInt32LittleEndian(writer.GetSpan(4), value);
        writer.Advance(4);
    }

    internal static void WriteFixed64(ArrayBufferWriter<byte> writer, ulong value)
    {
        BinaryPrimitives.WriteUInt64LittleEndian(writer.GetSpan(8), value);
        writer.Advance(8);
    }

    internal static void WriteLength(ArrayBufferWriter<byte> writer, ReadOnlySpan<byte> bytes)
    {
        WriteVarint(writer, (ulong)bytes.Length);
        writer.Write(bytes);
    }

    /// <summary>İkili mesaj okuyucu; bozuk veride anlaşılır hata atar.</summary>
    internal ref struct Reader(ReadOnlySpan<byte> data)
    {
        private readonly ReadOnlySpan<byte> _data = data;
        private int _position;

        public readonly bool End => _position >= _data.Length;

        public (int Number, int Wire) Tag()
        {
            var tag = Varint();
            var number = (int)(tag >> 3);
            if (number <= 0)
            {
                throw new ProtoException(L.T("grpc.decode_field_zero", "Yanıt geçerli bir protobuf mesajı değil (alan numarası 0)."));
            }

            return (number, (int)(tag & 7));
        }

        public ulong Varint()
        {
            ulong result = 0;
            for (var shift = 0; shift < 64; shift += 7)
            {
                if (_position >= _data.Length)
                {
                    throw new ProtoException(L.T("grpc.decode_varint_truncated", "Yanıt mesajı yarım kalmış (varint)."));
                }

                var b = _data[_position++];
                result |= (ulong)(b & 0x7F) << shift;
                if ((b & 0x80) == 0)
                {
                    return result;
                }
            }

            throw new ProtoException(L.T("grpc.decode_varint_long", "Yanıt geçerli bir protobuf mesajı değil (varint çok uzun)."));
        }

        public uint Fixed32()
        {
            Ensure(4);
            var value = BinaryPrimitives.ReadUInt32LittleEndian(_data[_position..]);
            _position += 4;
            return value;
        }

        public ulong Fixed64()
        {
            Ensure(8);
            var value = BinaryPrimitives.ReadUInt64LittleEndian(_data[_position..]);
            _position += 8;
            return value;
        }

        public ReadOnlySpan<byte> LengthDelimited()
        {
            var length = Varint();
            if (length > int.MaxValue)
            {
                throw new ProtoException(L.T("grpc.decode_length", "Yanıt geçerli bir protobuf mesajı değil (uzunluk)."));
            }

            Ensure((int)length);
            var slice = _data.Slice(_position, (int)length);
            _position += (int)length;
            return slice;
        }

        public void Skip(int wire)
        {
            switch (wire)
            {
                case 0:
                    Varint();
                    break;
                case 1:
                    Ensure(8);
                    _position += 8;
                    break;
                case 2:
                    LengthDelimited();
                    break;
                case 5:
                    Ensure(4);
                    _position += 4;
                    break;
                default:
                    throw new ProtoException(L.T("grpc.decode_wire_type", "Desteklenmeyen kablo tipi {wire} (proto2 group?).", ("wire", wire)));
            }
        }

        private readonly void Ensure(int count)
        {
            if (_position + count > _data.Length)
            {
                throw new ProtoException(L.T("grpc.decode_truncated", "Yanıt mesajı yarım kalmış."));
            }
        }
    }
}
