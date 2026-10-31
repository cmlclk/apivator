import { numberFormatter, translate } from '../../../i18n';

/** Ondalık ayracı etkin dile göre (tr: virgül). */
const fixed = (n: number, min: number, max = min) =>
  numberFormatter({ minimumFractionDigits: min, maximumFractionDigits: max }).format(n);

/** HAR görüntüleyicide boyut ve süre biçimleri. */
export function formatBytes(bytes: number): string {
  if (bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${fixed(bytes / 1024, 1)} KB`;
  return `${fixed(bytes / 1024 / 1024, 1)} MB`;
}

export function formatMs(ms: number): string {
  return ms >= 1000
    ? `${fixed(ms / 1000, 2)} ${translate('toolsData', 'har.seconds')}`
    : `${fixed(Math.round(ms * 10) / 10, 0, 1)} ms`;
}
