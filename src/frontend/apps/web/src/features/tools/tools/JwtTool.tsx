import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, KeyRound, XCircle } from 'lucide-react';
import { Alert, Button, Spinner, cn } from '@apivator/ui';
import {
  JWT_ALGORITHMS,
  decodeJwt,
  hasWebCrypto,
  signJwt,
  verifyJwt,
  type DecodedJwt,
  type JwtVerifyResult,
} from '@apivator/core/tools';
import { CopyButton } from '../../../components/ui/CopyButton';
import { formatDateTime, translate, useT } from '../../../i18n';
import { ToolErrorMessage, ToolPane } from '../ToolLayout';
import { toolErrorText, toolLabelClass, toolSelectClass } from '../toolUtils';
import { useToolInput } from '../toolsStore';

const textareaClass =
  'min-h-20 w-full resize-y rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-xs text-fg ' +
  'placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25';

const TIME_CLAIMS = ['exp', 'nbf', 'iat'] as const;

/** "2 gün 3 saat" gibi en büyük iki birim. */
function formatDuration(ms: number): string {
  let seconds = Math.floor(Math.abs(ms) / 1000);
  const units = [
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
    [1, 'second'],
  ] as const;
  const parts: string[] = [];
  for (const [size, name] of units) {
    const value = Math.floor(seconds / size);
    if (value > 0 && parts.length < 2) {
      parts.push(translate('toolsSecurity', `jwt.units.${name}`, { count: value }));
      seconds -= value * size;
    } else if (parts.length) break;
  }
  return parts.join(' ') || translate('toolsSecurity', 'jwt.units.second', { count: 0 });
}

function relative(date: Date, now: number): string {
  const diff = date.getTime() - now;
  return translate('toolsSecurity', diff >= 0 ? 'jwt.relative.future' : 'jwt.relative.past', {
    duration: formatDuration(diff),
  });
}

/** Saniyede bir yenilenen şimdiki zaman (kalan süre canlı görünsün). */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function defaultPayload(): string {
  const name = translate('toolsSecurity', 'jwt.sign.sampleName');
  const iat = Math.floor(Date.now() / 1000);
  return JSON.stringify({ sub: '1234567890', name, iat, exp: iat + 3600 }, null, 2);
}

