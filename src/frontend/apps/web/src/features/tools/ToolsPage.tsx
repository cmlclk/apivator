import { Component, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, useParams } from 'react-router';
import { Eraser, Search, Star, Wrench } from 'lucide-react';
import { Alert, Button, Input, Spinner, cn } from '@apivator/ui';
import { compareText, useT } from '../../i18n';
import { CATEGORY_LABELS, TOOLS, findTool, searchTools, type ToolCategory, type ToolDef } from './registry';
import { useToolsStore } from './toolsStore';
import { SmartPaste } from './SmartPaste';

const categories = Object.keys(CATEGORY_LABELS) as ToolCategory[];

function ToolFailure({
  error,
  onClear,
  onRetry,
}: {
  error: Error;
  onClear: () => void;
  onRetry: () => void;
}) {
  const t = useT('tools');
  return (
    <Alert tone="error" className="space-y-2">
      <p>{t('page.toolFailed', { message: error.message })}</p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            onClear();
            onRetry();
          }}
        >
          {t('page.clearAndRetry')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
          {t('page.reload')}
        </Button>
      </div>
    </Alert>
  );
}

/**
 * Aracın parçası yüklenemezse (yeni sürüm yayınlandıysa) ya da araç kayıtlı girdiyle çökerse
 * uygulamanın geri kalanı ayakta kalır; girdiler temizlenip yeniden denenebilir.
 */
class ToolErrorBoundary extends Component<
  { children: ReactNode; onClear: () => void },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <ToolFailure
        error={this.state.error}
        onClear={this.props.onClear}
        onRetry={() => this.setState({ error: null })}
      />
    );
  }
}

function ToolLink({ tool }: { tool: ToolDef }) {
  return (
    <NavLink
      to={`/tools/${tool.id}`}
      className={({ isActive }) =>
        cn(
          'block truncate rounded-md px-2 py-1 text-[13px]',
          isActive ? 'bg-accent/10 font-medium text-accent' : 'text-fg-muted hover:bg-muted hover:text-fg',
        )
      }
    >
      {tool.name}
    </NavLink>
  );
}

/** `hideTitle`: başlık menüde görünmez, yalnızca ekran okuyucuya grup adı olarak kalır. */
function ToolGroup({
  title,
  tools,
  hideTitle = false,
}: {
  title: string;
  tools: ToolDef[];
  hideTitle?: boolean;
}) {
  if (!tools.length) return null;
  return (
    <div role="group" aria-label={title} className={cn('space-y-0.5', hideTitle && 'pt-2 first:pt-0')}>
      {!hideTitle && (
        <h3 className="px-2 pt-2 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
          {title}
        </h3>
      )}
      {tools.map((tool) => (
        <ToolLink key={tool.id} tool={tool} />
      ))}
    </div>
  );
}

function ToolNav() {
  const [query, setQuery] = useState('');
  const favorites = useToolsStore((s) => s.favorites);
  const t = useT('tools');
  // Arama etkin dildeki ad ve anahtar kelimelerle yapılır; dil değişince `t` yenilenir.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const results = useMemo(() => searchTools(query), [query, t]);
  const byIds = (ids: string[]) =>
    ids.map((id) => findTool(id)).filter((tool): tool is ToolDef => Boolean(tool));
  // Menü etkin dildeki ada göre alfabetik (Türkçede İ/ı, ç/ş kurallarıyla); arama sonuçları eşleşme sırasında kalır.
  const alphabetical = (tools: ToolDef[]) => [...tools].sort((a, b) => compareText(a.name, b.name));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allTools = useMemo(() => alphabetical(TOOLS), [t]);

  return (
    <aside
      aria-label={t('nav.title')}
      className="flex w-60 shrink-0 flex-col border-e border-line bg-surface"
    >
      <div className="border-b border-line p-2">
        <Link to="/tools" className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold">
          <Wrench className="h-4 w-4" /> {t('nav.title')}
        </Link>
        <div className="relative">
          <Search className="pointer-events-none absolute start-2 top-2 h-3.5 w-3.5 text-fg-subtle" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('nav.search')}
            aria-label={t('nav.search')}
            className="h-8 ps-7 text-[13px]"
          />
        </div>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto p-2">
        {query ? (
          results.length ? (
            <ToolGroup title={t('nav.results')} tools={results} />
          ) : (
            <p className="px-2 py-3 text-xs text-fg-subtle">{t('nav.noMatch')}</p>
          )
        ) : (
          <>
            <ToolGroup title={t('nav.favorites')} tools={alphabetical(byIds(favorites))} />
            <ToolGroup title={t('nav.title')} tools={allTools} hideTitle />
          </>
        )}
      </nav>
      <p className="border-t border-line p-2 text-[11px] leading-snug text-fg-subtle">{t('nav.localNote')}</p>
    </aside>
  );
}

