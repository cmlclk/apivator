import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { KeyRound } from 'lucide-react';
import { Button } from '@apivator/ui';
import {
  analyzeSetCookie,
  buildSetCookie,
  describeCookieExpiry,
  guessCookieKind,
  parseCookieHeader,
  parseSetCookieLines,
  type CookieHeaderInfo,
  type SetCookieFields,
  type SetCookieInfo,
} from '@apivator/core/tools';
import { useT, type TFunction } from '../../../i18n';
import { ToolErrorMessage, ToolOptions, ToolPane } from '../ToolLayout';
import { openInTool } from '../openInTool';
import { useToolInput } from '../toolsStore';
import { toolErrorText, toolLabelClass, toolSelectClass } from '../toolUtils';
import { ResultCard, ValueRow, unitInputClass } from './unitToolParts';
import { WarningList } from './netToolParts';

const TOOL = 'cookie';
const yesNo = (t: TFunction<'toolsMisc'>, value: boolean) => (value ? t('cookie.yes') : t('cookie.no'));

type Parsed =
  | { kind: 'set-cookie'; cookies: SetCookieInfo[] }
  | { kind: 'cookie'; header: CookieHeaderInfo }
  | { kind: 'error'; error: string };

function JwtButton({ token }: { token: string | null }) {
  const t = useT('toolsMisc');
  const navigate = useNavigate();
  if (!token) return null;
  return (
    <Button size="sm" variant="secondary" onClick={() => openInTool(navigate, 'jwt', token)}>
      <KeyRound className="h-3.5 w-3.5" /> {t('cookie.openInJwt')}
    </Button>
  );
}

function SetCookieCard({ cookie, now }: { cookie: SetCookieInfo; now: Date }) {
  const t = useT('toolsMisc');
  const expiry = cookie.expiry;
  return (
    <ResultCard title={t('cookie.cookieTitle', { name: cookie.name || t('cookie.unnamed') })}>
      <ValueRow label={t('cookie.name')} value={cookie.name} />
      <ValueRow label={t('cookie.value')} value={cookie.value} extra={<JwtButton token={cookie.jwt} />} />
      {cookie.decodedValue !== null && (
        <ValueRow label={t('cookie.decodedValue')} value={cookie.decodedValue} />
      )}
      <ValueRow
        label={t('cookie.expiry')}
        value={
          expiry.kind === 'date'
            ? `${describeCookieExpiry(expiry, now)} · ${expiry.date.toISOString()} (${expiry.source === 'max-age' ? 'Max-Age' : 'Expires'})`
            : describeCookieExpiry(expiry, now)
        }
      />
      {cookie.expires && <ValueRow label={t('cookie.expiresRaw')} value={cookie.expires} />}
      {cookie.maxAge !== null && (
        <ValueRow label="Max-Age" value={t('cookie.seconds', { n: String(cookie.maxAge) })} />
      )}
      <ValueRow
        label="Domain"
        value={
          cookie.domain ? t('cookie.domainWithSubdomains', { domain: cookie.domain }) : t('cookie.hostOnly')
        }
      />
      <ValueRow label="Path" value={cookie.path ?? t('cookie.pathDefault')} />
      <ValueRow label="Secure" value={yesNo(t, cookie.secure)} />
      <ValueRow label="HttpOnly" value={yesNo(t, cookie.httpOnly)} />
      <ValueRow label="SameSite" value={cookie.sameSite ?? t('cookie.sameSiteDefault')} />
      <ValueRow label="Partitioned" value={yesNo(t, cookie.partitioned)} />
      {cookie.priority && <ValueRow label="Priority" value={cookie.priority} />}
      <ValueRow label={t('cookie.size')} value={t('cookie.sizeBytes', { n: String(cookie.size) })} />
      <div className="p-2">
        <WarningList warnings={cookie.warnings} />
      </div>
    </ResultCard>
  );
}

function CookieHeaderView({ header }: { header: CookieHeaderInfo }) {
  const t = useT('toolsMisc');
  return (
    <ResultCard title={t('cookie.headerTitle', { count: header.cookies.length, size: String(header.size) })}>
      {header.cookies.map((c, i) => (
        <div key={i}>
          <ValueRow
            label={
              c.duplicate
                ? t('cookie.duplicateName', { name: c.name || t('cookie.unnamed') })
                : c.name || t('cookie.unnamed')
            }
            value={c.value}
            extra={<JwtButton token={c.jwt} />}
          />
          {c.decodedValue !== null && <ValueRow label={t('cookie.decodedShort')} value={c.decodedValue} />}
        </div>
      ))}
      {header.warnings.length > 0 && (
        <div className="p-2">
          <WarningList warnings={header.warnings} />
        </div>
      )}
    </ResultCard>
  );
}

