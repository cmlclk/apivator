import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, X, XCircle } from 'lucide-react';
import { Alert, Button, Input, Spinner } from '@apivator/ui';
import { BCRYPT_MAX_BYTES, parseBcrypt, utf8Encode, type BcryptVersion } from '@apivator/core/tools';
import { CopyButton } from '../../../components/ui/CopyButton';
import { formatNumber, translate, useT } from '../../../i18n';
import { ToolErrorMessage, ToolOptions, TwoPanes } from '../ToolLayout';
import { toolErrorText, toolLabelClass, toolSelectClass } from '../toolUtils';
import { useToolInput } from '../toolsStore';
import { useBcryptWorker } from './useBcryptWorker';

const TOOL_ID = 'bcrypt';
/** Arayüzde sunulan maliyetler; çekirdek 31'e kadar destekler ama 15 üstü dakikalar sürer. */
const COSTS = Array.from({ length: 12 }, (_, i) => i + 4);
/** Bu maliyetin üstünde uyarı gösterilir: her artış süreyi ikiye katlar. */
const COST_WARNING = 12;
const VERSIONS: BcryptVersion[] = ['2b', '2a', '2y'];

const formatMs = (ms: number) =>
  translate('toolsSecurity', 'bcrypt.ms', { ms: formatNumber(Math.round(ms)) });

export default function BcryptTool() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <TwoPanes>
        <GenerateSection />
        <VerifySection />
      </TwoPanes>
    </div>
  );
}

