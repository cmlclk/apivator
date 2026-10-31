import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@apivator/ui';
import { CopyButton } from '../../../components/ui/CopyButton';
import { ToolErrorMessage, ToolOptions } from '../ToolLayout';
import { useToolInput } from '../toolsStore';
import { toolLabelClass } from '../toolUtils';
import { runRegex, type RegexRequest, type RegexResult } from './regexWorker';
import { translate, useT } from '../../../i18n';

const TOOL = 'regex';
const FLAGS = ['g', 'i', 'm', 's', 'u', 'y'] as const;
const MATCH_LIMIT = 1000;
const TIMEOUT_MS = 1500;
const DEBOUNCE_MS = 150;

const inputClass =
  'h-8 w-full rounded-md border border-line bg-surface px-2 font-mono text-[12.5px] text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25';
const textareaClass =
  'w-full resize-y rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-[12.5px] text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25';

type Outcome = RegexResult | { id: number; timeout: true };

/** `/abc/gi` biçiminde yapıştırılan ifadeyi desen ve bayraklara ayırır (`/api/v1/` gibi yollar hariç). */
function splitLiteral(pattern: string, flags: string): { pattern: string; flags: string } {
  const literal = /^\/((?:[^/\\\n]|\\.)+)\/([dgimsuvy]*)$/.exec(pattern);
  return literal ? { pattern: literal[1]!, flags: literal[2]! } : { pattern, flags };
}

/**
 * Eşleştirmeyi Worker'da çalıştırır; süre aşılırsa Worker sonlandırılır ve yenisi açılır.
 * Worker yoksa (test ortamı) aynı iş parçacığında çalışır.
 */
