import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Alert, Button, Input } from '@apivator/ui';
import {
  PKCE_MAX_LENGTH,
  PKCE_MIN_LENGTH,
  createPkceVerifier,
  hasWebCrypto,
  pkceChallenge,
  pkceVerifierProblem,
  type PkceMethod,
} from '@apivator/core/tools';
import { CopyButton } from '../../../components/ui/CopyButton';
import { useT } from '../../../i18n';
import { ToolErrorMessage, ToolOptions } from '../ToolLayout';
import { toolErrorText, toolLabelClass, toolSelectClass } from '../toolUtils';
import { useToolInput } from '../toolsStore';

function clampLength(value: string): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(PKCE_MAX_LENGTH, Math.max(PKCE_MIN_LENGTH, n)) : 64;
}

function ValueBlock({ label, value }: { label: string; value: string }) {
  const t = useT('toolsSecurity');
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-semibold text-fg-muted">{label}</h4>
        <div className="flex-1" />
        <CopyButton text={value} label={t('pkce.copy', { label })} compact />
      </div>
      <code className="break-all rounded bg-muted px-2 py-1.5 font-mono text-xs text-fg">{value || ' '}</code>
    </div>
  );
}

export default function PkceTool() {
  const t = useT('toolsSecurity');
  const [lengthText, setLengthText] = useToolInput('pkce', 'length', '64');
  const [method, setMethod] = useToolInput('pkce', 'method', 'S256');
  // code_verifier gizlidir: araç hiç diske yazılmaz (toolsStore UNSAVED_TOOLS).
  const [verifier, setVerifier] = useToolInput('pkce', 'input');
  const [challenge, setChallenge] = useState('');
  const [error, setError] = useState<string | null>(null);

  const length = clampLength(lengthText);
  const regenerate = () => setVerifier(createPkceVerifier(length));

  // İlk açılışta bir verifier üretilir.
  useEffect(() => {
    if (!verifier) setVerifier(createPkceVerifier(length));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    const problem = verifier ? pkceVerifierProblem(verifier) : null;
    if (!verifier || problem) {
      setChallenge('');
      setError(problem);
      return;
    }
    pkceChallenge(verifier, method as PkceMethod)
      .then((value) => {
        if (cancelled) return;
        setChallenge(value);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(toolErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [verifier, method]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      {method === 'S256' && !hasWebCrypto() && <Alert tone="warning">{t('pkce.webCrypto')}</Alert>}
      <ToolOptions>
        <label className={toolLabelClass}>
          {t('pkce.length')}
          <Input
            type="number"
            min={PKCE_MIN_LENGTH}
            max={PKCE_MAX_LENGTH}
            className="h-7 w-20 text-xs"
            value={lengthText}
            onChange={(e) => setLengthText(e.target.value)}
            onBlur={() => setLengthText(String(length))}
            aria-label={t('pkce.lengthLabel')}
          />
        </label>
        <label className={toolLabelClass}>
          {t('pkce.method')}
          <select className={toolSelectClass} value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="S256">S256 (SHA-256)</option>
            <option value="plain">plain</option>
          </select>
        </label>
        <Button size="sm" onClick={regenerate}>
          <RefreshCw className="h-3.5 w-3.5" /> {t('pkce.newVerifier')}
        </Button>
      </ToolOptions>
      <section className="flex flex-col gap-3 rounded-md border border-line p-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-fg-muted">
          code_verifier
          <Input
            className="h-8 font-mono text-xs font-normal"
            value={verifier}
            onChange={(e) => setVerifier(e.target.value)}
            aria-label="code_verifier"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <ToolErrorMessage error={error} />
        <ValueBlock label="code_challenge" value={challenge} />
        <ValueBlock label="code_challenge_method" value={method} />
        <p className="text-[11px] text-fg-subtle">
          {t('pkce.note', { min: PKCE_MIN_LENGTH, max: PKCE_MAX_LENGTH })}
        </p>
      </section>
    </div>
  );
}
