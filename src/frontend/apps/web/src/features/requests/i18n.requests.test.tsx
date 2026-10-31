import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { emptyAuth } from '@apivator/core';
import { initI18n, setLanguage } from '../../i18n';
import { AuthEditor } from './AuthEditor';
import { TestResults } from './TestResults';
import { ConsolePanel } from '../console/ConsolePanel';
import { ScriptsEditor } from '../scripts/ScriptsEditor';
import { snippets } from '../scripts/snippets';

afterEach(() => initI18n('tr'));

describe('requests i18n (en)', () => {
  it('renders the auth editor in English', async () => {
    await setLanguage('en');
    const { container } = render(
      <AuthEditor auth={emptyAuth('Bearer')} allowInherit onChange={() => undefined} />,
    );
    expect(screen.getByLabelText('Type')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Inherit from parent' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show' })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/Tür|Göster|Yetkilendirme/);
  });

  it('renders test results and console in English', async () => {
    await setLanguage('en');
    const { container } = render(
      <>
        <TestResults tests={[]} console={[]} />
        <ConsolePanel />
      </>,
    );
    expect(screen.getByText(/This request has no tests/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Console' })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/Konsol|test yok/);
  });

  it('renders the scripts editor and snippet titles in English', async () => {
    await setLanguage('en');
    render(<ScriptsEditor value={{ preRequest: '', postResponse: '' }} onChange={() => undefined} />);
    expect(screen.getByText('Snippets')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Status code is 200' })).toBeInTheDocument();
    expect(snippets.every((s) => !/[ğüşıöçĞÜŞİÖÇ]/.test(s.label))).toBe(true);
  });
  it('inserts snippet code in the active language', async () => {
    const status = snippets[0]!;
    expect(status.code).toContain('Durum kodu 200');
    await setLanguage('en');
    expect(status.code).toContain('Status code is 200');
    expect(snippets.every((s) => !/[ğüşıöçĞÜŞİÖÇ]/.test(s.code))).toBe(true);
  });
});
