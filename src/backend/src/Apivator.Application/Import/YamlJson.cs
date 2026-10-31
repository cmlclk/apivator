using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Apivator.Application.Common.Localization;
using YamlDotNet.Core;
using YamlDotNet.Core.Events;

namespace Apivator.Application.Import;

/// <summary>
/// YAML belgesini JSON ağacına çevirir (OpenAPI/Swagger belgeleri için). Düz (tırnaksız) değerler YAML 1.2
/// çekirdek şemasına göre sayı, mantıksal ya da null olur; "&lt;&lt;" birleştirme anahtarı desteklenir. Takma adların
/// (alias) açılmasıyla büyüyen belgeler ("billion laughs") düğüm sınırıyla durdurulur.
/// </summary>
internal static partial class YamlJson
{
    public const int MaxNodes = 2_000_000;
    private const int MaxDepth = 256;

    [GeneratedRegex(@"^[-+]?[0-9]+$")]
    private static partial Regex Integer();

    [GeneratedRegex(@"^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$")]
    private static partial Regex Float();

    /// <exception cref="FormatException">YAML geçersizse ya da sınırlar aşılırsa (mesaj kullanıcıya gösterilir).</exception>
    public static JsonNode? Parse(string text)
    {
        var parser = new Parser(new StringReader(text));
        var reader = new Reader(parser);
        try
        {
            parser.Consume<StreamStart>();
            if (!parser.TryConsume<DocumentStart>(out _))
            {
                return null;
            }

            return reader.Node(0);
        }
        catch (YamlException ex)
        {
            throw new FormatException(L.T("import.yaml_unreadable", "YAML okunamadı (satır {line}, sütun {column}): {error}", ("line", ex.Start.Line), ("column", ex.Start.Column), ("error", ex.Message)), ex);
        }
    }

    private sealed class Reader(IParser parser)
    {
        private readonly Dictionary<string, (JsonNode? Node, int Size)> _anchors = new(StringComparer.Ordinal);
        private int _count;

        public JsonNode? Node(int depth)
        {
            if (depth > MaxDepth)
            {
                throw new FormatException(L.T("import.yaml_deep", "YAML belgesi çok derin iç içe."));
            }

            if (parser.TryConsume<AnchorAlias>(out var alias))
            {
                if (!_anchors.TryGetValue(alias.Value.Value, out var anchored))
                {
                    throw new FormatException(L.T("import.yaml_alias", "YAML'da tanımsız takma ad: *{alias}", ("alias", alias.Value.Value)));
                }

                Count(anchored.Size);
                return anchored.Node?.DeepClone();
            }

            var start = _count;
            JsonNode? node;
            AnchorName anchor;
            if (parser.TryConsume<Scalar>(out var scalar))
            {
                Count(1);
                anchor = scalar.Anchor;
                node = Value(scalar);
            }
            else if (parser.TryConsume<SequenceStart>(out var sequence))
            {
                Count(1);
                anchor = sequence.Anchor;
                var array = new JsonArray();
                while (!parser.TryConsume<SequenceEnd>(out _))
                {
                    array.Add(Node(depth + 1));
                }

                node = array;
            }
            else if (parser.TryConsume<MappingStart>(out var mapping))
            {
                Count(1);
                anchor = mapping.Anchor;
                node = Mapping(depth);
            }
            else
            {
                throw new FormatException(L.T("import.yaml_unexpected", "Beklenmeyen YAML öğesi: {element}", ("element", parser.Current?.GetType().Name)));
            }

            if (!anchor.IsEmpty)
            {
                _anchors[anchor.Value] = (node, _count - start);
            }

            return node;
        }

        private JsonObject Mapping(int depth)
        {
            var result = new JsonObject();
            var merged = new List<JsonObject>();
            while (!parser.TryConsume<MappingEnd>(out _))
            {
                var isMergeKey = parser.Current is Scalar { Value: "<<", Style: ScalarStyle.Plain };
                var key = Node(depth + 1);
                var value = Node(depth + 1);
                if (isMergeKey)
                {
                    if (value is JsonObject single)
                    {
                        merged.Add(single);
                    }
                    else if (value is JsonArray many)
                    {
                        merged.AddRange(many.OfType<JsonObject>());
                    }

                    continue;
                }

                var name = key switch
                {
                    null => "null",
                    JsonValue v when v.TryGetValue<string>(out var s) => s,
                    _ => key.ToJsonString(),
                };
                result[name] = value; // yinelenen anahtarda sonuncusu geçerli
            }

            // Birleştirilen eşlemeler yalnızca eksik anahtarları doldurur (ilk gelen önceliklidir).
            foreach (var source in merged)
            {
                foreach (var (name, value) in source)
                {
                    if (!result.ContainsKey(name))
                    {
                        result[name] = value?.DeepClone();
                    }
                }
            }

            return result;
        }

        private void Count(int nodes)
        {
            _count += nodes;
            if (_count > MaxNodes)
            {
                throw new FormatException(L.T("import.yaml_large", "YAML belgesi çok büyük (takma adlar açıldığında sınır aşıldı)."));
            }
        }
    }

    private static JsonValue? Value(Scalar scalar)
    {
        var text = scalar.Value;
        var tag = scalar.Tag.IsEmpty ? null : scalar.Tag.Value;
        if (tag is "tag:yaml.org,2002:str" || (tag is null && scalar.Style != ScalarStyle.Plain))
        {
            return JsonValue.Create(text);
        }

        switch (text)
        {
            case "" or "~" or "null" or "Null" or "NULL":
                return null;
            case "true" or "True" or "TRUE":
                return JsonValue.Create(true);
            case "false" or "False" or "FALSE":
                return JsonValue.Create(false);
        }

        if (Integer().IsMatch(text))
        {
            return long.TryParse(text, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var l) ? JsonValue.Create(l)
                : decimal.TryParse(text, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var d) ? JsonValue.Create(d)
                : JsonValue.Create(text);
        }

        if (text.StartsWith("0x", StringComparison.Ordinal) && long.TryParse(text[2..], NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out var hex))
        {
            return JsonValue.Create(hex);
        }

        // decimal sondaki sıfırları korur ("2.0" → 2.0); "openapi: 3.1" gibi sürümler sonradan metne çevrilir.
        if (Float().IsMatch(text) && decimal.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var exact))
        {
            return JsonValue.Create(exact);
        }

        if (Float().IsMatch(text) && double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var number) && double.IsFinite(number))
        {
            return JsonValue.Create(number);
        }

        return JsonValue.Create(text);
    }
}
