import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { useToolsStore } from './toolsStore';
import { runBcryptJob, type BcryptResponse } from './tools/bcryptWorker';
import BcryptTool from './tools/BcryptTool';

vi.mock('../../lib/useWorkspaces', () => ({
  useWorkspaces: () => ({ current: { id: 'w1', role: 'Admin' }, workspaces: [] }),
}));

/** jBCrypt test vektörü ("abc", maliyet 6). */
const KNOWN = '$2a$06$If6bvum7DFjUnE9p2uDeDu0YHzrHM6tf.iqN8.yx.jNN1ILEf7h0i';

describe('runBcryptJob', () => {
  it('üretir; ilerleme ve süre bildirir', () => {
    const progress: BcryptResponse[] = [];
    const response = runBcryptJob({ id: 3, op: 'hash', password: 'p', cost: 4, version: '2a' }, (p) =>
      progress.push(p),
    );
    expect(response).toMatchObject({ id: 3, type: 'hash' });
    expect(response.type === 'hash' && response.hash).toMatch(/^\$2a\$04\$/);
    expect(response.type === 'hash' && response.ms).toBeGreaterThanOrEqual(0);
    expect(progress.at(-1)).toEqual({ id: 3, type: 'progress', done: 16, total: 16 });
  });

  it('doğrular; geçersiz özette hata döner', () => {
    expect(runBcryptJob({ id: 1, op: 'verify', password: 'abc', hash: KNOWN })).toMatchObject({
      type: 'verify',
      match: true,
    });
    expect(runBcryptJob({ id: 2, op: 'verify', password: 'abd', hash: KNOWN })).toMatchObject({
      type: 'verify',
      match: false,
    });
    expect(runBcryptJob({ id: 3, op: 'verify', password: 'a', hash: 'x' }).type).toBe('error');
  });
});

describe('bcrypt aracı (Worker yok: aynı iş parçacığı)', () => {
  beforeEach(() => {
    localStorage.clear();
    useToolsStore.setState({ favorites: [], recent: [], inputs: {}, volatile: {}, rememberInputs: true });
  });

  const persisted = () => localStorage.getItem('apivator-tools') ?? '';

  it('üretir, doğrulamaya aktarır ve eşleşir; parola diske yazılmaz', async () => {
    useToolsStore.getState().setInput('bcrypt', 'cost', '4');
    render(<BcryptTool />, { wrapper: MemoryRouter });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Parola'), 'gizli-parola-123');
    await user.click(screen.getByRole('button', { name: 'Üret' }));
    const hash = await screen.findByLabelText('bcrypt özeti', { selector: 'code' }, { timeout: 5000 });
    expect(hash.textContent).toMatch(/^\$2b\$04\$[./A-Za-z0-9]{53}$/);
    expect(screen.getByText(/ms sürdü/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Doğrulamada kullan' }));
    expect(screen.getByLabelText('Doğrulanacak bcrypt özeti')).toHaveValue(hash.textContent);
    await user.click(screen.getByRole('button', { name: 'Doğrula' }));
    expect(await screen.findByText(/Eşleşiyor/, {}, { timeout: 5000 })).toBeInTheDocument();

    expect(persisted()).toContain(hash.textContent!.slice(7));
    expect(persisted()).not.toContain('gizli-parola-123');
  });

  it('yanlış parolada eşleşmez; özet parçalarını gösterir', async () => {
    useToolsStore.getState().setInput('bcrypt', 'input', KNOWN);
    render(<BcryptTool />, { wrapper: MemoryRouter });
    const user = userEvent.setup();
    expect(screen.getByText('If6bvum7DFjUnE9p2uDeDu')).toBeInTheDocument();
    expect(screen.getByText('$2a$', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText('6 (64 tur)', { selector: 'dd' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Doğrulanacak parola'), 'abd');
    await user.click(screen.getByRole('button', { name: 'Doğrula' }));
    expect(await screen.findByText(/Eşleşmiyor/, {}, { timeout: 5000 })).toBeInTheDocument();

    // Girdi değişince eski sonuç kalkar.
    await user.clear(screen.getByLabelText('Doğrulanacak parola'));
    await user.type(screen.getByLabelText('Doğrulanacak parola'), 'abc');
    expect(screen.queryByText(/Eşleşmiyor/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Doğrula' }));
    expect(await screen.findByText(/Eşleşiyor/, {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('geçersiz özette hata gösterir, Doğrula kapalı', () => {
    useToolsStore.getState().setInput('bcrypt', 'input', '$2x$06$abc');
    render(<BcryptTool />, { wrapper: MemoryRouter });
    expect(screen.getByRole('alert')).toHaveTextContent(/desteklenmiyor/);
    expect(screen.getByRole('button', { name: 'Doğrula' })).toBeDisabled();
  });

  it('72 bayt ve yüksek maliyet uyarıları', () => {
    useToolsStore.getState().setInput('bcrypt', 'password', 'ğ'.repeat(37), false);
    useToolsStore.getState().setInput('bcrypt', 'cost', '13');
    render(<BcryptTool />, { wrapper: MemoryRouter });
    expect(screen.getByText(/74 bayt: bcrypt yalnızca ilk 72 baytı/)).toBeInTheDocument();
    expect(screen.getByText(/Maliyet 12'nin üzerinde/)).toBeInTheDocument();
  });
});
