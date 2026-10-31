import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { FilePlus2, RotateCcw } from 'lucide-react';
import { Alert, Button } from '@apivator/ui';
import { emptyDefinition } from '@apivator/core';
import { buildUrl, describeUrl, parseUrl, type UrlParts } from '@apivator/core/tools';
import { useT, type TFunction } from '../../../i18n';
import { useWorkspaces } from '../../../lib/useWorkspaces';
import { OutputActions } from '../OutputActions';
import { ToolErrorMessage, ToolOptions } from '../ToolLayout';
import { openRequestTab } from '../requestTab';
import { toolErrorText, toolLabelClass } from '../toolUtils';
import { useToolInput } from '../toolsStore';
import { ResultCard, ValueRow, unitInputClass } from './unitToolParts';
import { UrlParamTable } from './urlParamTable';

const TOOL = 'url-parser';

function tryParse(text: string) {
  if (!text.trim()) return { parsed: null, error: null };
  try {
    return { parsed: parseUrl(text), error: null };
  } catch (error) {
    return { parsed: null, error: toolErrorText(error) };
  }
}

/** Düzenlenen parçalar, ayrıştırıldıkları adresle birlikte saklanır; adres değişince sıfırlanır. */
function readEdited(saved: string, source: string): UrlParts | null {
  if (!saved) return null;
  try {
    const value = JSON.parse(saved) as { source?: string; parts?: UrlParts };
    return value.source === source && value.parts ? value.parts : null;
  } catch {
    return null;
  }
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  className = 'sm:col-span-1',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 text-xs text-fg-muted ${className}`}>
      {label}
      <input
        className={unitInputClass}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/** URL'yi parçalara ayırır; parçalar ve parametreler düzenlendikçe adres doğru kodlamayla yeniden kurulur. */
export default function UrlParserTool() {
  const t = useT('toolsMisc');
  const navigate = useNavigate();
  const { current } = useWorkspaces();
  const [input, setInput] = useToolInput(TOOL, 'input');
  const [saved, setSaved] = useToolInput(TOOL, 'parts');
  const [ascii, setAscii] = useToolInput(TOOL, 'asciiHost', 'false');

  const { parsed, error } = useMemo(() => tryParse(input), [input]);
  const edited = useMemo(() => readEdited(saved, input), [saved, input]);
  const parts = edited ?? parsed?.parts ?? null;

  const result = useMemo(() => {
    if (!parts) return { url: '', details: null, error: null };
    try {
      return {
        url: buildUrl(parts, { asciiHost: ascii === 'true' }),
        details: describeUrl(parts),
        error: null,
      };
    } catch (e) {
      return { url: '', details: null, error: toolErrorText(e) };
    }
  }, [parts, ascii]);

  const update = (patch: Partial<UrlParts>) => {
    if (parts) setSaved(JSON.stringify({ source: input, parts: { ...parts, ...patch } }));
  };

  const hasAuthority = parts && ['absolute', 'network', 'host'].includes(parts.kind);
  const details = result.details;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <label className="flex flex-col gap-1 text-xs text-fg-muted">
        {t('urlParser.address')}
        <input
          className={unitInputClass}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('urlParser.placeholder')}
          spellCheck={false}
          aria-label={t('urlParser.address')}
        />
      </label>
      <ToolOptions>
        <label className={toolLabelClass}>
          <input
            type="checkbox"
            checked={ascii === 'true'}
            onChange={(e) => setAscii(String(e.target.checked))}
            className="h-3.5 w-3.5 accent-[var(--app-accent)]"
          />
          {t('urlParser.punycode')}
        </label>
        <Button
          size="sm"
          variant="secondary"
          disabled={!edited}
          title={t('urlParser.resetHint')}
          onClick={() => setSaved('')}
        >
          <RotateCcw className="h-3.5 w-3.5" /> {t('urlParser.reset')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!current || !result.url}
          title={t('urlParser.openHint')}
          onClick={() => openRequestTab(navigate, current!.id, { ...emptyDefinition(), url: result.url })}
        >
          <FilePlus2 className="h-3.5 w-3.5" /> {t('urlParser.openInRequest')}
        </Button>
      </ToolOptions>
      <ToolErrorMessage error={error ?? result.error} />
      {parsed && parsed.warnings.length > 0 && (
        <Alert tone="warning">
          <ul className="list-disc ps-5 text-xs">
            {parsed.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}
      {parts && (
        <>
          <ResultCard title={t('urlParser.rebuilt')}>
            <ValueRow
              label={t(`urlParser.kinds.${parts.kind}`)}
              value={result.url}
              extra={result.url ? <OutputActions text={result.url} /> : undefined}
            />
          </ResultCard>
          <section className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            {(parts.kind === 'absolute' || parts.kind === 'opaque') && (
              <Field
                label={t('urlParser.scheme')}
                value={parts.scheme}
                onChange={(scheme) => update({ scheme })}
              />
            )}
            {parts.kind === 'variable' && (
              <Field
                label={t('urlParser.base')}
                value={parts.base}
                onChange={(base) => update({ base })}
                className="sm:col-span-2"
              />
            )}
            {hasAuthority && (
              <>
                <Field
                  label={t('urlParser.username')}
                  value={parts.username}
                  onChange={(username) => update({ username })}
                />
                <Field
                  label={t('urlParser.password')}
                  value={parts.password}
                  onChange={(password) => update({ password })}
                />
                <Field label="Host" value={parts.host} onChange={(host) => update({ host })} />
                <Field
                  label="Port"
                  value={parts.port}
                  onChange={(port) => update({ port })}
                  placeholder={t('urlParser.portDefault')}
                />
              </>
            )}
            <Field
              label={t('urlParser.path')}
              value={parts.path}
              onChange={(path) => update({ path })}
              className="sm:col-span-3"
            />
            <Field
              label={t('urlParser.fragment')}
              value={parts.fragment ?? ''}
              onChange={(fragment) => update({ fragment: fragment || null })}
            />
          </section>
          {details && (
            <ResultCard title={t('urlParser.details')}>
              {hasAuthority && (
                <>
                  <ValueRow
                    label={t('urlParser.hostType')}
                    value={t(`urlParser.hostTypes.${details.hostType}`)}
                  />
                  {details.hostType === 'domain' && (
                    <>
                      <ValueRow label={t('urlParser.hostUnicode')} value={details.hostUnicode} />
                      <ValueRow label={t('urlParser.hostPunycode')} value={details.hostAscii} />
                    </>
                  )}
                  <ValueRow
                    label="Port"
                    value={portNote(t, parts, details.defaultPort, details.portIsDefault)}
                  />
                </>
              )}
              <ValueRow
                label={t('urlParser.segments')}
                value={
                  details.segments.length
                    ? details.segments.map((s) => `/${s}`).join('  ')
                    : t('urlParser.noSegments')
                }
              />
            </ResultCard>
          )}
          <section className="flex flex-col gap-1">
            <h3 className="text-xs font-semibold text-fg-muted">
              {t('urlParser.queryTitle', { count: parts.query.length })}
            </h3>
            <UrlParamTable params={parts.query} onChange={(query) => update({ query })} />
          </section>
        </>
      )}
    </div>
  );
}

function portNote(
  t: TFunction<'toolsMisc'>,
  parts: UrlParts,
  defaultPort: number | null,
  isDefault: boolean,
): string {
  if (!parts.port)
    return defaultPort
      ? t('urlParser.portUnsetDefault', { scheme: parts.scheme, port: String(defaultPort) })
      : t('urlParser.portUnset');
  if (defaultPort === null) return parts.port;
  return isDefault
    ? t('urlParser.portIsDefault', { port: parts.port })
    : t('urlParser.portDefaultIs', { port: parts.port, default: String(defaultPort) });
}
