// XPath 1.0 sorgusu: tarayıcının DOMParser ve document.evaluate'i (core DOM'a bağımlı değil, bu yüzden burada).
import { ToolError } from '@apivator/core/tools';
import { translate } from '../../i18n';

export interface XPathNode {
  /** `element`, `attribute`, `text`, `comment`, … */
  kind: string;
  /** Öğe/öznitelik adı; metin düğümünde `#text`. */
  name: string;
  /** Düğümün metin içeriği (öznitelikte değeri). */
  text: string;
  /** XML gösterimi (öznitelikte `ad="değer"`). */
  xml: string;
}

export type XPathOutput =
  | { kind: 'nodes'; nodes: XPathNode[]; count: number }
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean };

/** Sonuçta serileştirilen en fazla düğüm; sayı (`count`) hepsini kapsar. */
const MAX_NODES = 5000;
/**
 * Serileştirilen toplam karakter sınırı: `//*` derin belgede her öğeyi alt ağacıyla yazar (boyut × derinlik);
 * aşılınca kalan düğümler yalnızca sayılır.
 */
const MAX_SERIALIZED = 5_000_000;

const NODE_KINDS: Record<number, string> = {
  1: 'element',
  2: 'attribute',
  3: 'text',
  4: 'cdata',
  7: 'processing-instruction',
  8: 'comment',
  9: 'document',
};

/** XML metnini çözümler; DTD ve varlık tanımları güvenlik nedeniyle reddedilir. */
export function parseXmlDocument(text: string): Document {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new ToolError(translate('tools', 'errors.xmlDoctype'));
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const error = doc.getElementsByTagName('parsererror')[0];
  if (error || !doc.documentElement) {
    const detail = error?.textContent?.split('\n').find((line) => line.trim()) ?? '';
    throw new ToolError(
      detail
        ? translate('tools', 'errors.invalidXmlDetail', { detail: detail.trim() })
        : translate('tools', 'errors.invalidXml'),
    );
  }
  return doc;
}

function describe(node: Node, serializer: XMLSerializer): XPathNode {
  const kind = NODE_KINDS[node.nodeType] ?? 'node';
  if (node.nodeType === 2) {
    const attr = node as Attr;
    const escaped = attr.value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    return { kind, name: attr.name, text: attr.value, xml: `${attr.name}="${escaped}"` };
  }
  return {
    kind,
    name: node.nodeName,
    text: node.textContent ?? '',
    xml:
      node.nodeType === 9
        ? serializer.serializeToString((node as Document).documentElement)
        : serializer.serializeToString(node),
  };
}

/**
 * XPath 1.0 ifadesini XML belgesi üzerinde çalıştırır. Düğüm kümesi belge sırasıyla döner; `count(...)`,
 * `string(...)`, `... = ...` gibi ifadeler sayı/metin/mantıksal sonuç verir. Kökte tanımlı önekler
 * (`xmlns:p="..."`) ifadede kullanılabilir.
 */
export function evaluateXPath(xml: string, expression: string): XPathOutput {
  const doc = parseXmlDocument(xml);
  const root = doc.documentElement;
  const resolver = (prefix: string | null) => root.lookupNamespaceURI(prefix);
  // Tanımsız önek: tarayıcılar NamespaceError fırlatır, jsdom sessizce boş döner; her yerde aynı mesaj olsun.
  // Metin değişmezleri çıkarılır; `child::a` gibi eksenler (`::`) önek sayılmaz.
  const bare = expression.replace(/'[^']*'|"[^"]*"/g, '""');
  for (const [, prefix] of bare.matchAll(/(?<![\w.-])([A-Za-z_][\w.-]*):(?=[A-Za-z_*])/g))
    if (resolver(prefix!) === null)
      throw new ToolError(translate('tools', 'errors.xpathPrefix', { prefix: prefix! }));
  let result: XPathResult;
  try {
    result = doc.evaluate(expression, doc, resolver, XPathResult.ANY_TYPE, null);
    if (
      result.resultType === XPathResult.UNORDERED_NODE_ITERATOR_TYPE ||
      result.resultType === XPathResult.ORDERED_NODE_ITERATOR_TYPE
    )
      result = doc.evaluate(expression, doc, resolver, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  } catch (error) {
    const detail = error instanceof Error && error.message ? error.message : '';
    throw new ToolError(
      detail
        ? translate('tools', 'errors.xpathInvalidDetail', { detail })
        : translate('tools', 'errors.xpathInvalid'),
    );
  }
  switch (result.resultType) {
    case XPathResult.NUMBER_TYPE:
      return { kind: 'number', value: result.numberValue };
    case XPathResult.STRING_TYPE:
      return { kind: 'string', value: result.stringValue };
    case XPathResult.BOOLEAN_TYPE:
      return { kind: 'boolean', value: result.booleanValue };
    default: {
      const serializer = new XMLSerializer();
      const count = result.snapshotLength;
      const nodes: XPathNode[] = [];
      let size = 0;
      for (let i = 0; i < Math.min(count, MAX_NODES) && size < MAX_SERIALIZED; i++) {
        const node = describe(result.snapshotItem(i)!, serializer);
        size += node.xml.length + node.text.length;
        nodes.push(node);
      }
      return { kind: 'nodes', nodes, count };
    }
  }
}

/** Sonucun metin gösterimi: düğümlerde XML ya da yalnızca metin, diğerlerinde değerin kendisi. */
export function formatXPathOutput(output: XPathOutput, mode: 'xml' | 'text'): string {
  if (output.kind !== 'nodes') return String(output.value);
  return output.nodes.map((node) => (mode === 'text' ? node.text : node.xml)).join('\n');
}
