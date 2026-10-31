import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ChevronRight,
  FileText,
  Folder,
  KeyRound,
  Lock,
  Search,
  Variable as VariableIcon,
} from 'lucide-react';
import { cn } from '@apivator/ui';
import {
  CODE_LANGUAGES,
  generateCode,
  prettyJson,
  resolveText,
  type CodeLanguage,
  type DocAuthDto,
  type DocExampleDto,
  type DocRequestDto,
  type DocumentationDto,
  type KeyValueItem,
  type VariableMap,
} from '@apivator/core';
import { formatDateTime, useT } from '../../i18n';
import { CopyButton } from '../../components/ui/CopyButton';
import { MarkdownView } from '../collections/DescriptionDialog';
import { methodColor, methodLabel } from '../requests/methodColors';
import {
  AUTH_LABELS,
  anchor,
  buildTree,
  codeRequest,
  filterTree,
  flatten,
  queryParams,
  variableMap,
  type DocNode,
} from './docsModel';
import { generateModel, inferModel, MODEL_LANGUAGES, type ModelLanguage } from '@apivator/core/models';
import { modelOptions, useModelPrefs } from '../models/modelPrefs';
import { jsonSamples, rootNameFor } from '../models/sources';

const LANGUAGE_KEY = 'apivator:docs-language';

function readLanguage(): CodeLanguage {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    if (saved && CODE_LANGUAGES.some((l) => l.id === saved)) return saved as CodeLanguage;
  } catch {
    /* depolama kapalı */
  }
  return 'curl';
}

function statusTone(status: number) {
  return status < 300
    ? 'bg-success/10 text-success'
    : status < 400
      ? 'bg-accent/10 text-accent'
      : 'bg-danger/10 text-danger';
}

function CodeBlock({ text, label, className }: { text: string; label: string; className?: string }) {
  const t = useT('docs');
  return (
    <div className={cn('group relative', className)}>
      <pre
        aria-label={label}
        className="max-h-96 overflow-auto rounded-md border border-line bg-muted/40 p-3 font-mono text-[12px] leading-relaxed whitespace-pre text-fg"
      >
        {text}
      </pre>
      <span className="absolute top-1.5 end-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        <CopyButton compact text={text} label={t('view.copyLabel', { label })} />
      </span>
    </div>
  );
}

