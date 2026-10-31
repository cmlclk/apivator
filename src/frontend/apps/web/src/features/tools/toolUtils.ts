import type { ComponentType, LazyExoticComponent } from 'react';
import { formatNumber, translate, type MessageKey } from '../../i18n';
import type { ToolCategory, ToolDef } from './registry';

export const toolSelectClass =
  'h-7 rounded-md border border-line bg-surface px-2 text-xs text-fg disabled:opacity-60';
export const toolLabelClass = 'flex items-center gap-1.5 text-xs text-fg-muted';

/** Bayt sayısını okunur boyuta çevirir (bayt / KB / MB). */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return translate('tools', 'size.bytes', { count: bytes });
  const oneDecimal = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
  if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, oneDecimal)} KB`;
  return `${formatNumber(bytes / 1024 / 1024, oneDecimal)} MB`;
}

/** Hatayı kullanıcıya gösterilecek metne çevirir. */
export function toolErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const catalog = (id: string, field: 'name' | 'description' | 'keywords') =>
  translate('toolCatalog', `tools.${id}.${field}` as MessageKey<'toolCatalog'>);

/**
 * Katalog kaydı: ad, açıklama ve anahtar kelimeler `toolCatalog` ad alanından erişim anında (etkin dilde) okunur;
 * böylece tüketiciler `tool.name` gibi alanları değişmeden kullanır. Anahtar kelimeler çeviri dosyasında `|` ile ayrılır.
 */
export function tool(
  id: string,
  category: ToolCategory,
  component: LazyExoticComponent<ComponentType>,
): ToolDef {
  return {
    id,
    category,
    component,
    get name() {
      return catalog(id, 'name');
    },
    get description() {
      return catalog(id, 'description');
    },
    get keywords() {
      return catalog(id, 'keywords').split('|');
    },
  };
}
