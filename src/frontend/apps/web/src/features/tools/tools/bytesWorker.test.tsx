import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { base64Encode, md5, toHex, utf8Decode, utf8Encode } from '@apivator/core/tools';
import { useToolsStore } from '../toolsStore';
import { base64EncodeBytes, runBytesJob, splitDataUri } from './bytesWorker';
import Base64Tool from './Base64Tool';
import HashTool from './HashTool';

vi.mock('../../../lib/useWorkspaces', () => ({
  useWorkspaces: () => ({ current: { id: 'w1', role: 'Admin' }, workspaces: [] }),
}));

vi.mock('../../requests/CodeEditor', () => ({
  CodeEditor: ({ value, label }: { value: string; label: string }) => (
    <textarea aria-label={label} value={value} readOnly />
  ),
}));

const bytesOf = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff);

describe('base64EncodeBytes', () => {
  it.each([0, 1, 2, 3, 4, 5, 6, 7, 59, 60, 61, 100])('%i bayt çekirdekle aynı çıktıyı verir', (n) => {
    const bytes = bytesOf(n);
    for (const options of [{}, { urlSafe: true }, { lineLength: 76 }, { urlSafe: true, lineLength: 8 }]) {
      // Küçük parça boyu parça sınırlarını da sınar.
      expect(utf8Decode(base64EncodeBytes(bytes, options, 6))).toBe(base64Encode(bytes, options));
    }
  });
});

describe('splitDataUri', () => {
  it('öneki ayırır', () => {
    expect(splitDataUri('data:image/png;base64,QUJD')).toEqual({ body: 'QUJD', mime: 'image/png' });
    expect(splitDataUri('QUJD')).toEqual({ body: 'QUJD', mime: null });
  });
});

describe('runBytesJob', () => {
  it('dosya hash: ilerleme bildirir, MD5 doğru', async () => {
    const progress: number[] = [];
    const { response } = await runBytesJob(
      { id: 7, op: 'hash', file: new Blob(['abc']), hmacKey: null },
      (p) => p.type === 'progress' && progress.push(p.done),
    );
    expect(progress).toEqual([1, 2, 3, 4, 5]);
    expect(response.type === 'hash' && response.rows[0]).toMatchObject({
      algorithm: 'MD5',
      hex: '900150983cd24fb0d6963f7d28e17f72',
    });
  });

  it('kodlanan çıktıyı aktarılabilir tamponla döner', async () => {
    const { response, transfer } = await runBytesJob({
      id: 1,
      op: 'base64-encode',
      file: new Blob(['Merhaba dünya']),
      urlSafe: false,
      lineLength: 0,
    });
    expect(response.type === 'base64-encode' && utf8Decode(response.ascii)).toBe('TWVyaGFiYSBkw7xueWE=');
    expect(transfer).toHaveLength(1);
  });

  it('Base64 dosyasını çözer; geçersizde hata döner', async () => {
    const ok = await runBytesJob({
      id: 2,
      op: 'base64-decode',
      file: new Blob(['data:text/plain;base64,QUJD\n']),
    });
    expect(ok.response).toMatchObject({ type: 'base64-decode', declaredMime: 'text/plain' });
    expect(ok.response.type === 'base64-decode' && utf8Decode(ok.response.bytes)).toBe('ABC');
    const bad = await runBytesJob({ id: 3, op: 'base64-decode', file: new Blob(['Zm9v!']) });
    expect(bad.response.type).toBe('error');
  });
});

describe('Dosya kaynağı (Worker yok: aynı iş parçacığı)', () => {
  beforeEach(() => {
    localStorage.clear();
    useToolsStore.setState({ favorites: [], recent: [], inputs: {}, volatile: {}, rememberInputs: true });
  });

  it('Hash aracı dosyanın MD5 değerini gösterir', async () => {
    useToolsStore.getState().setInput('hash', 'source', 'file');
    render(<HashTool />, { wrapper: MemoryRouter });
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("Hash'i hesaplanacak dosya"), new File(['abc'], 'a.txt'));
    expect(await screen.findByText(toHex(md5(utf8Encode('abc'))), {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('Base64 aracı büyük çıktıyı editöre yazmaz, indirme sunar', async () => {
    useToolsStore.getState().setInput('base64', 'source', 'file');
    render(<Base64Tool />, { wrapper: MemoryRouter });
    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText('Kodlanacak dosya'),
      new File([new Uint8Array(4 * 1024 * 1024)], 'b.bin'),
    );
    expect(
      await screen.findByRole('button', { name: /base64\.txt indir/ }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Base64' })).not.toBeInTheDocument();
  });

  it('Base64 aracı küçük dosyayı editöre yazar', async () => {
    useToolsStore.getState().setInput('base64', 'source', 'file');
    render(<Base64Tool />, { wrapper: MemoryRouter });
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Kodlanacak dosya'), new File(['Merhaba dünya'], 'm.txt'));
    expect(
      await screen.findByDisplayValue('TWVyaGFiYSBkw7xueWE=', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });
});
