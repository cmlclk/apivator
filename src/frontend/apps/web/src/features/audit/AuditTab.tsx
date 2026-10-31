import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Download, KeyRound, Search } from 'lucide-react';
import { Alert, Button, Input, Spinner, cn } from '@apivator/ui';
import { type AuditEntryDto, type AuditFilter, type OrganizationDto } from '@apivator/core';
import { toLower, useT, type MessageKey } from '../../i18n';
import trAudit from '../../i18n/locales/tr/audit.json';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { saveFile } from '../../lib/download';
import { selectClass } from '../../lib/teams';
import { fullTime, timeAgo } from '../activity/activity';

const auditQueryKey = (organizationId: string, filter: AuditFilter) =>
  ['organizations', organizationId, 'audit', filter] as const;

type AuditKey = MessageKey<'audit'>;

/** Bilinen olay kodları, kategoriler ve ayrıntı alanları (Türkçe dosya kaynak dildir); bilinmeyenler olduğu gibi gösterilir. */
const KNOWN_ACTIONS = new Set(
  Object.entries(trAudit.actions).flatMap(([group, items]) => Object.keys(items).map((k) => `${group}.${k}`)),
);
const CATEGORY_IDS = Object.keys(trAudit.categories);
const DATA_KEYS = new Set(Object.keys(trAudit.dataLabels));

/** Cümle içinde kullanılacağı için ilk harfi küçültür (API gibi kısaltmalara dokunmaz). */
function lowerFirst(text: string): string {
  return /^\p{Lu}\p{Lu}/u.test(text) ? text : toLower(text.slice(0, 1)) + text.slice(1);
}

