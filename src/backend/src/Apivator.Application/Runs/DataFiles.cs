using System.Text;
using System.Text.Json;
using Apivator.Application.Common.Localization;

namespace Apivator.Application.Runs;

public sealed class DataFileException(string message) : Exception(message);

/// <summary>
/// Runner veri dosyası (CSV ya da JSON): her satır bir iterasyon, sütun adları <c>pm.iterationData</c> anahtarları.
/// Web arayüzündeki ayrıştırıcıyla (packages/core/dataFile.ts) aynı kurallar.
/// </summary>
public static class DataFiles
{
    public static List<Dictionary<string, string>> Parse(string fileName, string text)
    {
        var trimmed = text.TrimStart('﻿', ' ', '\t', '\r', '\n');
        return fileName.EndsWith(".json", StringComparison.OrdinalIgnoreCase) || trimmed.StartsWith('[')
            ? ParseJson(text)
            : ParseCsv(text);
    }

    /// <summary>RFC 4180: tırnaklı alanlar, "" kaçışı, alan içinde satır sonu. İlk satır başlık; ';' ayırıcı da tanınır.</summary>
    public static List<Dictionary<string, string>> ParseCsv(string text)
    {
        var source = text.TrimStart('﻿');
        var firstLine = source.Split('\n', 2)[0];
        var delimiter = firstLine.Count(c => c == ';') > firstLine.Count(c => c == ',') ? ';' : ',';

        var records = new List<List<string>>();
        var record = new List<string>();
        var field = new StringBuilder();
        var quoted = false;
        for (var i = 0; i < source.Length; i++)
        {
            var ch = source[i];
            if (quoted)
            {
                if (ch == '"')
                {
                    if (i + 1 < source.Length && source[i + 1] == '"')
                    {
                        field.Append('"');
                        i++;
                    }
                    else
                    {
                        quoted = false;
                    }
                }
                else
                {
                    field.Append(ch);
                }

                continue;
            }

            if (ch == '"' && field.Length == 0)
            {
                quoted = true;
            }
            else if (ch == delimiter)
            {
                record.Add(field.ToString());
                field.Clear();
            }
            else if (ch is '\n' or '\r')
            {
                record.Add(field.ToString());
                records.Add(record);
                record = [];
                field.Clear();
                if (ch == '\r' && i + 1 < source.Length && source[i + 1] == '\n')
                {
                    i++;
                }
            }
            else
            {
                field.Append(ch);
            }
        }

        if (quoted)
        {
            throw new DataFileException(L.T("run.csv_unclosed_quote", "CSV: kapanmamış tırnak."));
        }

        if (field.Length > 0 || record.Count > 0)
        {
            record.Add(field.ToString());
            records.Add(record);
        }

        var nonEmpty = records.Where(r => r.Any(v => v.Trim().Length > 0)).ToList();
        if (nonEmpty.Count == 0)
        {
            throw new DataFileException(L.T("run.csv_empty", "CSV dosyası boş."));
        }

        var columns = nonEmpty[0].Select(c => c.Trim()).ToList();
        if (columns.Any(c => c.Length == 0))
        {
            throw new DataFileException(L.T("run.csv_empty_column", "CSV başlık satırında boş sütun adı var."));
        }

        return nonEmpty.Skip(1)
            .Select(values => columns.Select((c, i) => (c, v: i < values.Count ? values[i] : string.Empty))
                .GroupBy(x => x.c, StringComparer.Ordinal)
                .ToDictionary(g => g.Key, g => g.Last().v, StringComparer.Ordinal))
            .ToList();
    }

    /// <summary>Nesne dizisi; metin olmayan değerler JSON metnine çevrilir.</summary>
    public static List<Dictionary<string, string>> ParseJson(string text)
    {
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(text.TrimStart('﻿'));
        }
        catch (JsonException ex)
        {
            throw new DataFileException(L.T("run.json_unreadable", "JSON okunamadı: {error}", ("error", ex.Message)));
        }

        using (document)
        {
            if (document.RootElement.ValueKind != JsonValueKind.Array
                || document.RootElement.EnumerateArray().Any(item => item.ValueKind != JsonValueKind.Object))
            {
                throw new DataFileException(L.T("run.json_not_array", "JSON veri dosyası nesnelerden oluşan bir dizi olmalı: [{ \"ad\": \"Ayşe\" }, ...]"));
            }

            return document.RootElement.EnumerateArray()
                .Select(item => item.EnumerateObject().ToDictionary(
                    p => p.Name,
                    p => p.Value.ValueKind switch
                    {
                        JsonValueKind.String => p.Value.GetString()!,
                        JsonValueKind.Null or JsonValueKind.Undefined => string.Empty,
                        _ => p.Value.GetRawText(),
                    },
                    StringComparer.Ordinal))
                .ToList();
        }
    }
}
