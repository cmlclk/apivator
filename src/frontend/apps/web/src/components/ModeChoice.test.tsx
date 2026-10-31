import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { ModeChoice, AppModeSetting } = await import('./ModeChoice');

const reload = vi.fn();
const realLocation = window.location;

beforeEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, reload } });
});

afterEach(() => {
  invoke.mockReset();
  reload.mockReset();
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
});

describe('ModeChoice', () => {
  it('kişisel kullanım seçilince modu kaydeder ve uygulamayı yeniden yükler', async () => {
    invoke.mockResolvedValueOnce(undefined);
    render(<ModeChoice />);

    await userEvent.click(screen.getByRole('button', { name: /Kişisel kullanım/ }));

    expect(invoke).toHaveBeenCalledWith('set_app_mode', { mode: 'local' });
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it('kaydedilemezse hatayı gösterir, yeniden yüklemez', async () => {
    invoke.mockRejectedValueOnce(
      JSON.stringify({ code: 'dataDirFailed', params: { detail: 'erişim engellendi' } }),
    );
    render(<ModeChoice />);

    await userEvent.click(screen.getByRole('button', { name: /Sunucuya bağlan/ }));

    expect(await screen.findByText(/Veri klasörüne yazılamadı: erişim engellendi/)).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('AppModeSetting', () => {
  it('yerel moddayken veri klasörünü ve sunucuya geçişi gösterir', async () => {
    invoke.mockImplementation((command: string) =>
      Promise.resolve(
        command === 'app_mode'
          ? { mode: 'local', dataDir: 'C:\\Users\\a\\AppData\\Roaming\\Apivator' }
          : undefined,
      ),
    );
    render(<AppModeSetting />);

    expect(await screen.findByText(/Şu an: Kişisel kullanım/)).toBeInTheDocument();
    expect(screen.getByText(/Roaming\\Apivator/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sunucuya bağlan' }));

    expect(invoke).toHaveBeenCalledWith('set_app_mode', { mode: 'server' });
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });
});
