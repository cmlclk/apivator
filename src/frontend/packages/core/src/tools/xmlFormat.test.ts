import { afterEach, describe, expect, it } from 'vitest';
import en from '../locales/en/toolsData.json';
import { registerCoreMessages, setCoreLanguage } from '../i18n';
import { FormatError } from './formatError';
import { formatXml, minifyXml } from './xmlFormat';

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE note [ <!ENTITY ad "Ayşe"> ]>
<!-- kök öncesi yorum -->
<katalog   xmlns:x="urn:x" sürüm='2'><kitap id="1"><ad>Kürk Mantolu &amp; Madonna</ad>
<x:yazar/><not><![CDATA[<b>ham</b> & metin]]></not>
<!-- iç yorum --><p>Merhaba <b>dünya</b>, nasılsın?</p><bos></bos></kitap>
<?işlem veri?></katalog>`;

const EXPECTED = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE note [ <!ENTITY ad "Ayşe"> ]>
<!-- kök öncesi yorum -->
<katalog xmlns:x="urn:x" sürüm='2'>
  <kitap id="1">
    <ad>Kürk Mantolu &amp; Madonna</ad>
    <x:yazar/>
    <not><![CDATA[<b>ham</b> & metin]]></not>
    <!-- iç yorum -->
    <p>Merhaba <b>dünya</b>, nasılsın?</p>
    <bos></bos>
  </kitap>
  <?işlem veri?>
</katalog>`;

function errorOf(text: string): FormatError {
  try {
    formatXml(text);
  } catch (error) {
    if (error instanceof FormatError) return error;
    throw error;
  }
  throw new Error('hata bekleniyordu');
}

