import { describe, expect, it } from 'vitest';
import type { Table } from '../tabular';
import { toXlsx } from '../xlsx';
import { createZip } from '../zip';
import { ToolError } from './errors';
import { readXlsx } from './xlsxRead';

const encoder = new TextEncoder();
const file = (name: string, text: string) => ({ name, data: encoder.encode(text) });
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

describe('readXlsx', () => {
  it('toXlsx ile yazılan tabloları geri okur (gidiş-dönüş)', async () => {
    const tables: Table[] = [
      {
        name: 'Siparişler',
        columns: [
          { key: 'id', type: 'number' },
          { key: 'müşteri', type: 'text' },
          { key: 'tutar', type: 'number' },
          { key: 'aktif', type: 'boolean' },
          { key: 'tarih', type: 'date' },
          { key: 'zaman', type: 'datetime' },
        ],
        rows: [
          [1, '<b>&"Çağrı"</b>', 1250.5, true, '2026-10-22', '2026-10-23T09:30:00+03:00'],
          [2, 'Şule Işık', -3, false, null, null],
        ],
      },
      { name: 'Boş', columns: [{ key: 'x', type: 'text' }], rows: [] },
    ];
    const sheets = await readXlsx(await toXlsx(tables));

    expect(sheets.map((s) => s.name)).toEqual(['Siparişler', 'Boş']);
    const [orders, empty] = sheets;
    expect(orders!.rows[0]).toEqual(['id', 'müşteri', 'tutar', 'aktif', 'tarih', 'zaman']);
    expect(orders!.rows[1]!.slice(0, 4)).toEqual([1, '<b>&"Çağrı"</b>', 1250.5, true]);
    expect(orders!.rows[1]![4]).toMatch(/^2026-10-22/);
    expect(orders!.rows[1]![5]).toMatch(/^2026-10-23[T ]09:30/);
    expect(orders!.rows[2]!.slice(0, 4)).toEqual([2, 'Şule Işık', -3, false]);
    // sondaki boş hücreler ya null ya da hiç yok
    expect(orders!.rows[2]!.slice(4).every((v) => v === null)).toBe(true);
    expect(orders!.rows).toHaveLength(3);
    expect(empty!.rows).toEqual([['x']]);
  });

  it('paylaşılan metinler, boşluklu hücreler ve sıkıştırmasız ZIP', async () => {
    const workbook = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="Veri" sheetId="1" r:id="rId1"/></sheets></workbook>`;
    const rels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
    const shared = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="${NS}" count="3" uniqueCount="3"><si><t>ad</t></si><si><t>İzmir &amp; Muğla</t></si><si><r><t>zengin </t></r><r><rPr><b/></rPr><t>metin</t></r></si></sst>`;
    const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${NS}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>2</v></c></row><row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3"><v>3.25</v></c><c r="C3" t="str"><v>formül</v></c></row></sheetData></worksheet>`;
    const data = await createZip(
      [
        file(
          '[Content_Types].xml',
          '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
        ),
        file('xl/workbook.xml', workbook),
        file('xl/_rels/workbook.xml.rels', rels),
        file('xl/sharedStrings.xml', shared),
        file('xl/worksheets/sheet1.xml', sheet),
      ],
      { compress: false },
    );

    const [veri] = await readXlsx(data);
    expect(veri!.name).toBe('Veri');
    expect(veri!.rows[0]).toEqual(['ad', null, 'zengin metin']);
    // atlanan 2. satır boş (ya da boş hücrelerle) korunur ki satır numaraları kaymasın
    expect(veri!.rows[1]!.every((v) => v === null)).toBe(true);
    expect(veri!.rows[2]).toEqual(['İzmir & Muğla', 3.25, 'formül']);
  });

  it('xlsx olmayan veride ToolError', async () => {
    await expect(readXlsx(encoder.encode('merhaba'))).rejects.toThrow(ToolError);
    const zipWithoutWorkbook = await createZip([file('a.txt', 'x')]);
    await expect(readXlsx(zipWithoutWorkbook)).rejects.toThrow(ToolError);
  });
});
