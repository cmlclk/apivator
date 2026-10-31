import type { ReactNode } from 'react';
import { LanguageSelect } from './LanguageSelect';
import { Logo } from './Logo';
import { ServerSetting } from './ServerSetting';
import { useT } from '../i18n';
import { isDesktop } from '../lib/desktop';

const preview = [
  { method: 'GET', path: '/api/orders/{{orderId}}', status: '200', tone: 'text-success' },
  { method: 'POST', path: '/api/payments', status: '201', tone: 'text-success' },
  { method: 'PUT', path: '/api/customers/42', status: '409', tone: 'text-warning' },
  { method: 'DELETE', path: '/api/sessions/current', status: '204', tone: 'text-success' },
];

const methodTone: Record<string, string> = {
  GET: 'text-success',
  POST: 'text-warning',
  PUT: 'text-accent',
  DELETE: 'text-danger',
};

export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  const t = useT('auth');
  return (
    <div className="grid min-h-full lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5">
            <Logo />
            <span className="text-lg font-semibold tracking-tight">Apivator</span>
            <LanguageSelect compact className="ms-auto" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-fg-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {isDesktop() && <ServerSetting />}
        </div>
      </main>

      <aside className="relative hidden overflow-hidden border-s border-line bg-surface lg:flex lg:flex-col lg:justify-center lg:px-16">
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, var(--app-line) 1px, transparent 0)',
            backgroundSize: '22px 22px',
          }}
        />
        <div className="relative max-w-md">
          <p className="text-3xl font-semibold leading-tight tracking-tight">
            {t.rich('layout.headline', {
              br: () => <br />,
              accent: (c) => <span className="text-accent">{c}</span>,
            })}
          </p>
          <p className="mt-3 text-fg-muted">{t('layout.tagline')}</p>
          <ul className="mt-10 overflow-hidden rounded-lg border border-line bg-bg font-mono text-[13px] shadow-sm">
            {preview.map((row) => (
              <li
                key={row.path}
                className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0"
              >
                <span className={`w-14 font-semibold ${methodTone[row.method]}`}>{row.method}</span>
                <span className="flex-1 truncate text-fg-muted">{row.path}</span>
                <span className={`font-semibold ${row.tone}`}>{row.status}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
