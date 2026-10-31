import { describe, expect, it } from 'vitest';
import {
  coerceDeep,
  defaultPath,
  findArrays,
  selectColumns,
  toCsv,
  toTables,
  valueAtPath,
  xmlToValue,
  type XmlElementLike,
} from './tabular';
import { columnName, excelDate, sheetNames, toXlsx } from './xlsx';
import { createZip, crc32 } from './zip';

const orders = {
  data: {
    total: 2,
    items: [
      {
        id: 1,
        müşteri: { ad: 'Çağrı Öztürk', adres: { şehir: 'İzmir' } },
        tutar: 1250.5,
        aktif: true,
        tarih: '2026-10-23T09:30:00+03:00',
        etiketler: ['acil', 'yurtiçi'],
        satırlar: [
          { ürün: 'Kalem', adet: 3 },
          { ürün: 'Defter', adet: 1 },
        ],
      },
      {
        id: 2,
        müşteri: { ad: 'Şule Işık', adres: { şehir: 'Muğla', posta: '04800' } },
        tutar: 99,
        aktif: false,
        tarih: '2026-10-22',
        etiketler: [],
        satırlar: [{ ürün: 'Silgi', adet: 2 }],
      },
    ],
  },
};

describe('tablo çıkarma', () => {
  it('en uzun diziyi önerir ve yolları listeler', () => {
    expect(defaultPath(orders)).toBe('data.items');
    expect(defaultPath([1, 2])).toBe('');
    expect(findArrays(orders).map((a) => a.path)).toEqual([
      'data.items',
      'data.items.0.satırlar',
      'data.items.0.etiketler',
    ]);
    expect(valueAtPath(orders, 'data.items.1.müşteri.ad')).toBe('Şule Işık');
  });

  it('iç içe alanları nokta ile düzleştirir; diziler hücrede JSON olur', () => {
    const [table] = toTables(orders, { path: 'data.items' });
    expect(table!.name).toBe('items');
    expect(table!.columns).toEqual([
      { key: 'id', type: 'number' },
      { key: 'müşteri.ad', type: 'text' },
      { key: 'müşteri.adres.şehir', type: 'text' },
      { key: 'tutar', type: 'number' },
      { key: 'aktif', type: 'boolean' },
      { key: 'tarih', type: 'datetime' },
      { key: 'etiketler', type: 'text' },
      { key: 'satırlar', type: 'text' },
      { key: 'müşteri.adres.posta', type: 'text' },
    ]);
    expect(table!.rows[0]).toEqual([
      1,
      'Çağrı Öztürk',
      'İzmir',
      1250.5,
      true,
      '2026-10-23T09:30:00+03:00',
      '["acil","yurtiçi"]',
      '[{"ürün":"Kalem","adet":3},{"ürün":"Defter","adet":1}]',
      null,
    ]);
    expect(table!.rows[1]![8]).toBe('04800');
  });

  it('ayrı sayfa modunda diziler üst satır numarasıyla ayrı tablolara gider', () => {
    const tables = toTables(orders, { path: 'data.items', arrays: 'sheet' });
    expect(tables.map((t) => t.name)).toEqual(['items', 'etiketler', 'satırlar']);
    expect(tables[0]!.columns.map((c) => c.key)).not.toContain('satırlar');
    expect(tables[1]!.rows).toEqual([
      [1, 'acil'],
      [1, 'yurtiçi'],
    ]);
    expect(tables[2]!.columns.map((c) => c.key)).toEqual(['#satır', 'ürün', 'adet']);
    expect(tables[2]!.rows).toEqual([
      [1, 'Kalem', 3],
      [1, 'Defter', 1],
      [2, 'Silgi', 2],
    ]);
  });

  it('tek nesne tek satır, basit dizi "değer" kolonu olur; büyük kimlikler metin kalır', () => {
    expect(toTables({ a: 1, b: { c: 2 } })[0]!.rows).toEqual([[1, 2]]);
    expect(toTables(['x', 'y'])[0]!).toMatchObject({ columns: [{ key: 'değer' }], rows: [['x'], ['y']] });
    expect(toTables(JSON.parse('[{"id":12345678901234567890}]'))[0]!.rows[0]).toEqual([
      '12345678901234567000',
    ]);
    expect(() => toTables(orders, { path: 'yok.burada' })).toThrow('"yok.burada" yolunda değer yok.');
  });

  it('karışık tipler metin, tarih ile tarih-saat tarih-saat olur', () => {
    const [table] = toTables([{ a: 1, t: '2026-01-01' }, { a: 'x', t: '2026-01-02T10:00:00Z' }, { a: null }]);
    expect(table!.columns).toEqual([
      { key: 'a', type: 'text' },
      { key: 't', type: 'datetime' },
    ]);
  });

  it('kolonları seçip sıralar', () => {
    const [table] = toTables(orders, { path: 'data.items' });
    const picked = selectColumns(table!, ['tutar', 'id']);
    expect(picked.columns.map((c) => c.key)).toEqual(['tutar', 'id']);
    expect(picked.rows).toEqual([
      [1250.5, 1],
      [99, 2],
    ]);
  });

  it('XML ve CSV metinlerinde sayılar çevrilir, baştaki sıfırlar korunur', () => {
    expect(coerceDeep({ a: '42', b: '3.5', c: '007', d: 'true', e: 'x', f: '1234567890123456' })).toEqual({
      a: 42,
      b: 3.5,
      c: '007',
      d: true,
      e: 'x',
      f: '1234567890123456',
    });
  });
});

