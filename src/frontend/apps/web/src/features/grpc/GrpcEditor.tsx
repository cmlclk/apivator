import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { FilePlus2, FileCode2, RefreshCw, Send, Sparkles, Square, X } from 'lucide-react';
import { Alert, Button, Spinner, cn } from '@apivator/ui';
import { resolveText, type GrpcSettings, type VariableMap } from '@apivator/core';
import { CodeEditor } from '../requests/CodeEditor';
import { endGrpc, sendGrpc, useStreams } from '../streaming/streamStore';
import { findMethod, streamingLabel, useGrpcSchemas } from './grpcDefinitions';
import { ModelButton } from '../models/ModelButton';
import { jsonSamples } from '../models/sources';
import { formatBytes, useT } from '../../i18n';

const MAX_PROTO_FILES = 100;
const MAX_PROTO_BYTES = 2 * 1024 * 1024;
const AUTO_LOAD_DELAY_MS = 800;

/**
 * gRPC isteğinin ayarları: tanımların kaynağı (server reflection ya da .proto), metot seçimi, JSON mesaj ve
 * süre sınırı. İstemci/çift yönlü akışta çağrı açıkken ek mesajlar buradan gönderilir.
 */
export function GrpcEditor({
  tabId,
  settings,
  onChange,
  schemaKey,
  onLoad,
  variables,
}: {
  tabId: string;
  settings: GrpcSettings;
  onChange: (change: Partial<GrpcSettings>) => void;
  /** Tanımların anahtarı; null ise (adres ya da dosya yok) yüklenemez. */
  schemaKey: string | null;
  /** Tanımları (yeniden) getir. */
  onLoad: () => void;
  variables: VariableMap;
}) {
  const t = useT('grpc');
  const entry = useGrpcSchemas((s) => (schemaKey ? s.entries[schemaKey] : undefined));
  const session = useStreams((s) => s.sessions[tabId]);
  const streamOpen =
    session?.kind === 'Grpc' &&
    !!session.clientStreaming &&
    !session.requestEnded &&
    (session.status === 'open' || session.status === 'connecting');
  const [fileError, setFileError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const schema = entry?.schema ?? null;
  const method = findMethod(schema, settings.method);

  // Tanımlar otomatik yüklenir: .proto hemen, reflection yazmayı bitirince (her tuşta sunucuya gidilmez).
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;
  useEffect(() => {
    if (!schemaKey || useGrpcSchemas.getState().entries[schemaKey]) return;
    const timer = setTimeout(() => onLoadRef.current(), settings.useReflection ? AUTO_LOAD_DELAY_MS : 0);
    return () => clearTimeout(timer);
  }, [schemaKey, settings.useReflection]);

  async function addFiles(event: ChangeEvent<HTMLInputElement>) {
    setFileError(null);
    const picked = [...(event.target.files ?? [])];
    event.target.value = '';
    const added = await Promise.all(picked.map(async (f) => ({ name: f.name, content: await f.text() })));
    // Aynı adlı dosya yenisiyle değişir.
    const files = [...settings.protoFiles.filter((f) => !added.some((a) => a.name === f.name)), ...added];
    const total = files.reduce((sum, f) => sum + f.content.length, 0);
    if (files.length > MAX_PROTO_FILES || total > MAX_PROTO_BYTES) {
      setFileError(t('editor.fileLimit', { max: MAX_PROTO_FILES, size: formatBytes(MAX_PROTO_BYTES) }));
      return;
    }
    onChange({ protoFiles: files });
  }

  function sendNext() {
    setSendError(null);
    const { text, unresolved } = resolveText(settings.message || '{}', variables);
    if (unresolved.size > 0) {
      setSendError(
        t('editor.undefinedVariable', { names: [...unresolved].map((n) => `{{${n}}}`).join(', ') }),
      );
      return;
    }
    if (!sendGrpc(tabId, text)) setSendError(t('editor.streamClosed'));
  }

  const services = schema?.services ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-fg-muted">{t('editor.definitions')}</span>
        <div
          className="flex rounded-md border border-line p-0.5"
          role="group"
          aria-label={t('editor.sourceGroup')}
        >
          {(
            [
              [true, 'Server reflection'],
              [false, t('editor.sourceProto')],
            ] as const
          ).map(([value, label]) => (
            <button
              key={label}
              type="button"
              aria-pressed={settings.useReflection === value}
              onClick={() => onChange({ useReflection: value })}
              className={cn(
                'rounded px-2 py-0.5',
                settings.useReflection === value
                  ? 'bg-accent/10 font-medium text-accent'
                  : 'text-fg-muted hover:bg-muted',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {!settings.useReflection && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept=".proto"
              multiple
              hidden
              onChange={(e) => void addFiles(e)}
              aria-label={t('editor.pickFile')}
            />
            <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()}>
              <FilePlus2 className="h-3.5 w-3.5" /> {t('editor.addFile')}
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={onLoad}
          disabled={!schemaKey || entry?.status === 'loading'}
          title={
            schemaKey
              ? t('editor.reloadTitle')
              : settings.useReflection
                ? t('editor.needUrl')
                : t('editor.needProto')
          }
        >
          {entry?.status === 'loading' ? (
            <Spinner className="h-3.5 w-3.5" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {schema ? t('editor.refresh') : t('editor.load')}
        </Button>
        {entry?.status === 'ready' && schema && (
          <span className="text-fg-subtle">
            {t('editor.counts', {
              services: services.length,
              methods: services.reduce((n, s) => n + s.methods.length, 0),
            })}
          </span>
        )}
      </div>

      {!settings.useReflection && settings.protoFiles.length > 0 && (
        <ul aria-label={t('editor.loadedFiles')} className="flex flex-wrap gap-1.5">
          {settings.protoFiles.map((f) => (
            <li
              key={f.name}
              className="flex items-center gap-1 rounded-md border border-line bg-muted/40 py-0.5 pe-0.5 ps-1.5 text-xs"
            >
              <FileCode2 className="h-3 w-3 text-fg-subtle" aria-hidden="true" />
              <span className="font-mono">{f.name}</span>
              <button
                type="button"
                onClick={() => onChange({ protoFiles: settings.protoFiles.filter((x) => x.name !== f.name) })}
                aria-label={t('editor.removeFile', { name: f.name })}
                className="rounded p-0.5 text-fg-subtle hover:bg-danger/10 hover:text-danger"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!settings.useReflection && settings.protoFiles.length === 0 && (
        <p className="text-xs text-fg-subtle">{t('editor.protoHint')}</p>
      )}
      {fileError && (
        <p role="alert" className="text-xs text-danger">
          {fileError}
        </p>
      )}
      {entry?.status === 'error' && entry.error && (
        <Alert tone="error" className="text-xs whitespace-pre-wrap">
          {entry.error}
        </Alert>
      )}
      {schema && schema.warnings.length > 0 && (
        <Alert tone="warning" className="text-xs">
          <ul className="list-disc ps-4">
            {schema.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={settings.method}
          onChange={(e) => {
            const next = findMethod(schema, e.target.value);
            // Mesaj boşsa ya da önceki metodun örneği duruyorsa yeni metodun örneği konur.
            const previous = findMethod(schema, settings.method);
            const replace = !settings.message.trim() || (previous && settings.message === previous.sample);
            onChange({ method: e.target.value, ...(next && replace ? { message: next.sample } : {}) });
          }}
          aria-label={t('editor.methodLabel')}
          className="h-8 min-w-64 max-w-full rounded-md border border-line bg-surface px-2 font-mono text-xs focus:border-accent focus:outline-none"
        >
          <option value="">{services.length ? t('editor.pickMethod') : t('editor.loadFirst')}</option>
          {services.map((service) => (
            <optgroup key={service.name} label={service.name}>
              {service.methods.map((m) => (
                <option key={m.path} value={m.path}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          ))}
          {settings.method && !method && (
            <option value={settings.method}>{t('editor.notLoaded', { method: settings.method })}</option>
          )}
        </select>
        {method && (
          <>
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[11px] font-medium',
                method.clientStreaming || method.serverStreaming
                  ? 'bg-accent/10 text-accent'
                  : 'bg-muted text-fg-muted',
              )}
            >
              {streamingLabel(method)}
            </span>
            <span className="font-mono text-[11px] text-fg-subtle">
              {method.inputType} → {method.outputType}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onChange({ message: method.sample })}
              title={t('editor.sampleTitle')}
            >
              <Sparkles className="h-3.5 w-3.5" /> {t('editor.sample')}
            </Button>
            <ModelButton
              title={t('editor.modelTitle')}
              sources={() => {
                const short = (type: string) => type.split('.').at(-1) ?? type;
                return [
                  method.outputSchema
                    ? {
                        id: 'out',
                        label: t('editor.responseMessage', { type: short(method.outputType) }),
                        kind: 'schema' as const,
                        schema: method.outputSchema,
                        rootName: short(method.outputType),
                      }
                    : null,
                  method.inputSchema
                    ? {
                        id: 'in',
                        label: t('editor.requestMessage', { type: short(method.inputType) }),
                        kind: 'schema' as const,
                        schema: method.inputSchema,
                        rootName: short(method.inputType),
                      }
                    : {
                        id: 'in',
                        label: t('editor.requestMessageSample', { type: short(method.inputType) }),
                        kind: 'samples' as const,
                        rootName: short(method.inputType),
                        samples: async () => jsonSamples([method.sample]),
                      },
                ].filter((s) => s !== null);
              }}
            />
          </>
        )}
        <label className="ms-auto flex items-center gap-1.5 text-xs text-fg-muted">
          {t('editor.deadline')}
          <input
            type="number"
            min={0}
            step={1}
            value={settings.deadlineSeconds ?? ''}
            onChange={(e) =>
              onChange({
                deadlineSeconds: e.target.value ? Math.max(0, Number(e.target.value)) || null : null,
              })
            }
            placeholder={t('editor.deadlinePlaceholder')}
            aria-label={t('editor.deadlineLabel')}
            className="h-7 w-16 rounded-md border border-line bg-surface px-1.5 text-xs focus:border-accent focus:outline-none"
          />
          {t('editor.deadlineUnit')}
        </label>
      </div>

      <div className="min-h-24 flex-1 overflow-hidden rounded-md border border-line bg-surface">
        <CodeEditor
          value={settings.message}
          onChange={(message) => onChange({ message })}
          language="Json"
          label={t('editor.messageLabel')}
          placeholder='{"id": "{{urunId}}"}'
        />
      </div>

      {streamOpen && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={sendNext} title={t('editor.sendTitle')}>
            <Send className="h-3.5 w-3.5" /> {t('editor.send')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => endGrpc(tabId)} title={t('editor.endTitle')}>
            <Square className="h-3.5 w-3.5" /> {t('editor.end')}
          </Button>
          {sendError && (
            <span role="alert" className="text-xs text-danger">
              {sendError}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