function ToolsHome() {
  const t = useT('tools');
  const remember = useToolsStore((s) => s.rememberInputs);
  const setRemember = useToolsStore((s) => s.setRememberInputs);
  const clearInputs = useToolsStore((s) => s.clearInputs);
  return (
    // Tam genişlik ve tek ekran: kategoriler iki sütunda, kartlar kısa tutulur.
    <div className="flex w-full flex-col gap-4 p-4">
      <header className="flex flex-wrap items-start gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold">{t('home.title')}</h1>
          <p className="text-xs text-fg-muted">{t('home.intro')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-fg-muted">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            {t('home.remember')}
          </label>
          <Button size="sm" variant="secondary" onClick={() => clearInputs()}>
            <Eraser className="h-3.5 w-3.5" /> {t('home.clearAll')}
          </Button>
        </div>
      </header>
      <SmartPaste />
      <div className="grid gap-x-6 gap-y-4 xl:grid-cols-2">
        {categories.map((category) => {
          const tools = TOOLS.filter((t) => t.category === category);
          if (!tools.length) return null;
          return (
            <section key={category} className="space-y-1.5">
              <h2 className="text-xs font-semibold text-fg-muted">{CATEGORY_LABELS[category]}</h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2">
                {tools.map((tool) => (
                  <Link
                    key={tool.id}
                    to={`/tools/${tool.id}`}
                    title={tool.description}
                    className="rounded-md border border-line px-3 py-2 hover:border-accent/50 hover:bg-muted"
                  >
                    <div className="text-[13px] font-medium">{tool.name}</div>
                    <div className="truncate text-xs text-fg-muted">{tool.description}</div>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ToolView({ tool }: { tool: ToolDef }) {
  const t = useT('tools');
  const favorite = useToolsStore((s) => s.favorites.includes(tool.id));
  const toggleFavorite = useToolsStore((s) => s.toggleFavorite);
  const markUsed = useToolsStore((s) => s.markUsed);
  const clearInputs = useToolsStore((s) => s.clearInputs);
  useEffect(() => markUsed(tool.id), [tool.id, markUsed]);
  const ToolComponent = tool.component;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold">{tool.name}</h1>
          <p className="text-xs text-fg-muted">{tool.description}</p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => toggleFavorite(tool.id)}
          aria-pressed={favorite}
          aria-label={favorite ? t('view.removeFavorite') : t('view.addFavorite')}
          title={favorite ? t('view.removeFavorite') : t('view.addFavorite')}
        >
          <Star className={cn('h-4 w-4', favorite && 'fill-current text-warning')} />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => clearInputs(tool.id)} title={t('view.clearTool')}>
          <Eraser className="h-3.5 w-3.5" /> {t('view.clear')}
        </Button>
      </header>
      {/* Araç değişince bileşen durumu ve hata sınırı sıfırlansın. */}
      <ToolErrorBoundary key={tool.id} onClear={() => clearInputs(tool.id)}>
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center">
              <Spinner className="h-4 w-4" />
            </div>
          }
        >
          <ToolComponent />
        </Suspense>
      </ToolErrorBoundary>
    </div>
  );
}

export function ToolsPage() {
  const t = useT('tools');
  const { toolId } = useParams();
  const tool = findTool(toolId);
  return (
    <div className="flex min-h-0 flex-1">
      <ToolNav />
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {tool ? (
          <ToolView tool={tool} />
        ) : toolId ? (
          <div className="p-6 text-sm text-fg-muted">
            {t('view.notFound')}{' '}
            <Link className="text-accent underline" to="/tools">
              {t('view.allTools')}
            </Link>
          </div>
        ) : (
          <ToolsHome />
        )}
      </div>
    </div>
  );
}
