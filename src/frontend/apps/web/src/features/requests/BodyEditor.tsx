import { lazy, Suspense } from 'react';
import { formatBytes, type BodyMode, type RawLanguage, type RequestBody } from '@apivator/core';
import { cn } from '@apivator/ui';
import { useT } from '../../i18n';
import { CodeEditor } from './CodeEditor';
import { ModelButton } from '../models/ModelButton';
import { jsonSamples, rootNameFor } from '../models/sources';
import { findFile, useFiles, useHasFile } from './fileStore';
import { FilePicker, KeyValueEditor } from './KeyValueEditor';

// GraphQL kütüphaneleri büyük; yalnızca GraphQL gövdesi açılınca yüklenir.
const GraphqlBody = lazy(() => import('../graphql/GraphqlBody').then((m) => ({ default: m.GraphqlBody })));

const modes: { id: BodyMode; label: string }[] = [
  { id: 'None', label: 'none' },
  { id: 'FormData', label: 'form-data' },
  { id: 'UrlEncoded', label: 'x-www-form-urlencoded' },
  { id: 'Raw', label: 'raw' },
  { id: 'Binary', label: 'binary' },
  { id: 'GraphQL', label: 'GraphQL' },
];

const languages: RawLanguage[] = ['Json', 'Text', 'Xml', 'Html', 'JavaScript'];
const languageLabel: Record<RawLanguage, string> = {
  Json: 'JSON',
  Text: 'Text',
  Xml: 'XML',
  Html: 'HTML',
  JavaScript: 'JavaScript',
};

export function BodyEditor({
  tabId,
  body,
  name,
  onChange,
  graphql,
}: {
  tabId: string;
  body: RequestBody;
  /** İsteğin adı (model üretiminde kök sınıf adı). */
  name?: string;
  onChange: (body: RequestBody) => void;
  /** GraphQL şeması: çözülmüş adres (anahtar) ve introspection'ı başlatan işlev. */
  graphql?: { schemaKey: string | null; onIntrospect?: () => void };
}) {
  const t = useT('requests');
  const remember = useFiles((s) => s.remember);
  // Yalnızca yeniden çizim için: dosya seçildiğinde "yeniden seçin" uyarısı kalksın.
  useFiles((s) => s.files);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-2"
        role="radiogroup"
        aria-label={t('body.typeLabel')}
      >
        {modes.map((mode) => (
          <label key={mode.id} className="flex cursor-pointer items-center gap-1.5 text-[13px] text-fg-muted">
            <input
              type="radio"
              name="body-mode"
              checked={body.mode === mode.id}
              onChange={() => onChange({ ...body, mode: mode.id })}
              className="accent-[var(--app-accent)]"
            />
            <span className={cn(body.mode === mode.id && 'text-fg')}>{mode.label}</span>
          </label>
        ))}
        {body.mode === 'Raw' && (
          <select
            value={body.rawLanguage}
            onChange={(e) => onChange({ ...body, rawLanguage: e.target.value as RawLanguage })}
            aria-label={t('body.rawType')}
            className="h-7 rounded-md border border-line bg-surface px-2 text-xs font-medium text-accent"
          >
            {languages.map((l) => (
              <option key={l} value={l}>
                {languageLabel[l]}
              </option>
            ))}
          </select>
        )}
        {body.mode === 'Raw' && body.rawLanguage === 'Json' && body.raw.trim() && (
          <ModelButton
            className="ms-auto"
            title={t('body.modelTitle')}
            sources={() => {
              const raw = body.raw;
              return [
                {
                  id: 'body',
                  label: t('body.modelSource'),
                  kind: 'samples' as const,
                  rootName: rootNameFor(name, 'Request'),
                  samples: async () => jsonSamples([raw]),
                },
              ];
            }}
          />
        )}
      </div>

      {body.mode === 'None' && <p className="py-6 text-center text-sm text-fg-subtle">{t('body.none')}</p>}

      {body.mode === 'Raw' && (
        <div className="min-h-40 flex-1 overflow-hidden rounded-md border border-line bg-surface">
          <CodeEditor
            value={body.raw}
            onChange={(raw) => onChange({ ...body, raw })}
            language={body.rawLanguage}
            label={t('body.editorLabel')}
            collabField="body.raw"
            placeholder={body.rawLanguage === 'Json' ? t('body.sample') : undefined}
          />
        </div>
      )}

      {body.mode === 'UrlEncoded' && (
        <KeyValueEditor
          items={body.form}
          onChange={(form) => onChange({ ...body, form })}
          label={t('body.formFields')}
        />
      )}

      {body.mode === 'FormData' && (
        <KeyValueEditor
          items={body.form}
          onChange={(form) => onChange({ ...body, form })}
          label={t('body.formFields')}
          files={{
            onPick: (file) => remember(tabId, file),
            isLoaded: (name) => !!findFile(tabId, name),
          }}
        />
      )}

      {body.mode === 'Binary' && (
        <BinaryBody tabId={tabId} body={body} onChange={onChange} onPick={(file) => remember(tabId, file)} />
      )}

      {body.mode === 'GraphQL' && (
        <Suspense fallback={<p className="text-xs text-fg-subtle">{t('body.graphqlLoading')}</p>}>
          <GraphqlBody
            body={body}
            onChange={onChange}
            schemaKey={graphql?.schemaKey ?? null}
            onIntrospect={graphql?.onIntrospect}
          />
        </Suspense>
      )}
    </div>
  );
}

function BinaryBody({
  tabId,
  body,
  onChange,
  onPick,
}: {
  tabId: string;
  body: RequestBody;
  onChange: (body: RequestBody) => void;
  onPick: (file: File) => void;
}) {
  const t = useT('requests');
  const loaded = useHasFile(tabId, body.fileName);
  const file = loaded ? findFile(tabId, body.fileName) : undefined;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-line p-4">
      <FilePicker
        name={body.fileName}
        loaded={loaded}
        label={t('body.fileToSend')}
        className="px-0"
        onPick={(picked) => {
          onPick(picked);
          onChange({ ...body, fileName: picked.name });
        }}
      />
      <p className="text-xs text-fg-subtle">
        {file
          ? t('body.binaryLoaded', { size: formatBytes(file.size), type: file.type ? ` · ${file.type}` : '' })
          : t('body.binaryNotLoaded')}
      </p>
    </div>
  );
}