export default function JwtTool() {
  const t = useT('toolsSecurity');
  const [input, setInput] = useToolInput('jwt', 'input');
  // Anahtar diske yazılmaz; yalnızca oturum boyunca bellekte kalır.
  const [key, setKey] = useToolInput('jwt', 'verifyKey', '', { remember: false });

  const decoded = useMemo<{ jwt: DecodedJwt | null; error: string | null }>(() => {
    if (!input.trim()) return { jwt: null, error: null };
    try {
      return { jwt: decodeJwt(input), error: null };
    } catch (error) {
      return { jwt: null, error: toolErrorText(error) };
    }
  }, [input]);
  const jwt = decoded.jwt;
  const now = useNow(Boolean(jwt && Object.keys(jwt.times).length));
  const verification = useVerification(jwt ? input : '', key);

  const payloadText = jwt
    ? typeof jwt.payload === 'string'
      ? jwt.payload
      : JSON.stringify(jwt.payload, null, 2)
    : '';
  const expired = jwt?.times.exp ? jwt.times.exp.getTime() <= now : false;
  const notYet = jwt?.times.nbf ? jwt.times.nbf.getTime() > now : false;
  const alg = jwt ? String(jwt.header.alg ?? '—') : '';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <p className="text-xs text-fg-muted">{t('jwt.localOnly')}</p>
      <ToolPane
        label="JWT"
        value={input}
        onChange={setInput}
        placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
        className="h-28 flex-none"
      />
      <ToolErrorMessage error={decoded.error} />
      {jwt && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded border border-line px-2 py-0.5 font-mono">alg: {alg}</span>
            {jwt.header.typ !== undefined && (
              <span className="rounded border border-line px-2 py-0.5 font-mono">
                typ: {String(jwt.header.typ)}
              </span>
            )}
            {expired && (
              <span className="rounded bg-danger/10 px-2 py-0.5 font-semibold text-danger">
                {t('jwt.badges.expired')}
              </span>
            )}
            {notYet && (
              <span className="rounded bg-warning/10 px-2 py-0.5 font-semibold text-warning">
                {t('jwt.badges.notYet')}
              </span>
            )}
            {jwt.times.exp && !expired && !notYet && (
              <span className="rounded bg-success/10 px-2 py-0.5 font-semibold text-success">
                {t('jwt.badges.valid')}
              </span>
            )}
            {alg.toLowerCase() === 'none' && (
              <span className="rounded bg-danger/10 px-2 py-0.5 font-semibold text-danger">
                {t('jwt.badges.unsigned')}
              </span>
            )}
          </div>
          {Object.keys(jwt.times).length > 0 && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-line p-3 text-xs">
              {TIME_CLAIMS.map((claim) => {
                const date = jwt.times[claim];
                if (!date) return null;
                const late = claim === 'exp' && expired;
                return (
                  <div key={claim} className="contents">
                    <dt className="text-fg-muted">{t(`jwt.claims.${claim}`)}</dt>
                    <dd className={cn('text-fg', late && 'font-semibold text-danger')}>
                      {formatDateTime(date, { dateStyle: 'long', timeStyle: 'medium' })}
                      <span className={cn('text-fg-muted', late && 'text-danger')}>
                        {' '}
                        · {relative(date, now)}
                      </span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
          <div className="flex flex-col gap-3 lg:flex-row">
            <ToolPane
              label="Header"
              value={JSON.stringify(jwt.header, null, 2)}
              language="Json"
              output
              className="h-48 flex-none lg:flex-1"
            />
            <ToolPane
              label="Payload"
              value={payloadText}
              language={typeof jwt.payload === 'string' ? 'Text' : 'Json'}
              output
              className="h-48 flex-none lg:flex-1"
            />
          </div>
        </>
      )}
      <section className="flex flex-col gap-2 rounded-md border border-line p-3">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
          <KeyRound className="h-3.5 w-3.5" /> {t('jwt.verify.title')}
        </h3>
        <textarea
          className={textareaClass}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={t('jwt.verify.keyPlaceholder')}
          aria-label={t('jwt.verify.keyLabel')}
          spellCheck={false}
          autoComplete="off"
        />
        <VerificationStatus result={verification} hasKey={Boolean(key)} hasToken={Boolean(jwt)} />
      </section>
      <SignSection onUse={setInput} />
    </div>
  );
}

/** Token ya da anahtar değişince imzayı (kısa bir gecikmeyle) yeniden doğrular. */
function useVerification(token: string, key: string): JwtVerifyResult | 'pending' | null {
  const [result, setResult] = useState<JwtVerifyResult | 'pending' | null>(null);
  useEffect(() => {
    if (!token || !key) {
      setResult(null);
      return;
    }
    let cancelled = false;
    setResult('pending');
    const timer = setTimeout(() => {
      void verifyJwt(token, key).then((next) => {
        if (!cancelled) setResult(next);
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token, key]);
  return result;
}

function VerificationStatus({
  result,
  hasKey,
  hasToken,
}: {
  result: JwtVerifyResult | 'pending' | null;
  hasKey: boolean;
  hasToken: boolean;
}) {
  const t = useT('toolsSecurity');
  if (!hasWebCrypto()) {
    return <Alert tone="warning">{t('jwt.verify.needWebCrypto')}</Alert>;
  }
  if (!hasToken || !hasKey) {
    return <p className="text-xs text-fg-muted">{t('jwt.verify.needInput')}</p>;
  }
  if (result === 'pending' || result === null) return <Spinner className="h-3.5 w-3.5" />;
  return result.valid ? (
    <p className="flex items-center gap-1.5 text-sm font-medium text-success">
      <CheckCircle2 className="h-4 w-4" /> {t('jwt.verify.valid')}
    </p>
  ) : (
    <p className="flex items-center gap-1.5 text-sm font-medium text-danger">
      <XCircle className="h-4 w-4" />{' '}
      {result.reason ? t('jwt.verify.invalidReason', { reason: result.reason }) : t('jwt.verify.invalid')}
    </p>
  );
}

/** Test amaçlı token üretimi. */
function SignSection({ onUse }: { onUse: (token: string) => void }) {
  const t = useT('toolsSecurity');
  const [open, setOpen] = useState(false);
  const [alg, setAlg] = useToolInput('jwt', 'signAlg', 'HS256');
  const [payload, setPayload] = useToolInput('jwt', 'signPayload', '');
  const [extraHeader, setExtraHeader] = useToolInput('jwt', 'signHeader', '');
  const [key, setKey] = useToolInput('jwt', 'signKey', '', { remember: false });
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const payloadValue = payload;
  const isHmac = alg.startsWith('HS');

  // İlk açılışta örnek payload yazılır; kullanıcı silerse boş kalır.
  useEffect(() => {
    if (!payload) setPayload(defaultPayload());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sign = async () => {
    setError(null);
    setToken('');
    setBusy(true);
    try {
      let parsedPayload: unknown;
      let header: Record<string, unknown> = {};
      try {
        parsedPayload = JSON.parse(payloadValue);
      } catch {
        throw new Error(t('jwt.sign.errors.payloadInvalid'));
      }
      if (extraHeader.trim()) {
        try {
          header = JSON.parse(extraHeader) as Record<string, unknown>;
        } catch {
          throw new Error(t('jwt.sign.errors.headerInvalid'));
        }
        if (!header || typeof header !== 'object' || Array.isArray(header)) {
          throw new Error(t('jwt.sign.errors.headerNotObject'));
        }
      }
      setToken(await signJwt({ ...header, alg }, parsedPayload, key));
    } catch (err) {
      setError(toolErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-2 rounded-md border border-line p-3">
      <button
        type="button"
        className="self-start text-xs font-semibold text-fg-muted hover:text-fg"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? '▾' : '▸'} {t('jwt.sign.toggle')}
      </button>
      {open && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className={toolLabelClass}>
              {t('jwt.sign.algorithm')}
              <select className={toolSelectClass} value={alg} onChange={(e) => setAlg(e.target.value)}>
                {JWT_ALGORITHMS.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <Button size="sm" variant="ghost" onClick={() => setPayload(defaultPayload())}>
              {t('jwt.sign.samplePayload')}
            </Button>
          </div>
          <div className="flex flex-col gap-3 lg:flex-row">
            <ToolPane
              label="Payload"
              value={payloadValue}
              onChange={setPayload}
              language="Json"
              className="h-44 flex-none lg:flex-1"
            />
            <ToolPane
              label={t('jwt.sign.extraHeader')}
              value={extraHeader}
              onChange={setExtraHeader}
              language="Json"
              placeholder='{ "kid": "anahtar-1" }'
              className="h-44 flex-none lg:flex-1"
            />
          </div>
          <textarea
            className={textareaClass}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={isHmac ? t('jwt.sign.secretPlaceholder') : t('jwt.sign.privateKeyPlaceholder')}
            aria-label={t('jwt.sign.keyLabel')}
            spellCheck={false}
            autoComplete="off"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void sign()} loading={busy} disabled={!key}>
              {t('jwt.sign.submit')}
            </Button>
            {token && (
              <>
                <CopyButton text={token} label={t('jwt.sign.copyToken')} />
                <Button size="sm" variant="secondary" onClick={() => onUse(token)}>
                  {t('jwt.sign.decodeAbove')}
                </Button>
              </>
            )}
          </div>
          <ToolErrorMessage error={error} />
          {token && (
            <code className="break-all rounded-md bg-muted p-2 font-mono text-xs text-fg">{token}</code>
          )}
        </>
      )}
    </section>
  );
}