function Table({ items, caption }: { items: KeyValueItem[]; caption: string }) {
  if (items.length === 0) return null;
  const described = items.some((i) => i.description);
  return (
    <div className="mt-4">
      <h4 className="mb-1.5 text-xs font-semibold tracking-wide text-fg-muted uppercase">{caption}</h4>
      <table className="w-full table-fixed border-collapse text-[12.5px]" aria-label={caption}>
        <tbody>
          {items.map((item, i) => (
            <tr key={i} className="border-t border-line align-top first:border-t-0">
              <td className="w-1/3 py-1.5 pe-3 font-mono font-medium break-words">{item.key}</td>
              <td className={cn('py-1.5 pe-3 font-mono break-words text-fg-muted', !described && 'w-2/3')}>
                {item.value}
              </td>
              {described && <td className="py-1.5 text-fg-muted">{item.description}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuthLine({ auth }: { auth: DocAuthDto }) {
  const t = useT('docs');
  if (auth.type === 'None' || auth.type === 'Inherit') return null;
  return (
    <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[12.5px] text-fg-muted">
      <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="font-medium text-fg">{AUTH_LABELS[auth.type] ?? auth.type}</span>
      {auth.detail && <code className="rounded bg-muted px-1 font-mono text-[11.5px]">{auth.detail}</code>}
      {auth.source && (
        <span className="text-fg-subtle">
          ·{' '}
          {auth.source === 'collection'
            ? t('auth.inheritedFromCollection')
            : t('auth.inheritedFromFolder', { name: auth.source })}
        </span>
      )}
    </p>
  );
}

function Body({ request }: { request: DocRequestDto }) {
  const t = useT('docs');
  const { body } = request;
  if (body.mode === 'None') return null;
  let content: ReactNode;
  if (body.mode === 'Raw')
    content = <CodeBlock text={prettyJson(body.raw).text} label={t('view.requestBody')} />;
  else if (body.mode === 'GraphQL')
    content = (
      <>
        <CodeBlock text={body.raw} label={t('view.graphqlQuery')} />
        {body.graphqlVariables.trim() && (
          <CodeBlock
            className="mt-2"
            text={prettyJson(body.graphqlVariables).text}
            label={t('view.graphqlVariables')}
          />
        )}
      </>
    );
  else if (body.mode === 'Binary')
    content = <p className="text-[12.5px] text-fg-muted">{t('view.file', { name: body.fileName ?? '—' })}</p>;
  else
    content = (
      <Table
        caption={body.mode === 'FormData' ? t('view.formMultipart') : t('view.formUrlencoded')}
        items={body.form
          .filter((f) => f.enabled)
          .map((f) => (f.type === 'File' ? { ...f, value: `📎 ${f.value}` } : f))}
      />
    );
  return (
    <div className="mt-4">
      {body.mode !== 'UrlEncoded' && body.mode !== 'FormData' && (
        <h4 className="mb-1.5 text-xs font-semibold tracking-wide text-fg-muted uppercase">
          {body.mode === 'Raw'
            ? t('view.bodyTitleWithKind', { kind: body.rawLanguage })
            : body.mode === 'GraphQL'
              ? t('view.bodyTitleWithKind', { kind: 'GraphQL' })
              : t('view.bodyTitle')}
        </h4>
      )}
      {content}
    </div>
  );
}

function Examples({ examples }: { examples: DocExampleDto[] }) {
  const t = useT('docs');
  const [index, setIndex] = useState(0);
  if (examples.length === 0) return null;
  const example = examples[Math.min(index, examples.length - 1)]!;
  return (
    <div className="mt-4">
      <h4 className="mb-1.5 text-xs font-semibold tracking-wide text-fg-muted uppercase">
        {t('view.exampleResponses')}
      </h4>
      <div role="tablist" aria-label={t('view.exampleResponses')} className="mb-2 flex flex-wrap gap-1">
        {examples.map((e, i) => (
          <button
            key={e.id}
            type="button"
            role="tab"
            aria-selected={i === index}
            onClick={() => setIndex(i)}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs',
              i === index
                ? 'border-accent/40 bg-accent/5 text-fg'
                : 'border-line text-fg-muted hover:bg-muted',
            )}
          >
            <span className={cn('rounded px-1 font-mono text-[11px] font-semibold', statusTone(e.status))}>
              {e.status}
            </span>
            {e.name}
          </button>
        ))}
      </div>
      {example.requestBody && (
        <CodeBlock
          className="mb-2"
          text={prettyJson(example.requestBody).text}
          label={t('view.exampleRequestBody')}
        />
      )}
      {example.headers.length > 0 && (
        <details className="mb-2 text-[12px]">
          <summary className="cursor-pointer text-fg-muted">
            {t('view.responseHeadersCount', { count: example.headers.length })}
          </summary>
          <Table caption={t('view.responseHeaders')} items={example.headers} />
        </details>
      )}
      {example.body ? (
        <CodeBlock
          text={prettyJson(example.body).text}
          label={t('view.exampleResponseBody', { name: example.name })}
        />
      ) : (
        <p className="text-xs text-fg-subtle">{t('view.noBody')}</p>
      )}
      {example.bodyTruncated && <p className="mt-1 text-xs text-fg-subtle">{t('view.bodyTruncated')}</p>}
    </div>
  );
}

function CodeSample({
  request,
  variables,
  language,
  onLanguage,
}: {
  request: DocRequestDto;
  variables: VariableMap;
  language: CodeLanguage;
  onLanguage: (language: CodeLanguage) => void;
}) {
  const t = useT('docs');
  const code = useMemo(
    () => generateCode(language, codeRequest(request, variables)),
    [language, request, variables],
  );
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
          {t('view.exampleCode')}
        </h4>
        <select
          value={language}
          onChange={(e) => onLanguage(e.target.value as CodeLanguage)}
          aria-label={t('view.codeLanguage')}
          className="h-7 rounded-md border border-line bg-surface px-1.5 text-xs focus:border-accent focus:outline-none"
        >
          {CODE_LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </div>
      <CodeBlock text={code} label={t('view.exampleCodeOf', { name: request.name })} />
    </div>
  );
}

/** Örnek yanıtlardan ve istek gövdesinden üretilen model (dil seçimi model penceresiyle ortak). */
function ModelSample({ request }: { request: DocRequestDto }) {
  const t = useT('docs');
  const language = useModelPrefs((s) => s.language);
  const prefs = useModelPrefs();
  const responses = useMemo(
    () => jsonSamples(request.examples.filter((e) => e.status < 400 && !e.bodyTruncated).map((e) => e.body)),
    [request.examples],
  );
  const requests = useMemo(
    () =>
      jsonSamples([
        ...(request.body.mode === 'Raw' && request.body.rawLanguage === 'Json' ? [request.body.raw] : []),
        ...request.examples.map((e) => e.requestBody),
      ]),
    [request.body, request.examples],
  );
  const [kind, setKind] = useState<'response' | 'request'>(responses.length ? 'response' : 'request');
  const samples = kind === 'response' ? responses : requests;
  const code = useMemo(() => {
    if (!samples.length) return '';
    const set = inferModel(samples, {
      rootName: rootNameFor(request.name, kind === 'response' ? 'Response' : 'Request'),
    });
    const files = generateModel(set, modelOptions(prefs));
    return files.length === 1
      ? files[0]!.content
      : files.map((f) => `// ---- ${f.name} ----\n${f.content}`).join('\n');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tercihlerin tamamı
  }, [samples, kind, request.name, JSON.stringify(modelOptions(prefs))]);

  if (!responses.length && !requests.length) return null;
  return (
    <div className="mt-6 min-w-0">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold tracking-wide text-fg-muted uppercase">{t('view.model')}</h4>
        <span className="flex gap-1.5">
          {responses.length > 0 && requests.length > 0 && (
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as 'response' | 'request')}
              aria-label={t('view.modelSource')}
              className="h-7 rounded-md border border-line bg-surface px-1.5 text-xs focus:border-accent focus:outline-none"
            >
              <option value="response">{t('view.modelSourceResponse')}</option>
              <option value="request">{t('view.modelSourceRequest')}</option>
            </select>
          )}
          <select
            value={language}
            onChange={(e) => prefs.set({ language: e.target.value as ModelLanguage })}
            aria-label={t('view.modelLanguage')}
            className="h-7 rounded-md border border-line bg-surface px-1.5 text-xs focus:border-accent focus:outline-none"
          >
            {MODEL_LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </span>
      </div>
      <CodeBlock text={code} label={t('view.modelOf', { name: request.name })} />
    </div>
  );
}

function RequestSection({
  request,
  variables,
  language,
  onLanguage,
}: {
  request: DocRequestDto;
  variables: VariableMap;
  language: CodeLanguage;
  onLanguage: (language: CodeLanguage) => void;
}) {
  const t = useT('docs');
  const resolvedUrl = resolveText(request.url, variables).text;
  const isHttp = request.kind === 'Http' || request.kind === 'Sse';
  return (
    <section
      id={anchor.request(request.id)}
      aria-labelledby={`${anchor.request(request.id)}-baslik`}
      className="scroll-mt-4 border-t border-line py-8 first:border-t-0"
    >
      <h3
        id={`${anchor.request(request.id)}-baslik`}
        className="flex items-center gap-2 text-lg font-semibold"
      >
        <span className={cn('font-mono text-[13px] font-bold', methodColor(request.method, request.kind))}>
          {methodLabel(request.method, request.kind)}
        </span>
        {request.name}
      </h3>
      <div className="mt-2 rounded-md border border-line bg-muted/40 px-3 py-2 font-mono text-[12.5px] break-all">
        {request.url || <span className="text-fg-subtle">{t('view.noUrl')}</span>}
        {request.grpcMethod && <span className="text-fg-muted"> {request.grpcMethod}</span>}
      </div>
      {resolvedUrl !== request.url && (
        <p
          className="mt-1 font-mono text-[11.5px] break-all text-fg-subtle"
          title={t('view.resolvedUrlTitle')}
        >
          → {resolvedUrl}
        </p>
      )}
      <div className={cn('mt-4 grid gap-6', isHttp && 'xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]')}>
        <div className="min-w-0">
          {request.description.trim() ? (
            <MarkdownView source={request.description} />
          ) : (
            <p className="text-[12.5px] text-fg-subtle italic">{t('view.noDescription')}</p>
          )}
          <AuthLine auth={request.auth} />
          <Table caption={t('view.queryParams')} items={queryParams(request.url)} />
          <Table
            caption={request.kind === 'Grpc' ? t('view.metadata') : t('view.headers')}
            items={request.headers}
          />
          {isHttp && <Body request={request} />}
          <Examples examples={request.examples} />
        </div>
        {isHttp && (
          <div className="min-w-0">
            <CodeSample request={request} variables={variables} language={language} onLanguage={onLanguage} />
            <ModelSample request={request} />
          </div>
        )}
      </div>
    </section>
  );
}

function NavTree({ nodes, onOpen }: { nodes: DocNode[]; onOpen: (id: string) => void }) {
  return (
    <ul className="flex flex-col">
      {nodes.map((n) =>
        n.kind === 'folder' ? (
          <li key={n.folder.id}>
            <button
              type="button"
              onClick={() => onOpen(anchor.folder(n.folder.id))}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-start text-[12.5px] font-medium text-fg hover:bg-muted"
              style={{ paddingLeft: 8 + n.depth * 12 }}
            >
              <Folder className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
              <span className="truncate">{n.folder.name}</span>
            </button>
            <NavTree nodes={n.children} onOpen={onOpen} />
          </li>
        ) : (
          <li key={n.request.id}>
            <button
              type="button"
              onClick={() => onOpen(anchor.request(n.request.id))}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-start text-[12.5px] text-fg-muted hover:bg-muted hover:text-fg"
              style={{ paddingLeft: 8 + n.depth * 12 }}
            >
              <span
                className={cn(
                  'w-9 shrink-0 font-mono text-[10.5px] font-bold',
                  methodColor(n.request.method, n.request.kind),
                )}
              >
                {methodLabel(n.request.method, n.request.kind)}
              </span>
              <span className="truncate">{n.request.name}</span>
            </button>
          </li>
        ),
      )}
    </ul>
  );
}

/**
 * Collection'ın dokümantasyon sayfası (uygulama içinde ve yayınlanmış bağlantıda aynı): solda gezinti ve arama,
 * ortada açıklamalar, istekler, örnekler ve örnek kod.
 */
export function DocsView({ doc, toolbar }: { doc: DocumentationDto; toolbar?: ReactNode }) {
  const t = useT('docs');
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState<CodeLanguage>(readLanguage);
  const content = useRef<HTMLDivElement>(null);
  const tree = useMemo(() => buildTree(doc), [doc]);
  const visible = useMemo(() => filterTree(tree, query), [tree, query]);
  const nodes = useMemo(() => flatten(visible), [visible]);
  const variables = useMemo(() => variableMap(doc), [doc]);

  const chooseLanguage = (next: CodeLanguage) => {
    setLanguage(next);
    try {
      localStorage.setItem(LANGUAGE_KEY, next);
    } catch {
      /* depolama kapalı */
    }
  };

  const open = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      history.replaceState(null, '', `#${id}`);
    } catch {
      /* önizleme çerçevesi */
    }
  };

  // Bağlantıdaki #istek-… ilk açılışta o bölüme götürür.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, []);

  const requestCount = doc.requests.length;
  const showIntro = !query.trim();

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-5 py-3">
        <FileText className="h-5 w-5 text-accent" aria-hidden="true" />
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">{doc.name}</h1>
          <p className="text-xs text-fg-subtle">
            {t('view.metaLine', {
              workspace: doc.workspaceName,
              count: requestCount,
              hasEnvironment: doc.environmentName ? 'yes' : 'no',
              environment: doc.environmentName ?? '',
              updated: formatDateTime(doc.updatedAt, { dateStyle: 'medium', timeStyle: 'short' }),
            })}
          </p>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">{toolbar}</div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label={t('view.contents')}
          className="hidden w-64 shrink-0 flex-col border-e border-line bg-surface md:flex"
        >
          <label className="m-2 flex items-center gap-1.5 rounded-md border border-line px-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('view.searchPlaceholder')}
              aria-label={t('view.searchLabel')}
              className="h-7 min-w-0 flex-1 bg-transparent text-xs focus:outline-none"
            />
          </label>
          <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-3">
            {showIntro && (
              <button
                type="button"
                onClick={() => open('giris')}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-start text-[12.5px] font-medium hover:bg-muted"
              >
                <ChevronRight className="h-3.5 w-3.5 text-fg-subtle" aria-hidden="true" /> {t('view.intro')}
              </button>
            )}
            {visible.length ? (
              <NavTree nodes={visible} onOpen={open} />
            ) : (
              <p className="p-3 text-xs text-fg-subtle">{t('view.noMatch')}</p>
            )}
          </div>
        </nav>

        <div ref={content} className="min-h-0 flex-1 overflow-y-auto">
          <article className="mx-auto max-w-6xl px-6 py-6 lg:px-10">
            {/* Dar ekranda arama kutusu (sol gezinti gizli). */}
            <label className="mb-4 flex items-center gap-1.5 rounded-md border border-line px-2 md:hidden">
              <Search className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('view.searchPlaceholder')}
                aria-label={t('view.searchLabelNarrow')}
                className="h-8 min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
              />
            </label>

            {showIntro && (
              <section id="giris" aria-label={t('view.intro')} className="scroll-mt-4 pb-6">
                {doc.description?.trim() ? (
                  <MarkdownView source={doc.description} />
                ) : (
                  <h2 className="text-2xl font-semibold">{doc.name}</h2>
                )}
                {doc.auth.type !== 'None' && (
                  <div className="mt-5">
                    <h3 className="text-sm font-semibold">{t('view.authorization')}</h3>
                    <AuthLine auth={{ ...doc.auth, source: null }} />
                  </div>
                )}
                {doc.variables.length > 0 && (
                  <div className="mt-5">
                    <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                      <VariableIcon className="h-4 w-4 text-fg-subtle" aria-hidden="true" />{' '}
                      {t('view.variables')}
                    </h3>
                    <table
                      className="mt-2 w-full max-w-3xl table-fixed border-collapse text-[12.5px]"
                      aria-label={t('view.variables')}
                    >
                      <tbody>
                        {doc.variables.map((v) => (
                          <tr key={v.key} className="border-t border-line first:border-t-0">
                            <td className="w-1/3 py-1.5 pe-3 font-mono font-medium break-words">{`{{${v.key}}}`}</td>
                            <td className="py-1.5 pe-3 font-mono break-words text-fg-muted">
                              {v.isSecret ? (
                                <span className="flex items-center gap-1 font-sans text-fg-subtle">
                                  <Lock className="h-3 w-3" aria-hidden="true" /> {t('view.secret')}
                                </span>
                              ) : (
                                v.value || (
                                  <span className="font-sans text-fg-subtle italic">{t('view.empty')}</span>
                                )
                              )}
                            </td>
                            <td className="w-28 py-1.5 text-end text-xs text-fg-subtle">
                              {v.source === 'environment'
                                ? t('view.scopeEnvironment')
                                : t('view.scopeCollection')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {nodes.length === 0 && requestCount === 0 && (
              <p className="py-10 text-center text-sm text-fg-subtle">{t('view.noRequests')}</p>
            )}
            {nodes.length === 0 && requestCount > 0 && (
              <p className="py-10 text-center text-sm text-fg-subtle">{t('view.noMatchingRequests')}</p>
            )}

            {nodes.map((n) =>
              n.kind === 'folder' ? (
                <section
                  key={n.folder.id}
                  id={anchor.folder(n.folder.id)}
                  aria-label={t('view.folderLabel', { name: n.folder.name })}
                  className="scroll-mt-4 border-t-2 border-line pt-8"
                >
                  <h2 className="flex items-center gap-2 text-xl font-semibold">
                    <Folder className="h-5 w-5 text-fg-subtle" aria-hidden="true" /> {n.folder.name}
                  </h2>
                  {n.folder.description && (
                    <div className="mt-2">
                      <MarkdownView source={n.folder.description} />
                    </div>
                  )}
                </section>
              ) : (
                <RequestSection
                  key={n.request.id}
                  request={n.request}
                  variables={variables}
                  language={language}
                  onLanguage={chooseLanguage}
                />
              ),
            )}
          </article>
        </div>
      </div>
    </div>
  );
}