/** Testler için küçük bir DOM benzeri ağaç. */
function el(
  name: string,
  children: (XmlElementLike | string)[] = [],
  attrs: Record<string, string> = {},
): XmlElementLike {
  const nodes = children.map((c) =>
    typeof c === 'string' ? { nodeType: 3, nodeName: '#text', textContent: c, childNodes: [] } : c,
  );
  return {
    nodeType: 1,
    nodeName: name,
    textContent: nodes.map((n) => n.textContent).join(''),
    attributes: Object.entries(attrs).map(([n, value]) => ({ name: n, value })),
    childNodes: nodes,
  };
}

describe('XML', () => {
  it('tekrarlanan öğeler dizi, öznitelikler @ ile, ad alanı önekleri atılır', () => {
    const doc = el(
      'soap:Envelope',
      [
        el('soap:Body', [
          el('Kisiler', [
            el('Kisi', [el('Ad', ['Ayşe']), el('Yas', ['34'])], { no: '1' }),
            el('Kisi', [el('Ad', ['Mehmet']), el('Yas', ['41'])], { no: '2' }),
          ]),
        ]),
      ],
      { 'xmlns:soap': 'http://schemas.xmlsoap.org/soap/envelope/' },
    );

    const value = coerceDeep(xmlToValue(doc));
    expect(defaultPath(value)).toBe('Body.Kisiler.Kisi');
    expect(toTables(value, { path: 'Body.Kisiler.Kisi' })[0]!.rows).toEqual([
      [1, 'Ayşe', 34],
      [2, 'Mehmet', 41],
    ]);
  });
});

describe('CSV', () => {
  const [table] = toTables([
    { ad: 'Ayşe; Yılmaz', tutar: 1250.5, not: 'tırnak "içinde"', formül: '=HYPERLINK("x")', borç: -5 },
    { ad: 'Ali', tutar: 3, not: 'çok\nsatır', formül: null, borç: 0 },
  ]);

  it('Türkçe Excel için ; ayırıcı, ondalık virgül ve BOM', () => {
    expect(toCsv(table!)).toBe(
      '﻿ad;tutar;not;formül;borç\r\n' +
        '"Ayşe; Yılmaz";1250,5;"tırnak ""içinde""";"\'=HYPERLINK(""x"")";-5\r\n' +
        'Ali;3;"çok\nsatır";;0\r\n',
    );
  });

  it('virgül ayırıcıda ondalık nokta; BOM ve formül kaçışı kapatılabilir', () => {
    const csv = toCsv(table!, { delimiter: ',', bom: false, escapeFormulas: false });
    expect(csv.startsWith('ad,')).toBe(true);
    expect(csv).toContain('Ayşe; Yılmaz,1250.5,');
    expect(csv).toContain(',"=HYPERLINK(""x"")",');
  });
});

