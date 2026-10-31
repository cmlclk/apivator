import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BookOpen, RefreshCw, Wand2 } from 'lucide-react';
import { Spinner, cn } from '@apivator/ui';
import { graphql as graphqlExtension } from 'cm6-graphql';
import { parse, print } from 'graphql';
import type { RequestBody } from '@apivator/core';
import { useT } from '../../i18n';
import { CodeEditor } from '../requests/CodeEditor';
import { timeAgo } from '../activity/activity';
import { loadCachedSchema, useGraphqlSchemas } from './graphqlSchema';
import { SchemaExplorer } from './SchemaExplorer';

const toolButton =
  'flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-fg-muted hover:bg-muted hover:text-fg disabled:opacity-50';

/**
 * GraphQL gövdesi: şemaya göre otomatik tamamlama ve hata işaretleme (cm6-graphql), şema gezgini, biçimlendirme.
 * Şema isteğin kendi adresinden introspection ile alınır; adres başına önbelleğe yazılır.
 *
 * schemaKey: değişkenleri çözülmüş adres (tanımsız değişken varsa null); onIntrospect: şemayı (yeniden) iste.
 */
export function GraphqlBody({
  body,
  onChange,
  schemaKey,
  onIntrospect,
}: {
  body: RequestBody;
  onChange: (body: RequestBody) => void;
  schemaKey: string | null;
  onIntrospect?: () => void;
}) {
  const t = useT('graphql');
  const entry = useGraphqlSchemas((s) => (schemaKey ? s.entries[schemaKey] : undefined));
  const schema = entry?.schema ?? null;
  const [explorer, setExplorer] = useState(false);
  const [formatError, setFormatError] = useState<string | null>(null);

  // Önbellekte yoksa şema bir kez kendiliğinden istenir (Postman'deki gibi). Adres yazılırken her ara adres için
  // istek gitmesin diye yazma bittikten sonra (800 ms) bakılır.
  useEffect(() => {
    if (!schemaKey || !onIntrospect) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void loadCachedSchema(schemaKey).then((cached) => {
        if (!cancelled && !cached) onIntrospect();
      });
    }, 800);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // onIntrospect her çizimde yeni olabilir; yalnızca adres değişince tetiklenir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemaKey]);

  const extensions = useMemo(
    () => graphqlExtension(schema ?? undefined, { showErrorOnInvalidSchema: false }),
    [schema],
  );

  function format() {
    try {
      onChange({ ...body, raw: print(parse(body.raw)) });
      setFormatError(null);
    } catch (e) {
      setFormatError(e instanceof Error ? e.message.split('\n')[0]! : String(e));
    }
  }

  const status =
    entry?.status === 'loading' ? (
      <span className="flex items-center gap-1 text-fg-subtle">
        <Spinner className="h-3 w-3" /> {t('body.loading')}
      </span>
    ) : entry?.status === 'error' ? (
      <span className="flex min-w-0 items-center gap-1 text-warning" title={entry.error ?? undefined}>
        <AlertTriangle className="h-3 w-3 shrink-0" />
        <span className="truncate">{schema ? t('body.refreshFailed') : entry.error}</span>
      </span>
    ) : schema ? (
      <span className="text-fg-subtle">
        {t('body.typeCount', {
          count: Object.keys(schema.getTypeMap()).filter((n) => !n.startsWith('__')).length,
        })}
        {entry?.fetchedAt && ` · ${timeAgo(entry.fetchedAt)}`}
      </span>
    ) : (
      <span className="text-fg-subtle">{schemaKey ? t('body.none') : t('body.defineVariables')}</span>
    );

  return (
    <div className="flex min-h-40 flex-1 flex-col gap-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {status}
        <div className="ms-auto flex items-center gap-0.5">
          {onIntrospect && (
            <button
              type="button"
              className={toolButton}
              onClick={onIntrospect}
              disabled={!schemaKey || entry?.status === 'loading'}
              title={t('body.refreshTitle')}
            >
              <RefreshCw className="h-3 w-3" /> {schema ? t('body.refresh') : t('body.fetch')}
            </button>
          )}
          <button
            type="button"
            className={toolButton}
            onClick={format}
            disabled={!body.raw.trim()}
            title={t('body.formatTitle')}
          >
            <Wand2 className="h-3 w-3" /> {t('body.format')}
          </button>
          <button
            type="button"
            className={cn(toolButton, explorer && 'bg-accent/10 text-accent')}
            aria-pressed={explorer}
            onClick={() => setExplorer((o) => !o)}
            disabled={!schema}
            title={t('body.explorerTitle')}
          >
            <BookOpen className="h-3 w-3" /> {t('body.schema')}
          </button>
        </div>
      </div>
      {formatError && (
        <p role="alert" className="text-xs text-danger">
          {t('body.formatFailed', { error: formatError })}
        </p>
      )}
      <div
        className={cn(
          'grid min-h-32 flex-1 grid-cols-1 gap-3',
          explorer && schema ? 'md:grid-cols-[3fr_2fr_minmax(220px,2fr)]' : 'md:grid-cols-[3fr_2fr]',
        )}
      >
        <div className="flex min-h-0 flex-col gap-1">
          <span className="text-[11px] font-medium tracking-wide text-fg-subtle uppercase">
            {t('body.query')}
          </span>
          <div className="min-h-32 flex-1 overflow-hidden rounded-md border border-line bg-surface">
            <CodeEditor
              value={body.raw}
              onChange={(raw) => onChange({ ...body, raw })}
              language="none"
              extensions={extensions}
              label={t('body.queryLabel')}
              placeholder={'query {\n  kullanicilar { id ad }\n}'}
            />
          </div>
        </div>
        <div className="flex min-h-0 flex-col gap-1">
          <span className="text-[11px] font-medium tracking-wide text-fg-subtle uppercase">
            {t('body.variables')}
          </span>
          <div className="min-h-32 flex-1 overflow-hidden rounded-md border border-line bg-surface">
            <CodeEditor
              value={body.graphqlVariables ?? ''}
              onChange={(graphqlVariables) => onChange({ ...body, graphqlVariables })}
              language="Json"
              label={t('body.variablesLabel')}
              placeholder={'{\n  "ilk": 10\n}'}
            />
          </div>
        </div>
        {explorer && schema && (
          <div className="min-h-0 overflow-hidden rounded-md border border-line bg-surface">
            <SchemaExplorer
              schema={schema}
              onInsert={({ query, variables }) => {
                const hasQuery = body.raw.trim().length > 0;
                const hasVariables = (body.graphqlVariables ?? '').trim().length > 0;
                onChange({
                  ...body,
                  raw: hasQuery ? `${body.raw.trimEnd()}\n\n${query}` : query,
                  graphqlVariables:
                    !hasVariables && Object.keys(variables).length
                      ? JSON.stringify(variables, null, 2)
                      : (body.graphqlVariables ?? ''),
                });
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
