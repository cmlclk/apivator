import { useMemo, type ReactNode } from 'react';
import { cn } from '@apivator/ui';
import {
  searchHttpHeaders,
  searchHttpStatuses,
  searchMimeTypes,
  type HttpStatusClass,
} from '@apivator/core/tools';
import { SegmentedTabs } from '../../../components/ui/SegmentedTabs';
import { useT, type TFunction } from '../../../i18n';
import { ToolOptions } from '../ToolLayout';
import { toolLabelClass, toolSelectClass } from '../toolUtils';
import { useToolInput } from '../toolsStore';
import { HeaderDetail, MimeDetail, StatusCode, StatusDetail } from './httpReferenceDetail';
import { unitInputClass } from './unitToolParts';

const TOOL = 'http-reference';

type Tab = 'status' | 'headers' | 'mime';

const TAB_IDS: Tab[] = ['status', 'headers', 'mime'];

const STATUS_CLASSES: HttpStatusClass[] = ['1xx', '2xx', '3xx', '4xx', '5xx'];

function filterOptions(tab: Tab, t: TFunction<'toolsMisc'>): { value: string; label: string }[] {
  const all = { value: '', label: t('httpReference.all') };
  if (tab === 'status')
    return [
      all,
      ...STATUS_CLASSES.map((value) => ({ value, label: t(`httpReference.statusClasses.${value}`) })),
    ];
  if (tab === 'headers')
    return [
      all,
      { value: 'request', label: t('httpReference.requestHeaders') },
      { value: 'response', label: t('httpReference.responseHeaders') },
    ];
  return [
    all,
    { value: 'text', label: t('httpReference.textBased') },
    { value: 'binary', label: t('httpReference.binary') },
  ];
}

interface Item {
  id: string;
  title: ReactNode;
  subtitle: string;
  detail: ReactNode;
}

function useItems(tab: Tab, query: string, filter: string): Item[] {
  return useMemo(() => {
    if (tab === 'status')
      return searchHttpStatuses(query, (filter || undefined) as HttpStatusClass | undefined).map((s) => ({
        id: String(s.code),
        title: (
          <>
            <StatusCode code={s.code} className="font-semibold" /> {s.phrase}
          </>
        ),
        subtitle: s.name,
        detail: <StatusDetail status={s} />,
      }));
    if (tab === 'headers')
      return searchHttpHeaders(query, (filter || undefined) as 'request' | 'response' | undefined).map(
        (h) => ({
          id: h.name,
          title: h.name,
          subtitle: h.group,
          detail: <HeaderDetail header={h} />,
        }),
      );
    return searchMimeTypes(query)
      .filter((m) => !filter || (filter === 'text') === m.textLike)
      .map((m) => ({
        id: m.type,
        title: m.type,
        subtitle: m.extensions.map((e) => `.${e}`).join(' '),
        detail: <MimeDetail mime={m} />,
      }));
  }, [tab, query, filter]);
}

/** Çevrimdışı HTTP başvurusu: durum kodları, başlıklar ve MIME türleri; arama ve ayrıntı paneli. */
export default function HttpReferenceTool() {
  const t = useT('toolsMisc');
  const [savedTab, setTab] = useToolInput(TOOL, 'tab', 'status');
  const tab = (TAB_IDS.some((id) => id === savedTab) ? savedTab : 'status') as Tab;
  const tabs = TAB_IDS.map((id) => ({ id, label: t(`httpReference.tabs.${id}`) }));
  const [query, setQuery] = useToolInput(TOOL, `query-${tab}`);
  const [filter, setFilter] = useToolInput(TOOL, `filter-${tab}`);
  const [selected, setSelected] = useToolInput(TOOL, `selected-${tab}`);
  const items = useItems(tab, query, filter);
  const active = items.find((i) => i.id === selected) ?? items[0];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <SegmentedTabs tabs={tabs} value={tab} onChange={setTab} label={t('httpReference.kind')} />
      <ToolOptions>
        <input
          type="search"
          className={cn(unitInputClass, 'max-w-sm')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            tab === 'status'
              ? t('httpReference.searchStatus')
              : tab === 'headers'
                ? t('httpReference.searchHeaders')
                : t('httpReference.searchMime')
          }
          aria-label={t('httpReference.search')}
        />
        <label className={toolLabelClass}>
          {tab === 'status'
            ? t('httpReference.filterClass')
            : tab === 'headers'
              ? t('httpReference.filterDirection')
              : t('httpReference.filterType')}
          <select className={toolSelectClass} value={filter} onChange={(e) => setFilter(e.target.value)}>
            {filterOptions(tab, t).map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-fg-subtle">{t('httpReference.results', { count: items.length })}</span>
      </ToolOptions>
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        <ul
          className="min-h-0 overflow-auto rounded-md border border-line lg:w-80 lg:shrink-0"
          aria-label={t('httpReference.resultsList')}
        >
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-pressed={item === active}
                onClick={() => setSelected(item.id)}
                className={cn(
                  'flex w-full flex-col items-start border-b border-line px-3 py-1.5 text-start last:border-b-0',
                  item === active ? 'bg-accent/10' : 'hover:bg-muted',
                )}
              >
                <span className="font-mono text-[12.5px] break-all text-fg">{item.title}</span>
                {item.subtitle && <span className="text-[11.5px] text-fg-muted">{item.subtitle}</span>}
              </button>
            </li>
          ))}
          {!items.length && <li className="px-3 py-2 text-xs text-fg-muted">{t('httpReference.noMatch')}</li>}
        </ul>
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">{active?.detail}</div>
      </div>
    </div>
  );
}