/** Testte ZIP'i açmak için: merkez dizini okuyup girdileri çözer. */
async function unzip(bytes: Uint8Array): Promise<Record<string, string>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const dataStart = local + 30 + view.getUint16(local + 26, true);
    const raw = bytes.subarray(dataStart, dataStart + size);
    const data =
      method === 8
        ? new Uint8Array(
            await new Response(
              new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')),
            ).arrayBuffer(),
          )
        : raw;
    expect(crc32(data)).toBe(crc);
    files[name] = new TextDecoder().decode(data);
    at += 46 + nameLength;
  }
  return files;
}

describe('XLSX', () => {
  it('yardımcılar: kolon harfi, Excel tarihi, sayfa adları', () => {
    expect([0, 25, 26, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'ZZ', 'AAA']);
    expect(excelDate('1900-03-01')).toBe(61);
    expect(excelDate('2026-10-23')).toBe(46318);
    expect(excelDate('2026-10-23T12:00:00+03:00')).toBe(46318.5);
    expect(excelDate('dün')).toBeNull();
    expect(sheetNames(['items', 'Items', 'a/b:c', 'x'.repeat(40), ''])).toEqual([
      'items',
      'Items (2)',
      'a_b_c',
      'x'.repeat(31),
      'Sayfa',
    ]);
  });

  it('ZIP girdileri CRC ile doğru; sıkıştırma kapalıyken de açılır', async () => {
    const data = new TextEncoder().encode('Merhaba dünya '.repeat(100));
    for (const compress of [true, false]) {
      const files = await unzip(await createZip([{ name: 'ğüşiöç.txt', data }], { compress }));
      expect(files['ğüşiöç.txt']).toBe('Merhaba dünya '.repeat(100));
    }
  });

  it('başlık sabit, tipler doğru, metinler kaçışlı ve formül yok', async () => {
    const tables = toTables(orders, { path: 'data.items', arrays: 'sheet' });
    tables[0]!.rows[0]![1] = '<b>&"Çağrı"</b>\u0001';
    const files = await unzip(await toXlsx(tables));

    expect(Object.keys(files)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
      'xl/worksheets/sheet3.xml',
    ]);
    expect(files['xl/workbook.xml']).toContain('<sheet name="items" sheetId="1" r:id="rId1"/>');
    expect(files['xl/workbook.xml']).toContain('<sheet name="satırlar" sheetId="3" r:id="rId3"/>');

    const sheet = files['xl/worksheets/sheet1.xml']!;
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('<autoFilter ref="A1:G3"/>');
    expect(sheet).toContain('<c r="A2"><v>1</v></c>');
    expect(sheet).toContain(
      '<c r="B2" t="inlineStr"><is><t xml:space="preserve">&lt;b&gt;&amp;&quot;Çağrı&quot;&lt;/b&gt;</t></is></c>',
    );
    expect(sheet).toContain('<c r="D2"><v>1250.5</v></c>');
    expect(sheet).toContain('<c r="E2" t="b"><v>1</v></c>');
    expect(sheet).toContain('<c r="F2" s="3"><v>46318.39583333333</v></c>');
    expect(sheet).toContain('<c r="F3" s="3"><v>46317</v></c>');
    expect(sheet).not.toContain('<f>');
  });

  it('Excel satır sınırını aşan tabloyu reddeder', async () => {
    const huge = {
      name: 'çok',
      columns: [{ key: 'a', type: 'number' as const }],
      rows: { length: 1_048_576 } as never,
    };
    await expect(toXlsx([huge])).rejects.toThrow('CSV olarak kaydedin');
  });
});

