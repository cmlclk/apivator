import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useToolsStore } from './toolsStore';
import CronTool from './tools/CronTool';

const setField = (name: string, value: string) =>
  useToolsStore.getState().setInput('cron', name, value, true);

function renderTool() {
  render(<CronTool />);
  return userEvent.setup();
}

const runRows = () =>
  within(screen.getByRole('table', { name: 'Sonraki çalıştırmalar' }))
    .getAllByRole('row')
    .slice(1);

beforeEach(() => {
  localStorage.clear();
  useToolsStore.setState({ favorites: [], recent: [], inputs: {}, volatile: {}, rememberInputs: true });
  // Yalnız Date sahte; zamanlayıcılar gerçek kalır (userEvent için).
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-29T05:00:00Z'));
  setField('zone', 'Europe/Istanbul');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Cron aracı', () => {
  it('açıklamayı, alanları ve sonraki çalıştırmaları seçili dilimde gösterir', async () => {
    const user = renderTool();
    const input = screen.getByRole('textbox', { name: 'Cron ifadesi' });
    await user.clear(input);
    await user.type(input, '0 9 * * 1-5');
    expect(screen.getByLabelText('Açıklama')).toHaveTextContent("Hafta içi her gün 09:00'da");

    const fields = within(screen.getByRole('table', { name: 'Alanlar' }));
    expect(fields.getByText('Pazartesi–Cuma')).toBeInTheDocument();

    const rows = runRows();
    expect(rows).toHaveLength(10);
    expect(rows[0]).toHaveTextContent('2026-10-29T09:00:00+03:00');
    expect(rows[1]).toHaveTextContent('2026-10-30T09:00:00+03:00');
    expect(rows[2]).toHaveTextContent('2026-11-02T09:00:00+03:00');
    // Sık değil: monitör uyarısı yok.
    expect(screen.queryByText(/dakikadan sık çalışıyor/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ikisinin de tutması gerekir/)).not.toBeInTheDocument();

    await user.clear(input);
    await user.type(input, '0 0 1 * 1');
    expect(screen.getByText(/ikisinin de tutması gerekir/)).toBeInTheDocument();
  });

  it('hazır ifade, sayı (en fazla 100) ve UTC dilimi', async () => {
    setField('count', '250');
    const user = renderTool();
    await user.click(screen.getByRole('button', { name: '@yearly' }));
    expect(screen.getByLabelText('Açıklama')).toHaveTextContent("Her yıl 1 Ocak 00:00'da");
    expect(screen.getByText('0 0 1 1 *')).toBeInTheDocument();
    expect(runRows()).toHaveLength(100);

    await user.selectOptions(screen.getByRole('combobox'), 'UTC');
    expect(runRows()[0]).toHaveTextContent('2027-01-01T00:00:00+00:00');
  });

  it('5 dakikadan sık ifadede monitör notu gösterir', async () => {
    setField('expr', '*/2 * * * *');
    renderTool();
    expect(screen.getByText(/en kısa aralık 2 dakika/)).toBeInTheDocument();
  });

  it('hatalı ve hiç çalışmayan ifade', async () => {
    setField('expr', '0 0 * * 9');
    const user = renderTool();
    expect(screen.getByRole('alert')).toHaveTextContent('Haftanın günü alanında hata (9. karakter)');

    const input = screen.getByRole('textbox', { name: 'Cron ifadesi' });
    await user.clear(input);
    await user.type(input, '0 0 30 2 *');
    expect(screen.getByText(/hiçbir zaman çalışmıyor/)).toBeInTheDocument();
  });
});