/** "2026-10-23" (yerel gün) → gün başı/sonu ISO; sunucu UTC karşılaştırır. */
function dayBoundary(day: string, end: boolean): string | undefined {
  if (!day) return undefined;
  const date = new Date(`${day}T${end ? '23:59:59.999' : '00:00:00'}`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function Details({ entry }: { entry: AuditEntryDto }) {
  const t = useT('audit');
  const rows: [string, string][] = [
    ...Object.entries(entry.data).map(
      ([k, v]) => [DATA_KEYS.has(k) ? t(`dataLabels.${k}` as AuditKey) : k, v] as [string, string],
    ),
    [t('details.actor'), entry.actorEmail ? `${entry.actorName} (${entry.actorEmail})` : entry.actorName],
    ...(entry.viaApiKey ? [[t('details.method'), t('details.apiKey')] as [string, string]] : []),
    ...(entry.ipAddress ? [[t('details.ip'), entry.ipAddress] as [string, string]] : []),
    ...(entry.device ? [[t('details.device'), entry.device] as [string, string]] : []),
    [t('details.code'), entry.action],
    [t('details.time'), fullTime(entry.createdAt)],
  ];
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 px-10 pb-3 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-fg-subtle">{k}</dt>
          <dd className="min-w-0 break-words font-mono text-fg-muted">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function EntryRow({ entry }: { entry: AuditEntryDto }) {
  const t = useT('audit');
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  const context = [entry.workspaceName, entry.ipAddress].filter(Boolean).join(' · ');
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-3 px-3 py-2 text-start hover:bg-muted/50"
      >
        <Chevron className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px]">
            <span className="font-medium">{entry.actorName}</span>{' '}
            <span className="text-fg-muted">
              {KNOWN_ACTIONS.has(entry.action)
                ? lowerFirst(t(`actions.${entry.action}` as AuditKey))
                : entry.action}
            </span>
            {entry.targetName !== '—' && <span className="font-medium">: {entry.targetName}</span>}
            {entry.viaApiKey && (
              <KeyRound className="ms-1 inline h-3 w-3 text-fg-subtle" aria-label={t('viaApiKey')} />
            )}
          </span>
          {context && <span className="block truncate text-xs text-fg-subtle">{context}</span>}
        </span>
        <span className="shrink-0 text-xs text-fg-subtle" title={fullTime(entry.createdAt)}>
          {timeAgo(entry.createdAt)}
        </span>
      </button>
      {open && <Details entry={entry} />}
    </li>
  );
}

/**
 * Organizasyonun denetim kaydı (yalnızca sahip ve yöneticiler): üyelik, rol, takım, workspace, collection erişimi,
 * yayınlar, API anahtarları ve yönetici işlemleri. Süzülür, sayfa sayfa yüklenir, CSV/JSON olarak indirilir.
 */
export function AuditTab({ organization }: { organization: OrganizationDto }) {
  const t = useT('audit');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const [exporting, setExporting] = useState<'csv' | 'json' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const filter: AuditFilter = {
    action: category || undefined,
    q: submitted || undefined,
    from: dayBoundary(fromDay, false),
    to: dayBoundary(toDay, true),
  };
  const { data, error, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: auditQueryKey(organization.id, filter),
    queryFn: ({ pageParam }) => api.organizations.audit(organization.id, filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const entries = data?.pages.flatMap((p) => p.items) ?? [];
  const retention = data?.pages[0]?.retentionDays;

  async function exportAs(format: 'csv' | 'json') {
    setExporting(format);
    setExportError(null);
    try {
      await saveFile(await api.organizations.exportAudit(organization.id, format, filter));
    } catch (e) {
      setExportError(errorMessage(e));
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-fg-muted">
        {t('intro')}
        {retention ? ` ${t('retention', { days: retention })}` : ''}
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          {t('eventType')}
          <select
            aria-label={t('eventType')}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={selectClass}
          >
            <option value="">{t('all')}</option>
            {CATEGORY_IDS.map((id) => (
              <option key={id} value={id}>
                {t(`categories.${id}` as AuditKey)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          {t('from')}
          <Input
            type="date"
            aria-label={t('from')}
            value={fromDay}
            onChange={(e) => setFromDay(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          {t('to')}
          <Input type="date" aria-label={t('to')} value={toDay} onChange={(e) => setToDay(e.target.value)} />
        </label>
        <form
          className="flex min-w-48 flex-1 items-end gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(search.trim());
          }}
        >
          <Input
            aria-label={t('searchLabel')}
            placeholder={t('searchPlaceholder')}
            value={search}
            maxLength={200}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button type="submit" size="sm" variant="ghost" aria-label={t('searchButton')}>
            <Search className="h-3.5 w-3.5" />
          </Button>
        </form>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="secondary"
            disabled={exporting !== null}
            onClick={() => void exportAs('csv')}
          >
            {exporting === 'csv' ? <Spinner className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}{' '}
            CSV
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={exporting !== null}
            onClick={() => void exportAs('json')}
          >
            {exporting === 'json' ? (
              <Spinner className="h-3.5 w-3.5" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}{' '}
            JSON
          </Button>
        </div>
      </div>
      {exportError && <Alert tone="error">{exportError}</Alert>}

      {isLoading ? (
        <Spinner className="mx-auto h-4 w-4 text-fg-subtle" />
      ) : error ? (
        <Alert tone="error">{errorMessage(error)}</Alert>
      ) : (
        <ul aria-label={t('list')} className={cn('divide-y divide-line rounded-md border border-line')}>
          {entries.map((e) => (
            <EntryRow key={e.id} entry={e} />
          ))}
          {entries.length === 0 && (
            <li className="px-3 py-4 text-center text-xs text-fg-subtle">{t('empty')}</li>
          )}
        </ul>
      )}
      {hasNextPage && (
        <Button
          size="sm"
          variant="ghost"
          className="self-center"
          disabled={isFetchingNextPage}
          onClick={() => void fetchNextPage()}
        >
          {isFetchingNextPage ? <Spinner className="h-3.5 w-3.5" /> : t('older')}
        </Button>
      )}
    </div>
  );
}
