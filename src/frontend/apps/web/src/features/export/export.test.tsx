import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ExecuteResponse, RunResultEntry } from '@apivator/core';
import { TableExportDialog } from './TableExportDialog';
import { ExportTablesMenu } from './ExportTablesMenu';
import { tableSource, tableSourceKind } from './sourceKind';
import { ResponsePanel } from '../requests/ResponsePanel';
import { runResultTables } from '@apivator/core';

const saveFile = vi.hoisted(() => vi.fn());
vi.mock('../../lib/download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/download')>()),
  saveFile,
}));

function response(body: string, contentType: string, extra: Partial<ExecuteResponse> = {}): ExecuteResponse {
  return {
    status: 200,
    statusText: 'OK',
    headers: [{ key: 'Content-Type', value: contentType }],
    body,
    bodyEncoding: 'utf8',
    size: body.length,
    timeMs: 12,
    truncated: false,
    error: null,
    ...extra,
  } as ExecuteResponse;
}

const orders = JSON.stringify({
  data: {
    items: [
      { id: 1, müşteri: { ad: 'Çağrı', şehir: 'İzmir' }, tutar: 1250.5, satırlar: [{ ürün: 'Kalem' }] },
      { id: 2, müşteri: { ad: 'Şule', şehir: 'Muğla' }, tutar: 99, satırlar: [] },
    ],
  },
});

/** jsdom'daki Blob'da arrayBuffer() yok; FileReader ile okunur. */
function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

async function blobText(blob: Blob): Promise<string> {
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(await blobBytes(blob));
}

beforeEach(() => {
  saveFile.mockReset();
  saveFile.mockResolvedValue(true);
});

describe('kaynak türü', () => {
  it('JSON, XML ve CSV tanınır; HTML ve ikili yanıt tanınmaz', () => {
    expect(tableSourceKind(response('{"a":1}', 'application/json'), 'application/json')).toBe('json');
    expect(tableSourceKind(response('[1]', 'text/plain'), 'text/plain')).toBe('json');
    expect(tableSourceKind(response('<a><b>1</b></a>', 'application/xml'), 'application/xml')).toBe('xml');
    expect(tableSourceKind(response('a;b\n1;2', 'text/csv'), 'text/csv')).toBe('csv');
    expect(tableSourceKind(response('<html></html>', 'text/html'), 'text/html')).toBeNull();
    expect(
      tableSourceKind(response('AAAA', 'image/png', { bodyEncoding: 'base64' }), 'image/png'),
    ).toBeNull();
  });

  it('XML burada çözülür; bozuk XML anlaşılır hata verir', () => {
    const source = tableSource(
      'xml',
      '<liste><kisi no="1"><ad>Ayşe</ad></kisi><kisi no="2"><ad>Ali</ad></kisi></liste>',
    );
    expect(source).toEqual({
      kind: 'value',
      value: {
        kisi: [
          { '@no': 1, ad: 'Ayşe' },
          { '@no': 2, ad: 'Ali' },
        ],
      },
    });
    expect(() => tableSource('xml', '<a><b></a>')).toThrow('geçerli bir XML değil');
  });
});