describe('dışa aktarma oturumu', () => {
  it('JSON yanıtı önizler, seçilen kolonlarla Excel ve CSV üretir', async () => {
    const { createTableSession } = await import('./tableExport');
    const session = createTableSession({ kind: 'json', text: JSON.stringify(orders) });
    const analysis = session.analyze({ arrays: 'sheet' });
    expect(analysis.path).toBe('data.items');
    expect(analysis.tables.map((t) => [t.name, t.rowCount])).toEqual([
      ['items', 2],
      ['etiketler', 2],
      ['satırlar', 3],
    ]);

    const xlsx = await session.export({
      path: 'data.items',
      arrays: 'sheet',
      columns: ['tutar', 'id'],
      format: 'xlsx',
    });
    expect(xlsx.extension).toBe('xlsx');
    const files = await unzip(xlsx.data);
    expect(files['xl/worksheets/sheet1.xml']).toContain('<c r="A2"><v>1250.5</v></c><c r="B2"><v>1</v></c>');
    expect(files['xl/worksheets/sheet3.xml']).toBeDefined();

    const csv = await session.export({
      path: 'data.items',
      arrays: 'sheet',
      columns: ['id', 'satırlar'],
      format: 'csv',
    });
    expect(new TextDecoder().decode(csv.data)).toContain('1;"[{""ürün"":""Kalem""');
  });

  it('CSV kaynağı sayıları çevirir; bozuk JSON anlaşılır hata verir', async () => {
    const { createTableSession } = await import('./tableExport');
    const session = createTableSession({ kind: 'csv', text: 'ad;yas;posta\nAyşe;34;04800\n' });
    expect(session.analyze({ arrays: 'json' }).tables[0]!.rows).toEqual([['Ayşe', 34, '04800']]);
    expect(() => createTableSession({ kind: 'json', text: '{"a":' })).toThrow('geçerli bir JSON değil');
  });
});

describe('hazır raporlar', () => {
  it('runner sonuçları iki sayfa, geçmiş tek sayfa', async () => {
    const { runResultTables, historyTable } = await import('./reports');
    const tables = runResultTables([
      {
        iteration: 1,
        requestId: 'r1',
        name: 'Listele',
        method: 'GET',
        url: 'https://api.test/users',
        status: 200,
        timeMs: 120,
        size: 512,
        error: null,
        tests: [
          { name: 'durum 200', status: 'passed', error: null },
          { name: 'liste dolu', status: 'failed', error: 'expected 0 to be above 0' },
        ],
      },
      {
        iteration: 2,
        requestId: 'r1',
        name: 'Listele',
        method: 'GET',
        url: 'x',
        status: null,
        timeMs: 5,
        size: 0,
        error: 'ECONNREFUSED',
        tests: [],
      },
    ]);
    expect(tables.map((t) => t.name)).toEqual(['Sonuçlar', 'Testler']);
    expect(tables[0]!.rows[0]).toEqual([
      1,
      1,
      'Listele',
      'GET',
      'https://api.test/users',
      200,
      120,
      512,
      1,
      1,
      0,
      'liste dolu',
      null,
    ]);
    expect(tables[0]!.rows[1]![12]).toBe('ECONNREFUSED');
    expect(tables[1]!.rows[1]).toEqual([1, 1, 'Listele', 'liste dolu', 'Kaldı', 'expected 0 to be above 0']);

    const history = historyTable([
      {
        id: 'h1',
        requestId: null,
        method: 'POST',
        url: 'https://api.test/orders',
        definition: {} as never,
        status: 201,
        timeMs: 88,
        size: 40,
        executedAt: '2026-10-23T06:30:00Z',
      },
    ]);
    expect(history.columns[0]).toEqual({ key: 'Zaman', type: 'datetime' });
    expect(history.rows[0]!.slice(1)).toEqual(['POST', 'https://api.test/orders', 201, 88, 40]);
  });
});
