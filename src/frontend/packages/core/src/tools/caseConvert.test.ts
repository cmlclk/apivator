import { describe, expect, it } from 'vitest';
import { CASE_STYLES, convertCase, splitWords, type CaseStyle } from './caseConvert';

describe('splitWords', () => {
  it('camelCase, PascalCase ve kısaltmalar', () => {
    expect(splitWords('XMLHttpRequest')).toEqual(['XML', 'Http', 'Request']);
    expect(splitWords('getHTTPResponseCode')).toEqual(['get', 'HTTP', 'Response', 'Code']);
    expect(splitWords('customerName')).toEqual(['customer', 'Name']);
    expect(splitWords('URL')).toEqual(['URL']);
  });

  it('rakamlar önceki kelimeye bağlı kalır', () => {
    expect(splitWords('user2Id')).toEqual(['user2', 'Id']);
    expect(splitWords('HTTP2Server')).toEqual(['HTTP2', 'Server']);
    expect(splitWords('version_10_beta')).toEqual(['version', '10', 'beta']);
  });

  it('ayırıcılar ve Türkçe harfler', () => {
    expect(splitWords('a_b-c.d/e f')).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(splitWords('  --şehir__adı--  ')).toEqual(['şehir', 'adı']);
    expect(splitWords('müşteriAdıSoyadı')).toEqual(['müşteri', 'Adı', 'Soyadı']);
    expect(splitWords('İstanbulIşık')).toEqual(['İstanbul', 'Işık']);
    // NFD girdi birleştirilir.
    expect(splitWords('caféName')).toEqual(['café', 'Name']);
  });
});

describe('convertCase', () => {
  const all = (text: string, options = {}) =>
    Object.fromEntries(CASE_STYLES.map((s) => [s.id, convertCase(text, s.id, options)]));

  it('tüm biçimler', () => {
    expect(all('XMLHttpRequest')).toEqual({
      camel: 'xmlHttpRequest',
      pascal: 'XmlHttpRequest',
      snake: 'xml_http_request',
      constant: 'XML_HTTP_REQUEST',
      kebab: 'xml-http-request',
      cobol: 'XML-HTTP-REQUEST',
      train: 'Xml-Http-Request',
      dot: 'xml.http.request',
      path: 'xml/http/request',
      title: 'Xml Http Request',
      sentence: 'Xml http request',
      lower: 'xmlhttprequest',
      upper: 'XMLHTTPREQUEST',
      toggle: 'xmlhTTPrEQUEST',
    });
  });

  it('Türkçe büyük/küçük harf kuralları', () => {
    expect(convertCase('İstanbul ısparta IŞIK', 'snake')).toBe('istanbul_ısparta_ışık');
    expect(convertCase('İstanbul ısparta IŞIK', 'constant')).toBe('İSTANBUL_ISPARTA_IŞIK');
    expect(convertCase('istanbul ısparta ışık', 'pascal')).toBe('İstanbulIspartaIşık');
    expect(convertCase('iı', 'toggle')).toBe('İI');
  });

  it('İngilizce kuralları', () => {
    const en = { locale: 'en' } as const;
    expect(convertCase('IŞIK', 'lower', en)).toBe('işik');
    expect(convertCase('İstanbul', 'lower', en)).toBe('istanbul');
    expect(convertCase('istanbul', 'upper', en)).toBe('ISTANBUL');
    expect(convertCase('ısparta', 'pascal', en)).toBe('Isparta');
  });

  it('ASCII seçeneği', () => {
    expect(convertCase('müşteri adı', 'camel', { ascii: true })).toBe('musteriAdi');
    expect(convertCase('IŞIK şiddeti', 'snake', { ascii: true })).toBe('isik_siddeti');
    expect(convertCase('İstanbul', 'constant', { ascii: true })).toBe('ISTANBUL');
    expect(convertCase('Straße', 'kebab', { ascii: true })).toBe('strasse');
  });

  it('Title Case küçük kelimeler', () => {
    expect(convertCase('ali ve veli ile ayşe', 'title')).toBe('Ali ve Veli ile Ayşe');
    expect(convertCase('ve sonra', 'title')).toBe('Ve Sonra');
    expect(convertCase('ali ve veli', 'title', { smallWords: false })).toBe('Ali Ve Veli');
    expect(convertCase('the lord of the rings', 'title', { locale: 'en' })).toBe('The Lord of the Rings');
  });

  it('çok satırlı girdi', () => {
    expect(convertCase('first_name\n\nlastName', 'kebab')).toBe('first-name\n\nlast-name');
    expect(convertCase('first_name\r\nlastName', 'kebab', { perLine: false })).toBe('first-name-last-name');
  });

  it('gidiş-dönüş kelimeleri korur', () => {
    const styles: CaseStyle[] = [
      'camel',
      'pascal',
      'snake',
      'constant',
      'kebab',
      'cobol',
      'train',
      'dot',
      'path',
    ];
    for (const input of ['userAccountId', 'şehirAdıKodu', 'user2Id']) {
      for (const style of styles) {
        expect(convertCase(convertCase(input, style), 'camel')).toBe(input);
      }
    }
  });

  it('CRLF satır sonları korunur', () => {
    expect(convertCase('first_name\r\nlastName\r\n', 'kebab')).toBe('first-name\r\nlast-name\r\n');
    expect(convertCase('a\r\nb', 'upper')).toBe('A\r\nB');
  });

  it('kesme işareti: Title Case’te korunur, tanımlayıcılarda atılır', () => {
    expect(splitWords("Türkiye'nin başkenti 'alıntı'")).toEqual(["Türkiye'nin", 'başkenti', 'alıntı']);
    expect(convertCase("türkiye'nin başkenti", 'title')).toBe("Türkiye'nin Başkenti");
    expect(convertCase('don’t stop', 'sentence', { locale: 'en' })).toBe('Don’t stop');
    expect(convertCase("Türkiye'nin başkenti", 'snake')).toBe('türkiyenin_başkenti');
    expect(convertCase("İzmir'in", 'camel', { ascii: true })).toBe('izmirin');
  });

  it('Türkçe kural ICU ile aynı sonucu verir', () => {
    const text = 'İstanbul ISPARTA ılık iğne İ Straße ǅ';
    expect(convertCase(text, 'lower')).toBe(text.toLocaleLowerCase('tr-TR'));
    expect(convertCase(text, 'upper')).toBe(text.toLocaleUpperCase('tr-TR'));
  });

  it('büyük metin hızlı dönüştürülür', () => {
    // ~1,2 MB; yerel ayarlı toLocale*Case ile kelime başına çağrı burada 15 sn'yi aşıyordu.
    const text = 'müşteriAdı İstanbul ışık XMLHttpRequest\n'.repeat(30_000);
    const start = performance.now();
    for (const style of ['camel', 'title', 'toggle'] as const) convertCase(text, style);
    expect(performance.now() - start).toBeLessThan(5_000);
  }, 30_000);

  it('boş girdi', () => {
    expect(convertCase('', 'camel')).toBe('');
    expect(convertCase('  _-  ', 'snake')).toBe('');
  });
});
