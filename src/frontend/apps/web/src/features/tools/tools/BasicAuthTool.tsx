import { useMemo, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button, Input } from '@apivator/ui';
import { basicAuthHeader, decodeBasicAuth } from '@apivator/core/tools';
import { CopyButton } from '../../../components/ui/CopyButton';
import { useT } from '../../../i18n';
import { ToolErrorMessage } from '../ToolLayout';
import { toolErrorText, toolLabelClass } from '../toolUtils';
import { useToolInput } from '../toolsStore';

const sectionClass = 'flex flex-col gap-2 rounded-md border border-line p-3';

function attempt<T>(fn: () => T): { value: T | null; error: string | null } {
  try {
    return { value: fn(), error: null };
  } catch (error) {
    return { value: null, error: toolErrorText(error) };
  }
}

/** Sonuç satırı: değer ve kopyala düğmesi. */
function ResultLine({ label, value, display = value }: { label: string; value: string; display?: string }) {
  const t = useT('toolsSecurity');
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-xs text-fg-muted">{label}</span>
      <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1 font-mono text-xs text-fg">
        {display || ' '}
      </code>
      <CopyButton text={value} label={t('basicAuth.copyLine', { label })} compact />
    </div>
  );
}

export default function BasicAuthTool() {
  const t = useT('toolsSecurity');
  // Araç hiç diske yazılmaz (toolsStore UNSAVED_TOOLS); parola ayrıca yalnızca bellekte.
  const [user, setUser] = useToolInput('basic-auth', 'user', '', { remember: false });
  const [password, setPassword] = useToolInput('basic-auth', 'password', '', { remember: false });
  // Akıllı yapıştırma "Basic …" başlığını buraya yazar.
  const [input, setInput] = useToolInput('basic-auth', 'input');
  const [showPassword, setShowPassword] = useState(false);
  const [showDecoded, setShowDecoded] = useState(false);

  const encoded = useMemo(
    () => (user || password ? attempt(() => basicAuthHeader(user, password)) : null),
    [user, password],
  );
  const decoded = useMemo(() => (input.trim() ? attempt(() => decodeBasicAuth(input)) : null), [input]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <section className={sectionClass} aria-label={t('basicAuth.buildLabel')}>
        <h3 className="text-xs font-semibold text-fg-muted">{t('basicAuth.buildTitle')}</h3>
        <div className="flex flex-wrap items-center gap-3">
          <label className={toolLabelClass}>
            {t('basicAuth.user')}
            <Input
              className="h-7 w-56 text-xs"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              aria-label={t('basicAuth.userName')}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className={toolLabelClass}>
            {t('basicAuth.password')}
            <Input
              className="h-7 w-56 text-xs"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-label={t('basicAuth.password')}
              autoComplete="new-password"
              spellCheck={false}
            />
          </label>
          <Button
            size="icon"
            variant="ghost"
            title={showPassword ? t('basicAuth.hidePassword') : t('basicAuth.showPassword')}
            aria-label={showPassword ? t('basicAuth.hidePassword') : t('basicAuth.showPassword')}
            onClick={() => setShowPassword((s) => !s)}
          >
            {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </Button>
        </div>
        <ToolErrorMessage error={encoded?.error} />
        {encoded?.value && (
          <>
            <ResultLine label={t('basicAuth.header')} value={`Authorization: ${encoded.value}`} />
            <ResultLine label={t('basicAuth.value')} value={encoded.value} />
          </>
        )}
        <p className="text-[11px] text-fg-subtle">{t('basicAuth.note')}</p>
      </section>

      <section className={sectionClass} aria-label={t('basicAuth.decodeLabel')}>
        <h3 className="text-xs font-semibold text-fg-muted">{t('basicAuth.decodeTitle')}</h3>
        <Input
          className="h-8 font-mono text-xs"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          // eslint-disable-next-line apivator/no-literal-jsx-text -- HTTP header örneği
          placeholder="Authorization: Basic dXNlcjpwYXNz"
          aria-label={t('basicAuth.decodeInput')}
          autoComplete="off"
          spellCheck={false}
        />
        <ToolErrorMessage error={decoded?.error} />
        {decoded?.value && (
          <>
            <ResultLine label={t('basicAuth.user')} value={decoded.value.user} />
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <ResultLine
                  label={t('basicAuth.password')}
                  value={decoded.value.password}
                  display={showDecoded ? decoded.value.password : '•'.repeat(decoded.value.password.length)}
                />
              </div>
              <Button size="sm" variant="secondary" onClick={() => setShowDecoded((s) => !s)}>
                {showDecoded ? t('basicAuth.hide') : t('basicAuth.show')}
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
