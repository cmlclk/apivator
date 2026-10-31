// Punycode (RFC 3492) ve IDN alan adı dönüşümü (xn-- etiketleri); bağımlılık kullanmaz.
import { msg } from '../i18n';
import { ToolError } from './errors';

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;
const MAX_INT = 0x7fffffff;
const ACE_PREFIX = 'xn--';

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  let d = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > ((BASE - T_MIN) * T_MAX) >> 1) {
    d = Math.floor(d / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * d) / (d + SKEW));
}

/** 0–25 → a–z, 26–35 → 0–9. */
const digitChar = (d: number) => String.fromCharCode(d < 26 ? d + 97 : d + 22);

function charDigit(code: number): number {
  if (code >= 48 && code <= 57) return code - 22;
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 97;
  return BASE;
}

const threshold = (k: number, bias: number) => (k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias);

/** Unicode metni Punycode'a çevirir (önek eklemez): `çiçek` → `iek-1lab`. */
export function punycodeEncode(input: string): string {
  const codePoints = Array.from(input, (c) => c.codePointAt(0)!);
  let output = codePoints
    .filter((c) => c < 0x80)
    .map((c) => String.fromCharCode(c))
    .join('');
  const basicLength = output.length;
  let handled = basicLength;
  if (basicLength > 0) output += '-';
  let n = INITIAL_N;
  let delta = 0;
  let bias = INITIAL_BIAS;
  while (handled < codePoints.length) {
    let m = MAX_INT;
    for (const c of codePoints) if (c >= n && c < m) m = c;
    if (m - n > Math.floor((MAX_INT - delta) / (handled + 1)))
      throw new ToolError(msg('toolsNet.punycode.overflow', 'Punycode taşması.'));
    delta += (m - n) * (handled + 1);
    n = m;
    for (const c of codePoints) {
      if (c < n && ++delta > MAX_INT)
        throw new ToolError(msg('toolsNet.punycode.overflow', 'Punycode taşması.'));
      if (c !== n) continue;
      let q = delta;
      for (let k = BASE; ; k += BASE) {
        const t = threshold(k, bias);
        if (q < t) break;
        output += digitChar(t + ((q - t) % (BASE - t)));
        q = Math.floor((q - t) / (BASE - t));
      }
      output += digitChar(q);
      bias = adapt(delta, handled + 1, handled === basicLength);
      delta = 0;
      handled++;
    }
    delta++;
    n++;
  }
  return output;
}

/** Punycode'u Unicode metne çevirir (önek beklemez): `iek-1lab` → `çiçek`. */
export function punycodeDecode(input: string): string {
  const output: number[] = [];
  const lastDash = input.lastIndexOf('-');
  const basic = lastDash >= 0 ? input.slice(0, lastDash) : '';
  for (const char of basic) {
    const code = char.charCodeAt(0);
    if (code >= 0x80)
      throw new ToolError(
        msg(
          'toolsNet.punycode.nonAscii',
          'Geçersiz Punycode: "{input}" ASCII olmayan temel karakter içeriyor.',
          {
            input,
          },
        ),
      );
    output.push(code);
  }
  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  let i = 0;
  for (let index = lastDash >= 0 ? lastDash + 1 : 0; index < input.length;) {
    const oldI = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (index >= input.length)
        throw new ToolError(
          msg('toolsNet.punycode.truncated', 'Geçersiz Punycode: "{input}" yarım kalmış.', { input }),
        );
      const digit = charDigit(input.charCodeAt(index++));
      if (digit >= BASE)
        throw new ToolError(
          msg('toolsNet.punycode.badChar', 'Geçersiz Punycode: "{input}" geçersiz karakter içeriyor.', {
            input,
          }),
        );
      if (digit > Math.floor((MAX_INT - i) / w))
        throw new ToolError(msg('toolsNet.punycode.overflow', 'Punycode taşması.'));
      i += digit * w;
      const t = threshold(k, bias);
      if (digit < t) break;
      if (w > Math.floor(MAX_INT / (BASE - t)))
        throw new ToolError(msg('toolsNet.punycode.overflow', 'Punycode taşması.'));
      w *= BASE - t;
    }
    const length = output.length + 1;
    bias = adapt(i - oldI, length, oldI === 0);
    if (Math.floor(i / length) > MAX_INT - n)
      throw new ToolError(msg('toolsNet.punycode.overflow', 'Punycode taşması.'));
    n += Math.floor(i / length);
    i %= length;
    if (n > 0x10ffff)
      throw new ToolError(
        msg('toolsNet.punycode.badCodePoint', 'Geçersiz Punycode: "{input}" geçersiz kod noktası üretiyor.', {
          input,
        }),
      );
    output.splice(i, 0, n);
    i++;
  }
  return String.fromCodePoint(...output);
}

/** Alan adını etiket etiket ASCII'ye (xn--) çevirir; ASCII etiketler küçük harfe iner. */
export function domainToAscii(domain: string): string {
  return domain
    .normalize('NFC')
    .split('.')
    .map((label) => {
      const lower = label.toLowerCase();
      // eslint-disable-next-line no-control-regex
      return /^[\x00-\x7f]*$/.test(lower) ? lower : ACE_PREFIX + punycodeEncode(lower);
    })
    .join('.');
}

/** `xn--` ile başlayan etiketleri Unicode'a çevirir; diğer etiketler olduğu gibi kalır. */
export function domainToUnicode(domain: string): string {
  return domain
    .split('.')
    .map((label) =>
      label.toLowerCase().startsWith(ACE_PREFIX)
        ? punycodeDecode(label.slice(ACE_PREFIX.length).toLowerCase())
        : label,
    )
    .join('.');
}
