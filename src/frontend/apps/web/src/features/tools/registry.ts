import type { ComponentType, LazyExoticComponent } from 'react';
import { toLower, translate, type MessageKey } from '../../i18n';
import { ENCODE_CONVERT_TOOLS } from './registryEncodeConvert';
import { FORMAT_MORE_TOOLS } from './registryFormatMore';
import { TIME_TEXT_TOOLS } from './registryTimeText';

export type ToolCategory =
  'encoding' | 'convert' | 'format' | 'security' | 'generate' | 'time' | 'web' | 'text';

const CATEGORIES: ToolCategory[] = [
  'encoding',
  'convert',
  'format',
  'security',
  'generate',
  'time',
  'web',
  'text',
];

/** Etiketler erişim anında etkin dilde okunur (sıra listede görünen sıradır). */
export const CATEGORY_LABELS = {} as Record<ToolCategory, string>;
for (const category of CATEGORIES) {
  Object.defineProperty(CATEGORY_LABELS, category, {
    enumerable: true,
    get: () => translate('toolCatalog', `categories.${category}` as MessageKey<'toolCatalog'>),
  });
}

export interface ToolDef {
  /** Adresteki kimlik: `/tools/{id}`. */
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  /** Aramada ad ve açıklamaya ek olarak eşleşen kelimeler. */
  keywords: string[];
  /** Her araç ayrı parçada yüklenir; ana paketi büyütmez. */
  component: LazyExoticComponent<ComponentType>;
}

/** Yeni araç: `tools/` altına varsayılan dışa aktarımlı bir bileşen ve `registryEncodeConvert.ts`, `registryFormatMore.ts` ya da `registryTimeText.ts` içine bir girdi. */
export const TOOLS: ToolDef[] = [...ENCODE_CONVERT_TOOLS, ...FORMAT_MORE_TOOLS, ...TIME_TEXT_TOOLS];

export function findTool(id: string | undefined): ToolDef | undefined {
  return TOOLS.find((t) => t.id === id);
}

/** Etkin dilin büyük/küçük harf kuralıyla (Türkçede İ/ı) aksan duyarsız karşılaştırma için sadeleştirir. */
function fold(text: string): string {
  return toLower(text)
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/** Ad, açıklama ve anahtar kelimelerde arar; boş sorguda tüm araçlar. */
export function searchTools(query: string): ToolDef[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return TOOLS;
  return TOOLS.filter((tool) => {
    const haystack = fold([tool.name, tool.description, ...tool.keywords].join(' '));
    return terms.every((term) => haystack.includes(term));
  });
}
