import { afterEach, beforeEach } from 'vitest';
import { initI18n } from '../messages';
import { setPseudoLanguage, UNTRANSLATED_LETTER } from '../pseudo';

/** Testin başında sözde dile geçer, sonunda Türkçeye döner (test kurulumunun varsayılanı). */
export function usePseudoLanguage(): void {
  beforeEach(() => setPseudoLanguage());
  afterEach(() => initI18n('tr'));
}

export interface UntranslatedOptions {
  /**
   * Çevrilmemiş sayılmayacak parçalar: kullanıcı verisi, sayılar, marka ve teknik terimler (HTTP, JSON, GET…).
   * Dize ise her geçtiği yer, RegExp ise eşleşen kısım metinden çıkarılır; kalan metinde harf varsa hata verilir.
   */
  allow?: readonly (string | RegExp)[];
}

const ATTRIBUTES = ['aria-label', 'title', 'placeholder', 'alt'];
const SKIPPED = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']);

function remaining(text: string, allow: readonly (string | RegExp)[]): string {
  let result = text;
  for (const item of allow) {
    result =
      typeof item === 'string'
        ? result.replaceAll(item, ' ')
        : result.replace(
            new RegExp(item.source, item.flags.includes('g') ? item.flags : `${item.flags}g`),
            ' ',
          );
  }
  return result;
}

/**
 * Sözde dilde çizilmiş bir ağaçta çevrilmemiş metin var mı? Görünen metin düğümleri ile `aria-label`, `title`,
 * `placeholder`, `alt` özniteliklerine bakar. Sözde dil her düz harfi aksanlı harfe çevirdiği için kalan düz harf
 * (ya da Türkçeye özgü harf) gömülü ya da çevrilmemiş metindir. Bulunanlar tek hatada listelenir.
 */
export function expectNoUntranslatedText(container: Element, { allow = [] }: UntranslatedOptions = {}): void {
  const found: string[] = [];
  const check = (where: string, text: string) => {
    const rest = remaining(text, allow);
    if (UNTRANSLATED_LETTER.test(rest)) found.push(`${where}: ${JSON.stringify(text.trim())}`);
  };

  const walker = container.ownerDocument.createTreeWalker(
    container,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  );
  let node: Node | null = walker.currentNode;
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!SKIPPED.has(node.parentElement?.tagName ?? ''))
        check(`<${node.parentElement?.tagName.toLowerCase()}>`, node.textContent ?? '');
    } else {
      const element = node as Element;
      for (const name of ATTRIBUTES) {
        const value = element.getAttribute(name);
        if (value) check(`<${element.tagName.toLowerCase()} ${name}>`, value);
      }
    }
    node = walker.nextNode();
  }

  if (found.length > 0) throw new Error(`Çevrilmemiş metin (${found.length}):\n${found.join('\n')}`);
}
