import { coerceDeep, xmlToValue, type ExecuteResponse, type ExportSource } from '@apivator/core';
import { translate } from '../../i18n';
import { UserError } from '../../lib/errors';

export type TableSourceKind = 'json' | 'xml' | 'csv';

/** Yanıt tabloya çevrilebilir mi (JSON, XML ya da CSV metni)? */
export function tableSourceKind(
  response: ExecuteResponse,
  contentType: string | undefined,
): TableSourceKind | null {
  if (!response.body || response.bodyEncoding === 'base64') return null;
  const ct = contentType?.toLowerCase() ?? '';
  const start = response.body.trimStart()[0];
  if (ct.includes('json') || ((start === '{' || start === '[') && !ct.includes('html'))) return 'json';
  if (ct.includes('csv')) return 'csv';
  if (
    ct.includes('xml') ||
    (start === '<' && !ct.includes('html') && /^\s*<(\?xml|[A-Za-z])/.test(response.body))
  ) {
    return 'xml';
  }
  return null;
}

/** Yanıtı motorun kaynağına çevirir; XML (DOMParser worker'da yok) burada çözülür. */
export function tableSource(kind: TableSourceKind, body: string): ExportSource {
  if (kind !== 'xml') return { kind, text: body };
  const doc = new DOMParser().parseFromString(body, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0)
    throw new UserError(translate('exchange', 'export.notXml'));
  return { kind: 'value', value: coerceDeep(xmlToValue(doc.documentElement)) };
}
