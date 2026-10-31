// Sorgu aracının dilleri: JSONPath ve JMESPath core'da, XPath tarayıcı DOM'u ile (xpath.ts).
import { JmesPathSyntaxError, JsonPathSyntaxError, queryJmesPath, queryJsonPath } from '@apivator/core/tools';
import type { RawLanguage } from '@apivator/core';
import { translate } from '../../i18n';
import { parseJsonInput } from './convert';
import { evaluateXPath, formatXPathOutput } from './xpath';
import { toolErrorText } from './toolUtils';

export type QueryLanguage = 'jsonpath' | 'jmespath' | 'xpath';

export interface QueryLanguageInfo {
  id: QueryLanguage;
  label: string;
  /** İfadenin saklandığı alan; JSONPath eski kayıtlarla uyumlu kalsın diye `expression`. */
  field: string;
  initial: string;
  placeholder: string;
  examples: string[];
  /** Sonuç biçimi seçenekleri (değer → etiket); boşsa seçim yok. */
  outputs: [string, string][];
}

export const QUERY_LANGUAGES: QueryLanguageInfo[] = [
  {
    id: 'jsonpath',
    label: 'JSONPath',
    field: 'expression',
    initial: '$..id',
    placeholder: '$.store.book[?(@.price < 10)].title',
    examples: ['$', '$.*', '$..id', '$[0]', '$[-1]', '$[0:3]', '$..*', '$..[?(@.id)]', '$[?(@.fiyat < 10)]'],
    get outputs(): [string, string][] {
      return [
        ['values', translate('tools', 'query.values')],
        ['paths', translate('tools', 'query.paths')],
      ];
    },
  },
  {
    id: 'jmespath',
    label: 'JMESPath',
    field: 'jmespathExpression',
    initial: '[*].id',
    placeholder: 'people[?age > `30`].{ad: name, yas: age} | sort_by(@, &yas)',
    examples: [
      '@',
      '[*].id',
      '[0]',
      '[-1]',
      'length(@)',
      'keys(@)',
      '[?fiyat < `10`]',
      '[*].{id: id, ad: ad}',
      'sort_by(@, &fiyat)[*].id',
      'max_by(@, &fiyat)',
    ],
    outputs: [],
  },
  {
    id: 'xpath',
    label: 'XPath',
    field: 'xpathExpression',
    initial: '//*',
    placeholder: '//kitap[fiyat < 10]/baslik/text()',
    examples: [
      '/*',
      '//*',
      '//@*',
      '//text()',
      'count(//*)',
      '//*[@id]',
      "//*[local-name()='item']",
      '/*/*[1]',
      '/*/*[last()]',
    ],
    get outputs(): [string, string][] {
      return [
        ['xml', 'XML'],
        ['text', translate('tools', 'query.text')],
      ];
    },
  },
];

export interface QueryItem {
  /** Yol, düğüm adı gibi başlık. */
  label: string;
  preview: string;
  /** Satırdaki kopyala düğmesinin metni. */
  copy: string;
}

export interface QueryResult {
  error: string | null;
  /** Sözdizimi hatasının ifadedeki konumu. */
  position?: number;
  /** Listede gösterilecek eşleşmeler; null ise liste yok. */
  items: QueryItem[] | null;
  /** "3 eşleşme" gibi özet. */
  summary: string | null;
  text: string;
  textLanguage: RawLanguage;
}

const EMPTY: QueryResult = { error: null, items: null, summary: null, text: '', textLanguage: 'Json' };

function preview(value: unknown): string {
  const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? 'undefined');
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

function failure(error: unknown, position?: number): QueryResult {
  return { ...EMPTY, error: toolErrorText(error), position };
}

function runJsonPath(json: unknown, expression: string, output: string): QueryResult {
  // İfade JSON olmadan da denetlensin: sözdizimi hatası hemen görünür.
  const matches = queryJsonPath(json ?? null, expression);
  if (json === undefined) return EMPTY;
  const items = output === 'paths' ? matches.map((m) => m.path) : matches.map((m) => m.value);
  return {
    ...EMPTY,
    items: matches.map((m) => ({ label: m.path, preview: preview(m.value), copy: m.path })),
    summary: translate('tools', 'query.matches', { count: matches.length }),
    text: JSON.stringify(items, null, 2),
  };
}

function runJmesPath(json: unknown, expression: string): QueryResult {
  if (json === undefined) {
    try {
      queryJmesPath(null, expression);
    } catch (error) {
      if (error instanceof JmesPathSyntaxError) throw error;
    }
    return EMPTY;
  }
  const result = queryJmesPath(json, expression);
  return {
    ...EMPTY,
    summary: Array.isArray(result)
      ? translate('tools', 'query.items', { count: result.length })
      : result === null
        ? translate('tools', 'query.resultNull')
        : null,
    text: JSON.stringify(result, null, 2),
  };
}

function runXPath(xml: string, expression: string, output: string): QueryResult {
  if (!xml.trim()) return EMPTY;
  const result = evaluateXPath(xml, expression);
  const text = formatXPathOutput(result, output === 'text' ? 'text' : 'xml');
  if (result.kind !== 'nodes') {
    const type = {
      number: translate('tools', 'query.typeNumber'),
      string: translate('tools', 'query.typeString'),
      boolean: translate('tools', 'query.typeBoolean'),
    }[result.kind];
    return { ...EMPTY, summary: translate('tools', 'query.resultOf', { type }), text, textLanguage: 'Text' };
  }
  return {
    ...EMPTY,
    items: result.nodes.map((node) => ({
      label: node.kind === 'attribute' ? `@${node.name}` : node.name,
      preview: preview(node.kind === 'element' ? node.xml : node.text),
      copy: output === 'text' ? node.text : node.xml,
    })),
    summary:
      result.count > result.nodes.length
        ? translate('tools', 'query.nodesShown', { count: result.count, shown: result.nodes.length })
        : translate('tools', 'query.nodes', { count: result.count }),
    text,
    textLanguage: output === 'text' ? 'Text' : 'Xml',
  };
}

/** Seçili dilde sorguyu çalıştırır; hiçbir zaman fırlatmaz, hatayı sonuçta döndürür. */
export function runQuery(
  language: QueryLanguage,
  source: string,
  expression: string,
  output: string,
): QueryResult {
  if (!expression.trim()) return EMPTY;
  if (language === 'xpath') {
    try {
      return runXPath(source, expression, output);
    } catch (error) {
      return failure(error);
    }
  }
  let json: unknown;
  let parseError: string | null = null;
  if (source.trim()) {
    try {
      json = parseJsonInput(source);
    } catch (error) {
      parseError = toolErrorText(error);
    }
  }
  try {
    const result =
      language === 'jmespath' ? runJmesPath(json, expression) : runJsonPath(json, expression, output);
    return parseError ? { ...result, error: parseError } : result;
  } catch (error) {
    const position =
      error instanceof JsonPathSyntaxError || error instanceof JmesPathSyntaxError
        ? error.position
        : undefined;
    return failure(error, position);
  }
}
