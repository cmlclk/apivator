import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { toXlsx } from '@apivator/core';
import { useToolsStore } from './toolsStore';
import SqlInsertTool from './tools/SqlInsertTool';
import { detectDelimiter, resolveDecimal } from './tools/sqlInsertSource';

vi.mock('../../lib/useWorkspaces', () => ({
  useWorkspaces: () => ({ current: { id: 'w1', role: 'Admin' }, workspaces: [] }),
}));

// CodeMirror jsdom'da ölçüm yapamıyor; düz bir metin alanı yeterli.
vi.mock('../requests/CodeEditor', () => ({
  CodeEditor: ({
    value,
    onChange,
    label,
  }: {
    value: string;
    onChange?: (v: string) => void;
    label: string;
  }) => <textarea aria-label={label} value={value} onChange={(e) => onChange?.(e.target.value)} />,
}));

const setField = (name: string, value: string) =>
  useToolsStore.getState().setInput('sql-insert', name, value);
const sqlOutput = () => (screen.getByRole('textbox', { name: 'SQL' }) as HTMLTextAreaElement).value;

function renderTool() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <SqlInsertTool />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  localStorage.clear();
  useToolsStore.setState({ favorites: [], recent: [], inputs: {}, volatile: {}, rememberInputs: true });
});

describe('ayırıcı ve ondalık tahmini', () => {
  it('ilk satırdaki en sık ayırıcıyı seçer; tırnaklı alanlar sayılmaz', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    expect(detectDelimiter('"a,b,c";d')).toBe(';');
    expect(detectDelimiter('﻿tek')).toBe(';');
    expect(detectDelimiter('')).toBe(';');
  });

  it('ondalık: virgül ayırıcıda nokta, diğerlerinde virgül; açık seçim önceliklidir', () => {
    expect(resolveDecimal('auto', ',')).toBe('.');
    expect(resolveDecimal('auto', ';')).toBe(',');
    expect(resolveDecimal('.', ';')).toBe('.');
  });
});

describe('CSV → SQL INSERT', () => {
  it('yapıştırılan CSV INSERT olur; tipler kolon önizlemesinde görünür', () => {
    setField('input', 'ad;yas;tutar;kod\nAli;30;1,5;007\nAyşe;25;2,75;008');
    renderTool();
    expect(sqlOutput()).toBe(
      [
        `INSERT INTO "tablo" ("ad", "yas", "tutar", "kod") VALUES ('Ali', 30, 1.5, '007');`,
        `INSERT INTO "tablo" ("ad", "yas", "tutar", "kod") VALUES ('Ayşe', 25, 2.75, '008');`,
        '',
      ].join('\n'),
    );
    expect(screen.getByText('numeric(3, 2)')).toBeInTheDocument();
    expect(screen.getByText('integer')).toBeInTheDocument();
  });

  it('virgül ayırıcı otomatik tanınır, ondalık nokta olur', () => {
    setField('input', 'ad,tutar\nAli,1.5');
    renderTool();
    expect(sqlOutput()).toContain(`VALUES ('Ali', 1.5);`);
  });

  it('lehçe, tablo adı, çok satır, CREATE TABLE ve işlem bloğu seçenekleri', async () => {
    setField('input', "ad\nO'Brien\nAli");
    setField('table', 'dbo.users');
    setField('dialect', 'sqlserver');
    setField('rows', '2');
    setField('create', '1');
    setField('transaction', '1');
    renderTool();
    expect(sqlOutput()).toBe(
      [
        'CREATE TABLE [dbo].[users] (',
        '  [ad] NVARCHAR(MAX)',
        ');',
        '',
        'BEGIN TRANSACTION;',
        'INSERT INTO [dbo].[users] ([ad]) VALUES',
        "  (N'O''Brien'),",
        "  (N'Ali');",
        'COMMIT;',
        '',
      ].join('\n'),
    );
  });

  it('seçenekler arayüzden değişir', async () => {
    setField('input', 'a;b\n1;');
    const user = renderTool();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Lehçe' }), 'mysql');
    expect(sqlOutput()).toBe('INSERT INTO `tablo` (`a`, `b`) VALUES (1, NULL);\n');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Boş hücre' }), 'empty');
    expect(sqlOutput()).toBe("INSERT INTO `tablo` (`a`, `b`) VALUES (1, '');\n");
    await user.click(screen.getByRole('checkbox', { name: 'İlk satır başlık' }));
    expect(sqlOutput()).toContain('(`column_1`, `column_2`)');
  });

  it('hücredeki SQL enjeksiyonu metin kalır', () => {
    // Ayırıcı içeren hücre tırnaklı olmalı.
    setField('input', `ad\n"'); DROP TABLE x; --"`);
    renderTool();
    expect(sqlOutput()).toBe(`INSERT INTO "tablo" ("ad") VALUES ('''); DROP TABLE x; --');\n`);
  });

  it('hata anlaşılır gösterilir', () => {
    setField('input', 'ad\nx');
    setField('table', 'a..b');
    renderTool();
    expect(screen.getByRole('alert')).toHaveTextContent(/Geçersiz tablo adı/);
    expect(sqlOutput()).toBe('');
  });
});

describe('Excel → SQL INSERT', () => {
  it('xlsx dosyası yüklenir, sayfa sayı/mantıksal tipleriyle yazılır', async () => {
    const bytes = await toXlsx([
      {
        name: 'Siparişler',
        columns: [
          { key: 'ad', type: 'text' },
          { key: 'adet', type: 'number' },
          { key: 'ok', type: 'boolean' },
        ],
        rows: [
          ['Çağrı', 3, true],
          ['Ece', 12, false],
        ],
      },
    ]);
    setField('source', 'excel');
    const user = renderTool();
    const file = new File([bytes as BlobPart], 'siparis.xlsx');
    // jsdom'un File'ında arrayBuffer yok.
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
    await user.upload(screen.getByLabelText('Excel dosyası seç'), file);
    await waitFor(() => expect(sqlOutput()).not.toBe(''), { timeout: 5000 });
    expect(screen.getByText('siparis.xlsx')).toBeInTheDocument();
    expect(sqlOutput()).toBe(
      [
        `INSERT INTO "tablo" ("ad", "adet", "ok") VALUES ('Çağrı', 3, TRUE);`,
        `INSERT INTO "tablo" ("ad", "adet", "ok") VALUES ('Ece', 12, FALSE);`,
        '',
      ].join('\n'),
    );
    // Dosya içeriği hatırlanmaz.
    expect(JSON.stringify(useToolsStore.getState().inputs)).not.toContain('Çağrı');
  });
});
