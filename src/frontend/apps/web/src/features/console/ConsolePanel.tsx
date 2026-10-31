import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Terminal, Trash2, X } from 'lucide-react';
import { formatBytes, formatDuration, type ConsoleEntry } from '@apivator/core';
import { cn } from '@apivator/ui';
import { formatTime, useT } from '../../i18n';
import { methodColor } from '../requests/methodColors';
import { useConsole, type ConsoleRecord } from './consoleStore';

const levelStyle: Record<ConsoleEntry['level'], string> = {
  log: 'text-fg',
  debug: 'text-fg-subtle',
  info: 'text-accent',
  warn: 'text-warning',
  error: 'text-danger',
};

function time(ms: number) {
  return formatTime(ms);
}

function statusClass(record: ConsoleRecord) {
  if (record.error || record.status === null) return 'text-danger';
  if (record.status >= 400) return 'text-danger';
  if (record.status >= 300) return 'text-warning';
  return 'text-success';
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-0.5 text-[10.5px] font-semibold tracking-wide text-fg-subtle uppercase">{title}</p>
      {children}
    </div>
  );
}

function HeaderList({ headers }: { headers: { key: string; value: string }[] }) {
  if (!headers.length) return <p className="text-fg-subtle">—</p>;
  return (
    <div className="space-y-0.5">
      {headers.map((h, i) => (
        <p key={`${h.key}-${i}`} className="break-all">
          <span className="text-fg-muted">{h.key}:</span> {h.value}
        </p>
      ))}
    </div>
  );
}

function ConsoleRow({ record }: { record: ConsoleRecord }) {
  const t = useT('console');
  const [open, setOpen] = useState(false);
  const before = record.logs.filter((l) => l.phase === 'prerequest');
  const after = record.logs.filter((l) => l.phase === 'test');
  const logLine = (l: ConsoleEntry, i: number) => (
    <p key={i} className={cn('py-0.5 ps-6 break-all whitespace-pre-wrap', levelStyle[l.level])}>
      {l.message}
    </p>
  );

  return (
    <div className="border-b border-line/60">
      {before.map(logLine)}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 py-1 text-start hover:bg-muted"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <span className={cn('w-12 shrink-0 font-semibold', methodColor(record.method))}>{record.method}</span>
        <span className="min-w-0 flex-1 truncate">{record.url}</span>
        <span className={cn('shrink-0', statusClass(record))}>
          {record.error ? record.error.code : `${record.status} ${record.statusText ?? ''}`}
        </span>
        <span className="w-16 shrink-0 text-end text-fg-subtle">{formatDuration(record.timeMs)}</span>
        <span className="w-16 shrink-0 text-end text-fg-subtle">{time(record.time)}</span>
      </button>
      {open && (
        <div className="mb-2 ms-5 grid gap-3 rounded border border-line bg-surface p-2 md:grid-cols-2">
          <div className="space-y-2">
            <Section title={t('requestHeaders')}>
              <HeaderList headers={record.request?.headers ?? []} />
            </Section>
            {record.request?.body && (
              <Section title={t('requestBody')}>
                <pre className="max-h-48 overflow-auto break-all whitespace-pre-wrap">
                  {record.request.body}
                </pre>
              </Section>
            )}
          </div>
          <div className="space-y-2">
            {record.error ? (
              <Section title={t('error')}>
                <p className="text-danger">{record.error.message}</p>
              </Section>
            ) : (
              <>
                <Section title={t('responseHeaders', { size: formatBytes(record.size) })}>
                  <HeaderList headers={record.responseHeaders} />
                </Section>
                <Section title={t('responseBody')}>
                  <pre className="max-h-48 overflow-auto break-all whitespace-pre-wrap">
                    {record.responseBody || '—'}
                  </pre>
                </Section>
              </>
            )}
            {record.tests.length > 0 && (
              <Section title={t('tests')}>
                {record.tests.map((t, i) => (
                  <p
                    key={i}
                    className={
                      t.status === 'failed'
                        ? 'text-danger'
                        : t.status === 'passed'
                          ? 'text-success'
                          : 'text-fg-subtle'
                    }
                  >
                    {t.status === 'passed' ? '✓' : t.status === 'failed' ? '✗' : '–'} {t.name}
                    {t.error ? ` — ${t.error}` : ''}
                  </p>
                ))}
              </Section>
            )}
          </div>
        </div>
      )}
      {after.map(logLine)}
    </div>
  );
}

/** Ekranın altındaki konsol: her gönderim, hedefe giden ham istek ve script çıktılarıyla. */
export function ConsolePanel() {
  const t = useT('console');
  const { records, open, setOpen, clear } = useConsole();
  const end = useRef<HTMLDivElement>(null);
  const errors = records.reduce((n, r) => n + r.logs.filter((l) => l.level === 'error').length, 0);

  useEffect(() => {
    if (open) end.current?.scrollIntoView({ block: 'end' });
  }, [open, records.length]);

  return (
    <section aria-label={t('title')} className="shrink-0 border-t border-line bg-surface">
      <div className="flex h-7 items-center justify-between px-3 text-xs">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex items-center gap-1.5 text-fg-muted hover:text-fg"
        >
          <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
          {t('title')}
          {records.length > 0 && <span className="text-fg-subtle">({records.length})</span>}
          {errors > 0 && (
            <span className="rounded bg-danger/10 px-1 text-danger">
              {t('errorCount', { count: errors })}
            </span>
          )}
        </button>
        {open && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={clear}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-fg-subtle hover:bg-muted hover:text-fg"
            >
              <Trash2 className="h-3 w-3" /> {t('clear')}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('close')}
              className="rounded p-0.5 text-fg-subtle hover:bg-muted hover:text-fg"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
      {open && (
        <div className="h-60 overflow-y-auto border-t border-line px-3 py-1 font-mono text-[12px]">
          {records.length === 0 ? (
            <p className="py-6 text-center font-sans text-fg-subtle">
              {t.rich('empty', { code: (c) => <code>{c}</code> })}
            </p>
          ) : (
            records.map((r) => <ConsoleRow key={r.id} record={r} />)
          )}
          <div ref={end} />
        </div>
      )}
    </section>
  );
}
