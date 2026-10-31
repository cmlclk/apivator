/** Satır işlemleri aracının adım adları ve kayıtlı adımların doğrulanması. */
import { LINE_OP_DEFAULTS, type LineOp, type LineOpKind } from '@apivator/core/tools';
import { translate } from '../../../i18n';

const kindLabel = (kind: LineOpKind) => translate('toolsMisc', `lineOps.kinds.${kind}`);

/** Adım adları dil değişince güncel kalsın diye erişim anında çevrilir. */
export const LINE_OP_LABELS: Record<LineOpKind, string> = {
  get sort() {
    return kindLabel('sort');
  },
  get unique() {
    return kindLabel('unique');
  },
  get 'remove-empty'() {
    return kindLabel('remove-empty');
  },
  get trim() {
    return kindLabel('trim');
  },
  get reverse() {
    return kindLabel('reverse');
  },
  get shuffle() {
    return kindLabel('shuffle');
  },
  get affix() {
    return kindLabel('affix');
  },
  get number() {
    return kindLabel('number');
  },
  get join() {
    return kindLabel('join');
  },
  get split() {
    return kindLabel('split');
  },
  get filter() {
    return kindLabel('filter');
  },
  get wrap() {
    return kindLabel('wrap');
  },
  get unwrap() {
    return kindLabel('unwrap');
  },
};

export const LINE_OP_KINDS = Object.keys(LINE_OP_LABELS) as LineOpKind[];

/** Kayıtlı (yerel depolamadan gelen) adım listesini doğrular; bilinmeyen alanlar varsayılana döner. */
export function parseSteps(json: string): LineOp[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item: unknown): LineOp[] => {
    if (typeof item !== 'object' || item === null) return [];
    const kind = (item as { kind?: unknown }).kind;
    // hasOwn: 'toString', 'constructor' gibi prototip adları işlem sayılmasın.
    if (typeof kind !== 'string' || !Object.hasOwn(LINE_OP_DEFAULTS, kind)) return [];
    const defaults = LINE_OP_DEFAULTS[kind as LineOpKind] as Record<string, unknown>;
    const step: Record<string, unknown> = { ...defaults };
    for (const [key, value] of Object.entries(item)) {
      if (Object.hasOwn(defaults, key) && typeof value === typeof defaults[key]) step[key] = value;
    }
    return [step as LineOp];
  });
}