describe('tablo olarak kaydet penceresi', () => {
  it('en uzun diziyi seçer, kolonları gösterir; seçilen kolonlar ve sırayla CSV kaydeder', async () => {
    const onClose = vi.fn();
    render(
      <TableExportDialog source={{ kind: 'json', text: orders }} baseName="Siparişler" onClose={onClose} />,
    );
    const user = userEvent.setup();

    const table = await screen.findByRole('table', { name: 'Tablo önizlemesi' });
    expect(screen.getByLabelText('Satır olacak dizi')).toHaveValue('data.items');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['id', 'müşteri.ad', 'müşteri.şehir', 'tutar', 'satırlar']);
    expect(within(table).getByText('1250.5')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'müşteri.şehir' }));
    await user.click(screen.getByRole('checkbox', { name: 'satırlar' }));
    await user.click(screen.getByRole('button', { name: 'tutar yukarı' }));
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['id', 'müşteri.ad', 'tutar']);

    await user.click(screen.getByRole('radio', { name: 'CSV' }));
    expect(screen.getByLabelText('İç içe diziler')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'CSV olarak kaydet' }));

    await waitFor(() => expect(saveFile).toHaveBeenCalledOnce());
    const file = saveFile.mock.calls[0]![0] as { blob: Blob; fileName: string };
    expect(file.fileName).toBe('Siparişler.csv');
    expect(await blobText(file.blob)).toBe('﻿id;müşteri.ad;tutar\r\n1;Çağrı;1250,5\r\n2;Şule;99\r\n');
    expect(onClose).toHaveBeenCalled();
  });

  it('ayrı sayfa modunda ek sayfaları bildirir ve Excel kaydeder', async () => {
    render(<TableExportDialog source={{ kind: 'json', text: orders }} baseName="a/b" onClose={vi.fn()} />);
    const user = userEvent.setup();

    await screen.findByRole('table', { name: 'Tablo önizlemesi' });
    await user.selectOptions(screen.getByLabelText('İç içe diziler'), 'sheet');
    expect(await screen.findByText(/Ek sayfalar: satırlar \(1 satır\)/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Excel olarak kaydet' }));

    await waitFor(() => expect(saveFile).toHaveBeenCalledOnce());
    const file = saveFile.mock.calls[0]![0] as { blob: Blob; fileName: string };
    expect(file.fileName).toBe('a_b.xlsx');
    const bytes = await blobBytes(file.blob);
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]); // "PK"
  });

  it('JSON değilse hatayı gösterir', async () => {
    render(
      <TableExportDialog source={{ kind: 'json', text: '{"kırpık":' }} baseName="x" onClose={vi.fn()} />,
    );
    expect(await screen.findByText(/geçerli bir JSON değil/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Excel olarak kaydet' })).toBeDisabled();
  });
});

describe('yanıt paneli', () => {
  it('JSON yanıtında "Tablo olarak kaydet" açılır, HTML yanıtında yoktur', async () => {
    const { unmount } = render(
      <ResponsePanel response={response('<p>x</p>', 'text/html')} sending={false} name="Sayfa" />,
    );
    expect(screen.queryByRole('button', { name: /Tablo olarak kaydet/ })).not.toBeInTheDocument();
    unmount();

    render(
      <ResponsePanel response={response(orders, 'application/json')} sending={false} name="Siparişler" />,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: /Tablo olarak kaydet/ }));
    expect(await screen.findByRole('dialog', { name: 'Tablo olarak kaydet' })).toBeInTheDocument();
  });
});

describe('hazır tablolar', () => {
  it('runner sonuçlarını Excel olarak indirir', async () => {
    const results: RunResultEntry[] = [
      {
        iteration: 1,
        requestId: 'r1',
        name: 'Listele',
        method: 'GET',
        url: 'https://api.test',
        status: 200,
        timeMs: 10,
        size: 1,
        error: null,
        tests: [],
      },
    ];
    render(<ExportTablesMenu tables={() => runResultTables(results)} baseName="Runner 2026-10-23" />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Dışa aktar/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Excel (.xlsx)' }));

    await waitFor(() => expect(saveFile).toHaveBeenCalledOnce());
    expect((saveFile.mock.calls[0]![0] as { fileName: string }).fileName).toBe('Runner 2026-10-23.xlsx');
  });
});

describe('kolon seçimi', () => {
  it('dizi modu değişince seçim ve sıra korunur', async () => {
    render(<TableExportDialog source={{ kind: 'json', text: orders }} baseName="x" onClose={vi.fn()} />);
    const user = userEvent.setup();
    const table = await screen.findByRole('table', { name: 'Tablo önizlemesi' });

    await user.click(screen.getByRole('checkbox', { name: 'müşteri.şehir' }));
    await user.click(screen.getByRole('button', { name: 'tutar yukarı' }));
    await user.selectOptions(screen.getByLabelText('İç içe diziler'), 'sheet');
    await screen.findByText(/Ek sayfalar/);

    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['id', 'müşteri.ad', 'tutar']);
    expect(screen.getByRole('checkbox', { name: 'müşteri.şehir' })).not.toBeChecked();
  });
});
