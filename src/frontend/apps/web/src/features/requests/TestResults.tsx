import { useState } from 'react';
import { CheckCircle2, CircleSlash, XCircle } from 'lucide-react';
import type { ConsoleEntry, TestResult } from '@apivator/core';
import { Alert, cn } from '@apivator/ui';
import { useT } from '../../i18n';

type Filter = 'all' | 'passed' | 'failed' | 'skipped';

const FILTERS: Filter[] = ['all', 'passed', 'failed', 'skipped'];

/** Post-response script'lerindeki pm.test sonuçları ve script hataları. */
export function TestResults({ tests, console }: { tests: TestResult[]; console: ConsoleEntry[] }) {
  const t = useT('requests');
  const [filter, setFilter] = useState<Filter>('all');
  const errors = console.filter((c) => c.level === 'error' && /satır|Script|script/.test(c.message));
  const count = (status: TestResult['status']) => tests.filter((x) => x.status === status).length;
  const shown = filter === 'all' ? tests : tests.filter((x) => x.status === filter);

  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
      {errors.map((e, i) => (
        <Alert key={i} tone="error" className="mb-2 font-mono text-xs whitespace-pre-wrap">
          {e.message}
        </Alert>
      ))}
      {tests.length === 0 ? (
        <p className="p-6 text-center text-sm text-fg-subtle">
          {t.rich('tests.empty', { code: (c) => <code className="font-mono">{c}</code> })}
        </p>
      ) : (
        <>
          <div
            className="mb-2 flex flex-wrap items-center gap-1"
            role="radiogroup"
            aria-label={t('tests.filter')}
          >
            {FILTERS.map((key) => {
              const n = key === 'all' ? tests.length : count(key);
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={filter === key}
                  onClick={() => setFilter(key)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium',
                    filter === key ? 'bg-muted text-fg' : 'text-fg-subtle hover:text-fg',
                  )}
                >
                  {t('tests.filterItem', { label: t(`tests.${key}`), count: n })}
                </button>
              );
            })}
          </div>
          <ul className="divide-y divide-line rounded-md border border-line" aria-label={t('tests.results')}>
            {shown.map((r, i) => (
              <li key={`${r.name}-${i}`} className="flex items-start gap-2.5 px-3 py-2 text-[13px]">
                {r.status === 'passed' ? (
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0 text-success"
                    aria-label={t('tests.passedIcon')}
                  />
                ) : r.status === 'failed' ? (
                  <XCircle
                    className="mt-0.5 h-4 w-4 shrink-0 text-danger"
                    aria-label={t('tests.failedIcon')}
                  />
                ) : (
                  <CircleSlash
                    className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle"
                    aria-label={t('tests.skippedIcon')}
                  />
                )}
                <div className="min-w-0">
                  <p className={cn(r.status === 'skipped' && 'text-fg-subtle')}>{r.name}</p>
                  {r.error && <p className="mt-0.5 font-mono text-xs break-words text-danger">{r.error}</p>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