describe('formatXml', () => {
  it('girintiler; yorum, CDATA, işlem talimatı, DOCTYPE ve karışık içeriği korur', () => {
    expect(formatXml(SAMPLE)).toBe(EXPECTED);
  });

  it('4 boşluk ve sekme girintisi', () => {
    expect(formatXml('<a><b>1</b></a>', { indent: 4 })).toBe('<a>\n    <b>1</b>\n</a>');
    expect(formatXml('<a><b>1</b></a>', { indent: '\t' })).toBe('<a>\n\t<b>1</b>\n</a>');
  });

  it('idempotent: biçimlendirilmiş metin yeniden biçimlendirilince değişmez', () => {
    const once = formatXml(SAMPLE);
    expect(formatXml(once)).toBe(once);
    const tabbed = formatXml(SAMPLE, { indent: '\t' });
    expect(formatXml(tabbed, { indent: '\t' })).toBe(tabbed);
  });

  it('küçültüp yeniden biçimlendirmek aynı sonucu verir', () => {
    const min = minifyXml(SAMPLE);
    expect(min).not.toContain('\n  <');
    expect(min).toContain('<kitap id="1"><ad>');
    expect(formatXml(min)).toBe(formatXml(SAMPLE));
    expect(minifyXml(min)).toBe(min);
  });

  it('küçültmede yorumlar istenirse atılır', () => {
    expect(minifyXml('<a>\n  <!-- x -->\n  <b/>\n</a>', { removeComments: true })).toBe('<a><b/></a>');
    expect(minifyXml('<a>\n  <!-- x -->\n</a>', { removeComments: true })).toBe('<a></a>');
    expect(minifyXml('<a>\n  <!-- x -->\n</a>')).toBe('<a><!-- x --></a>');
  });

  it('metin içeriği ve xml:space="preserve" olduğu gibi kalır', () => {
    expect(formatXml('<a><b>  iki  boşluk </b></a>')).toBe('<a>\n  <b>  iki  boşluk </b>\n</a>');
    const pre = '<a><kod xml:space="preserve">\n  <x/>\n    <y/>\n</kod></a>';
    expect(formatXml(pre)).toBe('<a>\n  <kod xml:space="preserve">\n  <x/>\n    <y/>\n</kod>\n</a>');
    expect(minifyXml(pre)).toBe(pre);
  });

  it('öznitelik arası boşluğu sadeleştirir, tırnak türünü ve değerini korur', () => {
    expect(formatXml(`<a  x = "1"\n   y='i"ki'/>`)).toBe(`<a x="1" y='i"ki'/>`);
  });

  it('kök dışındaki metni kırpar, boş girdide boş döner', () => {
    expect(formatXml('  \n')).toBe('');
    expect(formatXml('<a/>\n<b/>')).toBe('<a/>\n<b/>');
  });

  it.each([
    ['<a><b></a>', 'Beklenmeyen kapanış etiketi </a>; </b> bekleniyordu', 1, 7],
    ['<a>\n  <b>\n</a>', 'Beklenmeyen kapanış etiketi', 3, 1],
    ['<a>', '<a> öğesi kapanmamış', 1, 1],
    ['</a>', 'açık öğe yok', 1, 1],
    ['<a x=1/>', 'tırnak içinde', 1, 6],
    ['<a x="1"y="2"/>', 'boşluk olmalı', 1, 9],
    ['<a x="1" x="2"/>', 'Yinelenen öznitelik', 1, 10],
    ['<a>1 < 2</a>', 'Öğe adı bekleniyordu', 1, 7],
    ['<a>Tom & Jerry</a>', 'Geçersiz varlık', 1, 8],
    ['<a><!-- açık</a>', 'Yorum kapanmamış', 1, 4],
    ['<a><![CDATA[x</a>', 'CDATA', 1, 4],
    ['<a x="1', 'tırnağı kapanmamış', 1, 6],
    ['<a\n  x="1"', 'kapanmamış', 1, 1],
  ])('hatalı XML: %s', (text, reason, line, column) => {
    const error = errorOf(text);
    expect(error.message).toContain(reason);
    expect({ line: error.line, column: error.column }).toEqual({ line, column });
    expect(error.message).toMatch(new RegExp(`^${line}\\. satır, ${column}\\. sütun: `));
  });

  it('karakter ve sayısal varlıkları kabul eder', () => {
    expect(formatXml('<a>&lt;&#231;&#xE7;&ad;</a>')).toBe('<a>&lt;&#231;&#xE7;&ad;</a>');
  });

  it('büyük ve derin belgede yığın taşmaz', () => {
    const deep = '<a>'.repeat(1000) + 'x' + '</a>'.repeat(1000);
    const formatted = formatXml(deep);
    expect(formatted.split('\n')).toHaveLength(1999);
    expect(formatXml(formatted)).toBe(formatted);
  });
});

describe('formatXml büyük girdi', () => {
  it('çok sayıda metin düğümünde varlık/]]> denetimi tüm belgeyi taramaz', () => {
    const text = `<r>${'<a>x</a>\n'.repeat(150_000)}</r>`;
    const started = performance.now();
    const formatted = formatXml(text);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(formatted.split('\n')).toHaveLength(150_002);
  });

  it('varlık ve ]]> hataları yine metin parçasındaki konumu gösterir', () => {
    const offset = (text: string) => {
      try {
        formatXml(text);
      } catch (error) {
        return (error as FormatError).offset;
      }
      return null;
    };
    expect(offset('<r><a>x</a><b>a & b</b></r>')).toBe(16);
    expect(offset('<r><a>x</a><b>a ]]> b</b></r>')).toBe(16);
    expect(offset('<r><a>&amp;</a><b>&#x41;</b></r>')).toBeNull();
  });
});

describe('English messages', () => {
  afterEach(() => setCoreLanguage('tr'));

  it('reports syntax errors in English with quoted values', () => {
    registerCoreMessages('en', { toolsData: en });
    setCoreLanguage('en');
    expect(() => formatXml('<a><b></a>')).toThrow(
      'Line 1, column 7: Unexpected closing tag </a>; expected </b>',
    );
    expect(() => formatXml('<a x=1/>')).toThrow('Attribute value must be quoted');
    expect(() => formatXml('<a x/>')).toThrow("Expected '=' after attribute 'x'");
  });
});
