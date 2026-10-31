import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@tauri-apps/api/app', () => ({ getVersion: () => Promise.resolve('1.0.1') }));

const { AboutDialog } = await import('./AboutDialog');

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.unstubAllGlobals();
});

describe('AboutDialog', () => {
  it('masaüstünde uygulamanın sürümünü ve açıklamayı gösterir', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    render(<AboutDialog onClose={() => undefined} />);

    expect(await screen.findByText('Sürüm 1.0.1')).toBeInTheDocument();
    expect(screen.getByText(/API geliştirme ve test aracı/)).toBeInTheDocument();
  });

  it("web'de sunucunun sürümünü gösterir; okunamazsa sürüm satırı olmaz", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(Response.json({ status: 'Healthy', version: '1.0.0' })),
    );
    const { unmount } = render(<AboutDialog onClose={() => undefined} />);
    expect(await screen.findByText('Sürüm 1.0.0')).toBeInTheDocument();
    unmount();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')));
    render(<AboutDialog onClose={() => undefined} />);
    expect(await screen.findByText(/API geliştirme ve test aracı/)).toBeInTheDocument();
    expect(screen.queryByText(/^Sürüm/)).not.toBeInTheDocument();
  });
});