function GenerateSection() {
  const t = useT('toolsSecurity');
  // Parola diske yazılmaz; özet hatırlanabilir.
  const [password, setPassword] = useToolInput(TOOL_ID, 'password', '', { remember: false });
  const [costText, setCostText] = useToolInput(TOOL_ID, 'cost', '10');
  const [version, setVersion] = useToolInput(TOOL_ID, 'version', '2b');
  const [hash, setHash] = useToolInput(TOOL_ID, 'hash');
  const [, setVerifyHash] = useToolInput(TOOL_ID, 'input');
  const [, setVerifyPassword] = useToolInput(TOOL_ID, 'verifyPassword', '', { remember: false });
  const [ms, setMs] = useState<number | null>(null);
  const job = useBcryptWorker();
  const cost = Number(costText);
  const busy = job.status === 'busy';

  // Yeni sonuç gelince özet kaydedilir, süre gösterilir.
  const result = job.result;
  useEffect(() => {
    if (result?.type !== 'hash') return;
    setHash(result.hash);
    setMs(result.ms);
    // setHash her çizimde yeni fonksiyon; yalnızca sonuç değişince çalışmalı.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);
  const error = job.result?.type === 'error' ? job.result.error : null;

  return (
    <Section title={t('bcrypt.generate')}>
      <PasswordField label={t('bcrypt.password')} value={password} onChange={setPassword} />
      <ToolOptions>
        <label className={toolLabelClass}>
          {t('bcrypt.cost')}
          <select
            className={toolSelectClass}
            value={costText}
            onChange={(e) => setCostText(e.target.value)}
            aria-label={t('bcrypt.cost')}
          >
            {COSTS.map((c) => (
              <option key={c} value={c}>
                {t('bcrypt.costOption', { cost: c, rounds: formatNumber(2 ** c) })}
              </option>
            ))}
          </select>
        </label>
        <label className={toolLabelClass}>
          {t('bcrypt.version')}
          <select className={toolSelectClass} value={version} onChange={(e) => setVersion(e.target.value)}>
            {VERSIONS.map((v) => (
              <option key={v} value={v}>
                ${v}$
              </option>
            ))}
          </select>
        </label>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => {
            setMs(null);
            job.run({ op: 'hash', password, cost, version: version as BcryptVersion });
          }}
        >
          {t('bcrypt.generate')}
        </Button>
      </ToolOptions>
      {cost > COST_WARNING && (
        <Alert tone="warning">{t('bcrypt.costWarning', { limit: COST_WARNING })}</Alert>
      )}
      <JobStatus job={job} />
      <ToolErrorMessage error={error} />
      {hash && (
        <div className="flex flex-col gap-2 rounded-md border border-line p-3">
          <div className="flex items-center gap-2">
            <code
              className="min-w-0 flex-1 break-all font-mono text-xs text-fg"
              aria-label={t('bcrypt.hashLabel')}
            >
              {hash}
            </code>
            <CopyButton text={hash} label={t('bcrypt.copyHash')} compact />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-fg-muted">
            {ms !== null && <span>{t('bcrypt.tookMs', { ms: formatMs(ms) })}</span>}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setVerifyHash(hash);
                setVerifyPassword(password);
              }}
            >
              {t('bcrypt.useInVerify')}
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}

function VerifySection() {
  const t = useT('toolsSecurity');
  const [password, setPassword] = useToolInput(TOOL_ID, 'verifyPassword', '', { remember: false });
  const [hash, setHash] = useToolInput(TOOL_ID, 'input');
  /** Sonucun ait olduğu girdiler: girdi değişince eski sonuç gösterilmez. */
  const [checked, setChecked] = useState<{ password: string; hash: string } | null>(null);
  const job = useBcryptWorker();
  const busy = job.status === 'busy';

  const parsed = useMemo(() => {
    if (!hash.trim()) return null;
    try {
      return { parts: parseBcrypt(hash), error: null };
    } catch (e) {
      return { parts: null, error: toolErrorText(e) };
    }
  }, [hash]);
  const parts = parsed?.parts;
  const fresh = checked?.password === password && checked.hash === hash;
  const result = fresh ? job.result : null;

  return (
    <Section title={t('bcrypt.verify')}>
      <PasswordField label={t('bcrypt.verifyPassword')} value={password} onChange={setPassword} />
      <label className="flex flex-col gap-1 text-xs text-fg-muted">
        {t('bcrypt.hashLabel')}
        <Input
          className="h-8 font-mono text-xs"
          value={hash}
          onChange={(e) => setHash(e.target.value)}
          placeholder="$2b$10$…"
          aria-label={t('bcrypt.hashToVerify')}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <ToolErrorMessage error={parsed?.error} />
      {parts && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-line p-3 text-xs">
          <dt className="text-fg-muted">{t('bcrypt.version')}</dt>
          <dd className="font-mono text-fg">${parts.version}$</dd>
          <dt className="text-fg-muted">{t('bcrypt.cost')}</dt>
          <dd className="text-fg">
            {t('bcrypt.costOption', { cost: parts.cost, rounds: formatNumber(2 ** parts.cost) })}
          </dd>
          <dt className="text-fg-muted">{t('bcrypt.salt')}</dt>
          <dd className="break-all font-mono text-fg">{parts.salt}</dd>
          <dt className="text-fg-muted">{t('bcrypt.digest')}</dt>
          <dd className="break-all font-mono text-fg">{parts.digest ?? t('bcrypt.noDigest')}</dd>
        </dl>
      )}
      <ToolOptions>
        <Button
          size="sm"
          disabled={busy || !parts?.digest}
          onClick={() => {
            setChecked({ password, hash });
            job.run({ op: 'verify', password, hash });
          }}
        >
          {t('bcrypt.verify')}
        </Button>
        {parts && parts.cost > COST_WARNING && (
          <span className="text-xs text-fg-muted">{t('bcrypt.highCost')}</span>
        )}
      </ToolOptions>
      <JobStatus job={job} />
      {result?.type === 'error' && <ToolErrorMessage error={result.error} />}
      {result?.type === 'verify' &&
        (result.match ? (
          <Alert tone="success">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" /> {t('bcrypt.match', { ms: formatMs(result.ms) })}
            </span>
          </Alert>
        ) : (
          <Alert tone="error">
            <span className="flex items-center gap-2">
              <XCircle className="h-4 w-4" /> {t('bcrypt.noMatch', { ms: formatMs(result.ms) })}
            </span>
          </Alert>
        ))}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-1 flex-col gap-3 rounded-md border border-line p-3">
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {children}
    </section>
  );
}

/** Gizli parola alanı; 72 bayt sınırı aşılırsa uyarır. */
function PasswordField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT('toolsSecurity');
  const [visible, setVisible] = useState(false);
  const bytes = useMemo(() => utf8Encode(value).length, [value]);
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1 text-xs text-fg-muted">
        {label}
        <Input
          className="h-8 text-xs"
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <div className="flex items-center gap-3 text-[11px] text-fg-muted">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
          {t('bcrypt.show')}
        </label>
        <span>{t('bcrypt.byteCount', { bytes })}</span>
      </div>
      {bytes > BCRYPT_MAX_BYTES && (
        <Alert tone="warning">{t('bcrypt.longPassword', { bytes, max: BCRYPT_MAX_BYTES })}</Alert>
      )}
    </div>
  );
}

function JobStatus({ job }: { job: ReturnType<typeof useBcryptWorker> }) {
  const t = useT('toolsSecurity');
  if (job.status === 'cancelled') {
    return (
      <p className="text-xs text-fg-muted" role="status">
        {t('bcrypt.cancelled')}
      </p>
    );
  }
  if (job.status !== 'busy') return null;
  const percent = job.progress ? Math.floor((job.progress.done / job.progress.total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-sm text-fg-muted" role="status">
      <Spinner className="h-3.5 w-3.5" />
      {t('bcrypt.computing')} {t('bcrypt.percent', { percent: formatNumber(percent) })}
      {job.progress && (
        <span className="text-xs">
          {t('bcrypt.rounds', {
            done: formatNumber(job.progress.done),
            total: formatNumber(job.progress.total),
          })}
        </span>
      )}
      <Button size="sm" variant="secondary" onClick={job.cancel}>
        <X className="h-3.5 w-3.5" /> {t('bcrypt.cancel')}
      </Button>
    </div>
  );
}