function SetCookieBuilder() {
  const t = useT('toolsMisc');
  const [name, setName] = useToolInput(TOOL, 'b.name');
  const [value, setValue] = useToolInput(TOOL, 'b.value');
  const [encode, setEncode] = useToolInput(TOOL, 'b.encode');
  const [maxAge, setMaxAge] = useToolInput(TOOL, 'b.maxAge');
  const [expires, setExpires] = useToolInput(TOOL, 'b.expires');
  const [domain, setDomain] = useToolInput(TOOL, 'b.domain');
  const [path, setPath] = useToolInput(TOOL, 'b.path', '/');
  const [secure, setSecure] = useToolInput(TOOL, 'b.secure', '1');
  const [httpOnly, setHttpOnly] = useToolInput(TOOL, 'b.httpOnly', '1');
  const [sameSite, setSameSite] = useToolInput(TOOL, 'b.sameSite', 'Lax');
  const [partitioned, setPartitioned] = useToolInput(TOOL, 'b.partitioned');
  const [priority, setPriority] = useToolInput(TOOL, 'b.priority');

  const built = useMemo(() => {
    if (!name.trim()) return null;
    try {
      const fields: SetCookieFields = {
        name,
        value,
        encodeValue: encode === '1',
        maxAge: maxAge.trim() ? Number(maxAge) : null,
        expires: expires ? new Date(expires) : null,
        domain,
        path,
        secure: secure === '1',
        httpOnly: httpOnly === '1',
        sameSite: sameSite as SetCookieFields['sameSite'],
        partitioned: partitioned === '1',
        priority: priority as SetCookieFields['priority'],
      };
      const line = buildSetCookie(fields);
      return { line, warnings: analyzeSetCookie(line).warnings, error: null };
    } catch (e) {
      return { line: null, warnings: [], error: toolErrorText(e) };
    }
  }, [name, value, encode, maxAge, expires, domain, path, secure, httpOnly, sameSite, partitioned, priority]);

  const text = (
    label: string,
    val: string,
    set: (v: string) => void,
    props: { placeholder?: string; type?: string } = {},
  ) => (
    <label className={toolLabelClass}>
      {label}
      <input
        className={`${unitInputClass} w-44`}
        value={val}
        onChange={(e) => set(e.target.value)}
        aria-label={t('cookie.buildField', { label })}
        spellCheck={false}
        autoComplete="off"
        {...props}
      />
    </label>
  );
  const check = (label: string, val: string, set: (v: string) => void) => (
    <label className={toolLabelClass}>
      <input type="checkbox" checked={val === '1'} onChange={(e) => set(e.target.checked ? '1' : '')} />
      {label}
    </label>
  );

  return (
    <section className="flex flex-col gap-2 rounded-md border border-line p-3" aria-label={t('cookie.build')}>
      <h3 className="text-xs font-semibold text-fg-muted">{t('cookie.build')}</h3>
      <ToolOptions>
        {text(t('cookie.name'), name, setName, { placeholder: '__Host-sid' })}
        {text(t('cookie.value'), value, setValue)}
        {check(t('cookie.percentEncode'), encode, setEncode)}
        {text(t('cookie.maxAgeSeconds'), maxAge, setMaxAge, { placeholder: '3600' })}
        {text('Expires', expires, setExpires, { type: 'datetime-local' })}
        {text('Domain', domain, setDomain, { placeholder: t('cookie.domainPlaceholder') })}
        {text('Path', path, setPath)}
      </ToolOptions>
      <ToolOptions>
        {check('Secure', secure, setSecure)}
        {check('HttpOnly', httpOnly, setHttpOnly)}
        {check('Partitioned', partitioned, setPartitioned)}
        <label className={toolLabelClass}>
          SameSite
          <select className={toolSelectClass} value={sameSite} onChange={(e) => setSameSite(e.target.value)}>
            <option value="">{t('cookie.none')}</option>
            <option value="Strict">Strict</option>
            <option value="Lax">Lax</option>
            <option value="None">None</option>
          </select>
        </label>
        <label className={toolLabelClass}>
          Priority
          <select className={toolSelectClass} value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">{t('cookie.none')}</option>
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
          </select>
        </label>
      </ToolOptions>
      <ToolErrorMessage error={built?.error} />
      {built?.line && (
        <div className="rounded-md border border-line">
          <ValueRow label={t('cookie.header')} value={`Set-Cookie: ${built.line}`} />
          <ValueRow label={t('cookie.value')} value={built.line} />
        </div>
      )}
      {built && <WarningList warnings={built.warnings.filter((w) => w.level !== 'info')} />}
    </section>
  );
}

export default function CookieTool() {
  const t = useT('toolsMisc');
  // Araç hiç diske yazılmaz (toolsStore UNSAVED_TOOLS): çerez değerleri oturum anahtarı olabilir.
  const [input, setInput] = useToolInput(TOOL, 'input');
  const [mode, setMode] = useToolInput(TOOL, 'mode', 'auto');

  const { parsed, now } = useMemo((): { parsed: Parsed | null; now: Date } => {
    const now = new Date();
    if (!input.trim()) return { parsed: null, now };
    const kind = mode === 'set-cookie' || mode === 'cookie' ? mode : guessCookieKind(input);
    try {
      return {
        parsed:
          kind === 'set-cookie'
            ? { kind, cookies: parseSetCookieLines(input, now) }
            : { kind, header: parseCookieHeader(input) },
        now,
      };
    } catch (e) {
      return { parsed: { kind: 'error', error: toolErrorText(e) }, now };
    }
  }, [input, mode]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <ToolPane
        label={t('cookie.inputLabel')}
        value={input}
        onChange={setInput}
        className="h-40 flex-none"
        placeholder={t('cookie.placeholder')}
        toolbar={
          <select
            className={toolSelectClass}
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            aria-label={t('cookie.kind')}
          >
            <option value="auto">{t('cookie.auto')}</option>
            <option value="set-cookie">{t('cookie.setCookieResponse')}</option>
            <option value="cookie">{t('cookie.cookieRequest')}</option>
          </select>
        }
      />
      {parsed?.kind === 'error' && <ToolErrorMessage error={parsed.error} />}
      {parsed?.kind === 'set-cookie' &&
        parsed.cookies.map((cookie, i) => <SetCookieCard key={i} cookie={cookie} now={now} />)}
      {parsed?.kind === 'cookie' && <CookieHeaderView header={parsed.header} />}
      <SetCookieBuilder />
      <p className="text-[11px] text-fg-subtle">{t('cookie.privacy')}</p>
    </div>
  );
}