function useRegexRunner(request: Omit<RegexRequest, 'id'> | null): Outcome | null {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  const workerBroken = useRef(false);
  /** Worker en az bir kez yanıt verdiyse yüklenmiştir; sonraki hatalar yükleme hatası sayılmaz. */
  const workerReady = useRef(false);

  useEffect(() => () => worker.current?.terminate(), []);

  const key = request ? JSON.stringify(request) : '';
  useEffect(() => {
    if (!request) {
      setOutcome(null);
      return;
    }
    const id = ++seq.current;
    if (typeof Worker === 'undefined' || workerBroken.current) {
      setOutcome(runRegex({ ...request, id }));
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Worker açılamazsa (CSP, modül worker desteği yok) bundan sonra aynı iş parçacığında çalışılır.
    const fallBack = () => {
      clearTimeout(timer);
      workerBroken.current = true;
      worker.current?.terminate();
      worker.current = null;
      if (id === seq.current) setOutcome(runRegex({ ...request, id }));
    };
    const debounce = setTimeout(() => {
      if (!worker.current) {
        try {
          worker.current = new Worker(new URL('./regexWorker.ts', import.meta.url), { type: 'module' });
        } catch {
          fallBack();
          return;
        }
      }
      const current = worker.current;
      current.onerror = (event) => {
        event.preventDefault();
        if (!workerReady.current) {
          fallBack();
          return;
        }
        clearTimeout(timer);
        current.terminate();
        if (worker.current === current) worker.current = null;
        if (id === seq.current)
          setOutcome({
            id,
            matches: [],
            truncated: false,
            replaced: '',
            error: event.message || translate('toolsData', 'regex.failed'),
          });
      };
      current.onmessage = (event: MessageEvent<RegexResult>) => {
        workerReady.current = true;
        if (event.data.id !== seq.current) return;
        clearTimeout(timer);
        setOutcome(event.data);
      };
      current.postMessage({ ...request, id });
      timer = setTimeout(() => {
        current.terminate();
        if (worker.current === current) worker.current = null;
        if (id === seq.current) setOutcome({ id, timeout: true });
      }, TIMEOUT_MS);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(debounce);
      clearTimeout(timer);
    };
    // İstek içeriği `key` ile karşılaştırılır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return outcome;
}

export default function RegexTool() {
  const t = useT('toolsData');
  const [patternInput, setPattern] = useToolInput(TOOL, 'pattern');
  const [flagsInput, setFlags] = useToolInput(TOOL, 'flags', 'g');
  const [text, setText] = useToolInput(TOOL, 'input');
  const [replacement, setReplacement] = useToolInput(TOOL, 'replacement');
  const { pattern, flags } = splitLiteral(patternInput, flagsInput);

  const outcome = useRegexRunner(pattern ? { pattern, flags, text, replacement, limit: MATCH_LIMIT } : null);
  const result = outcome && !('timeout' in outcome) ? outcome : null;
  const error =
    outcome && 'timeout' in outcome
      ? t('regex.timeout', { seconds: TIMEOUT_MS / 1000 })
      : (result?.error ?? null);
  const matches = result && !result.error ? result.matches : [];

  function toggleFlag(flag: string) {
    // Literal yapıştırılmışsa önce bayraklar alana taşınır.
    if (pattern !== patternInput) setPattern(pattern);
    setFlags(flags.includes(flag) ? flags.replace(flag, '') : flags + flag);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          {t('regex.pattern')}
          <div className="flex items-center gap-1 font-mono text-fg-subtle">
            /
            <input
              className={inputClass}
              value={patternInput}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="(?<yil>\d{4})-(\d{2})"
              spellCheck={false}
              aria-label={t('regex.pattern')}
            />
            /{flags}
          </div>
        </label>
        <ToolOptions>
          <span className={toolLabelClass}>{t('regex.flags')}</span>
          {FLAGS.map((flag) => (
            <button
              key={flag}
              type="button"
              title={t(`regex.flagTitles.${flag}`)}
              aria-pressed={flags.includes(flag)}
              onClick={() => toggleFlag(flag)}
              className={cn(
                'h-7 w-7 rounded-md border font-mono text-xs',
                flags.includes(flag)
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-line text-fg-subtle hover:text-fg',
              )}
            >
              {flag}
            </button>
          ))}
          {result && !result.error && (
            <span className="text-xs text-fg-muted">
              {result.truncated
                ? t('regex.matchCountTruncated', { count: matches.length, limit: MATCH_LIMIT })
                : t('regex.matchCount', { count: matches.length })}
            </span>
          )}
        </ToolOptions>
        <ToolErrorMessage error={error} />
      </div>

      <label className="flex flex-col gap-1 text-xs text-fg-muted">
        {t('regex.testText')}
        <textarea
          className={textareaClass}
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          placeholder={t('regex.testPlaceholder')}
        />
      </label>

      {pattern && text && !error && (
        <section className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold text-fg-muted">{t('regex.matches')}</h3>
          <pre
            className="max-h-64 overflow-auto rounded-md border border-line bg-muted/40 p-2 font-mono text-[12.5px] break-all whitespace-pre-wrap text-fg"
            aria-label={t('regex.highlighted')}
          >
            {highlight(text, matches)}
          </pre>
        </section>
      )}

      {matches.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold text-fg-muted">{t('regex.matchList')}</h3>
          <div className="max-h-72 overflow-auto rounded-md border border-line">
            <table className="w-full border-collapse text-[12.5px]" aria-label={t('regex.matchList')}>
              <thead>
                <tr className="text-start text-[11px] font-medium tracking-wide text-fg-subtle uppercase">
                  <th className="border-b border-line px-2 py-1 font-medium">#</th>
                  <th className="border-b border-line px-2 py-1 font-medium">{t('regex.position')}</th>
                  <th className="border-b border-line px-2 py-1 font-medium">{t('regex.match')}</th>
                  <th className="border-b border-line px-2 py-1 font-medium">{t('regex.groups')}</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {matches.map((m, i) => (
                  <tr key={i} className="align-top">
                    <td className="border-b border-line px-2 py-1 text-fg-subtle">{i + 1}</td>
                    <td className="border-b border-line px-2 py-1 text-fg-subtle">
                      {m.index}–{m.end}
                    </td>
                    <td className="border-b border-line px-2 py-1 break-all text-fg">{m.text || '∅'}</td>
                    <td className="border-b border-line px-2 py-1 break-all">
                      {m.groups.map((g, gi) => (
                        <div key={gi}>
                          <span className="text-fg-subtle">${gi + 1}</span>{' '}
                          {g ?? <em>{t('regex.unmatched')}</em>}
                        </div>
                      ))}
                      {Object.entries(m.named).map(([name, g]) => (
                        <div key={name}>
                          <span className="text-fg-subtle">{`$<${name}>`}</span>{' '}
                          {g ?? <em>{t('regex.unmatched')}</em>}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-1">
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          {t('regex.replacement')}
          <input
            className={inputClass}
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            placeholder="$<yil>/$2"
            spellCheck={false}
          />
        </label>
        {result && !result.error && replacement !== '' && (
          <div className="relative">
            <pre className="max-h-48 overflow-auto rounded-md border border-line p-2 pe-10 font-mono text-[12.5px] break-all whitespace-pre-wrap text-fg">
              {result.replaced}
            </pre>
            <div className="absolute top-1 end-1">
              <CopyButton text={result.replaced} label={t('regex.copyReplaced')} compact />
            </div>
          </div>
        )}
      </section>

      <details className="text-xs text-fg-muted">
        <summary className="cursor-pointer">{t('regex.diffs.summary')}</summary>
        <ul className="mt-1 list-disc space-y-0.5 ps-5">
          <li>
            {t.rich('regex.diffs.named', codeTag, {
              js: '$<ad>',
              net: '${ad}',
              group: "(?'ad'…)",
            })}
          </li>
          <li>{t.rich('regex.diffs.flags', codeTag)}</li>
          <li>{t.rich('regex.diffs.netOnly', codeTag)}</li>
          <li>{t.rich('regex.diffs.unicode', codeTag)}</li>
        </ul>
      </details>
    </div>
  );
}

const codeTag = { code: (c: ReactNode) => <code>{c}</code> };

/** Metni eşleşmeler vurgulanmış parçalara böler; boş eşleşmeler ince bir işaretle gösterilir. */
function highlight(text: string, matches: RegexResult['matches']): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  matches.forEach((m, i) => {
    if (m.index < cursor) return;
    if (m.index > cursor) nodes.push(text.slice(cursor, m.index));
    nodes.push(
      m.end === m.index ? (
        <span
          key={i}
          className="border-s-2 border-accent"
          title={translate('toolsData', 'regex.matchEmptyTitle', { n: i + 1 })}
        />
      ) : (
        <mark
          key={i}
          title={translate('toolsData', 'regex.matchTitle', { n: i + 1 })}
          className={cn('rounded-sm text-fg', i % 2 ? 'bg-warning/30' : 'bg-accent/25')}
        >
          {text.slice(m.index, m.end)}
        </mark>
      ),
    );
    cursor = m.end;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes.map((n, i) => <Fragment key={`f${i}`}>{n}</Fragment>);
}
