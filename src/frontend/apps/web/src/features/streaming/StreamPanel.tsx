import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Info,
  Plug,
  Radio,
  Search,
  Trash2,
  Zap,
} from 'lucide-react';
import { Kbd, Spinner, cn } from '@apivator/ui';
import { formatBytes, prettyJson } from '@apivator/core';
import { formatTime, toLower, useT } from '../../i18n';
import { CopyButton } from '../../components/ui/CopyButton';
import { MAX_ITEMS, useStreams, type StreamItem, type StreamSession } from './streamStore';

const toolButton =
  'flex items-center gap-1 rounded px-2 py-1 text-xs text-fg-subtle hover:bg-muted hover:text-fg disabled:opacity-50';

function clock(at: string) {
  const d = new Date(at);
  return `${formatTime(d)}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function StatusBadge({ session }: { session: StreamSession }) {
  const t = useT('streaming');
  const label =
    session.kind === 'Grpc' && session.grpcStatus
      ? session.grpcStatus.name
      : session.status === 'connecting'
        ? session.kind === 'Grpc'
          ? t('status.calling')
          : t('status.connecting')
        : session.status === 'open'
          ? session.kind === 'Sse'
            ? t('status.listening')
            : session.kind === 'Grpc'
              ? t('status.callActive')
              : t('status.connected')
          : session.status === 'error'
            ? t('status.error')
            : t('status.closed');
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs font-medium',
        session.status === 'open' && 'bg-success/10 text-success',
        session.status === 'connecting' && 'bg-accent/10 text-accent',
        session.status === 'error' && 'bg-danger/10 text-danger',
        session.status === 'closed' &&
          (session.grpcStatus?.code === 0 ? 'bg-success/10 text-success' : 'bg-muted text-fg-muted'),
      )}
    >
      {session.status === 'connecting' ? (
        <Spinner className="h-3 w-3" />
      ) : (
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            session.status === 'open' ? 'animate-pulse bg-success' : 'bg-current',
          )}
        />
      )}
      {label}
    </span>
  );
}

function ItemRow({ item, binaryLabel }: { item: StreamItem; binaryLabel: boolean }) {
  const t = useT('streaming');
  const [open, setOpen] = useState(false);
  const formatted = useMemo(() => (open ? prettyJson(item.data) : null), [open, item.data]);
  const system = item.direction === 'info' || item.direction === 'error';
  const Icon =
    item.direction === 'in'
      ? ArrowDownLeft
      : item.direction === 'out'
        ? ArrowUpRight
        : item.direction === 'error'
          ? AlertTriangle
          : Info;

  return (
    <li
      className={cn(
        'group border-b border-line/60 text-[12.5px]',
        item.direction === 'error' && 'bg-danger/5',
      )}
    >
      <div className="flex items-start gap-2 px-3 py-1">
        <Icon
          className={cn(
            'mt-0.5 h-3.5 w-3.5 shrink-0',
            item.direction === 'in' && 'text-success',
            item.direction === 'out' && 'text-accent',
            item.direction === 'info' && 'text-fg-subtle',
            item.direction === 'error' && 'text-danger',
          )}
          aria-label={
            item.direction === 'in'
              ? t('item.incoming')
              : item.direction === 'out'
                ? t('item.outgoing')
                : item.direction === 'error'
                  ? t('item.error')
                  : t('item.info')
          }
        />
        <span className="shrink-0 font-mono text-[11px] text-fg-subtle tabular-nums">{clock(item.at)}</span>
        {item.event && item.event !== 'message' && (
          <span className="shrink-0 rounded bg-muted px-1 font-mono text-[11px] text-fg-muted">
            {item.event}
          </span>
        )}
        {system ? (
          <span
            className={cn('min-w-0 flex-1', item.direction === 'error' ? 'text-danger' : 'text-fg-muted')}
          >
            {item.data}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="min-w-0 flex-1 truncate text-start font-mono text-fg"
            title={open ? t('item.collapse') : t('item.expand')}
          >
            {item.binary && binaryLabel && (
              <span className="me-1.5 rounded bg-warning/15 px-1 font-sans text-[10.5px] text-warning">
                {t('item.binary')}
              </span>
            )}
            {item.data || <span className="text-fg-subtle italic">{t('item.empty')}</span>}
          </button>
        )}
        {!system && (
          <span className="flex h-[18px] shrink-0 items-center gap-1.5 text-[11px] text-fg-subtle">
            {item.eventId && <span className="font-mono">#{item.eventId}</span>}
            {item.size !== undefined && <span>{formatBytes(item.size)}</span>}
            <span className="-my-2 flex opacity-0 group-hover:opacity-100 focus-within:opacity-100 [&_button]:h-6 [&_button]:w-6">
              <CopyButton compact text={item.data} label={t('item.copy')} />
            </span>
          </span>
        )}
      </div>
      {open && formatted && (
        <pre className="mx-3 mb-2 ms-9 max-h-80 overflow-auto rounded-md border border-line bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap text-fg">
          {item.binary ? item.data : formatted.text}
        </pre>
      )}
    </li>
  );
}

/** SSE olaylarının ve WebSocket mesajlarının canlı listesi. */
export function StreamPanel({ tabId, kind }: { tabId: string; kind: 'Sse' | 'WebSocket' | 'Grpc' }) {
  const t = useT('streaming');
  const session = useStreams((s) => s.sessions[tabId]);
  const clear = useStreams((s) => s.clear);
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState<'all' | 'in' | 'out'>('all');
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const items = useMemo(() => {
    const all = session?.items ?? [];
    const q = toLower(query.trim());
    return all.filter(
      (i) =>
        (direction === 'all' ||
          i.direction === direction ||
          i.direction === 'info' ||
          i.direction === 'error') &&
        (!q || toLower(i.data).includes(q) || toLower(i.event ?? '').includes(q)),
    );
  }, [session?.items, query, direction]);

  // Kullanıcı yukarı kaydırmadıysa yeni öğelerde en alta kayar.
  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items.length]);

  if (!session) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-sm text-fg-subtle">
        {kind === 'Sse' ? (
          <Radio className="h-7 w-7 opacity-50" aria-hidden="true" />
        ) : kind === 'Grpc' ? (
          <Zap className="h-7 w-7 opacity-50" aria-hidden="true" />
        ) : (
          <Plug className="h-7 w-7 opacity-50" aria-hidden="true" />
        )}
        <p>
          {kind === 'Sse' ? t('panel.emptySse') : kind === 'Grpc' ? t('panel.emptyGrpc') : t('panel.emptyWs')}
        </p>
        <span className="flex items-center gap-1.5 text-xs">
          <Kbd>Ctrl</Kbd>
          <Kbd>Enter</Kbd>
        </span>
      </div>
    );
  }

  const received = session.items.filter((i) => i.direction === 'in').length;
  const sent = session.items.filter((i) => i.direction === 'out').length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-1.5 text-xs">
        <StatusBadge session={session} />
        {session.httpStatus !== null && (
          <span className="font-mono text-fg-muted">
            {session.httpStatus} {session.statusText}
          </span>
        )}
        {session.protocol && (
          <span className="text-fg-muted">{t('panel.protocol', { protocol: session.protocol })}</span>
        )}
        {session.grpcStatus && session.grpcStatus.timeMs > 0 && (
          <span className="text-fg-muted">{Math.round(session.grpcStatus.timeMs)} ms</span>
        )}
        <span className="text-fg-subtle">
          {kind === 'Sse' ? t('panel.events', { count: received }) : t('panel.counts', { received, sent })}
          {session.dropped > 0 && ` · ${t('panel.dropped', { count: session.dropped, max: MAX_ITEMS })}`}
        </span>
        <div className="ms-auto flex items-center gap-1">
          {kind !== 'Sse' && (
            <div
              className="flex rounded-md border border-line p-0.5"
              role="group"
              aria-label={t('panel.direction')}
            >
              {(
                [
                  ['all', t('panel.all')],
                  ['in', t('item.incoming')],
                  ['out', t('item.outgoing')],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={direction === id}
                  onClick={() => setDirection(id)}
                  className={cn(
                    'rounded px-1.5 py-0.5',
                    direction === id
                      ? 'bg-accent/10 font-medium text-accent'
                      : 'text-fg-muted hover:bg-muted',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <label className="flex items-center gap-1 rounded-md border border-line px-1.5">
            <Search className="h-3 w-3 text-fg-subtle" aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('panel.search')}
              aria-label={t('panel.searchLabel')}
              className="h-6 w-28 bg-transparent text-xs focus:outline-none"
            />
          </label>
          <button
            type="button"
            className={toolButton}
            onClick={() => clear(tabId)}
            disabled={session.items.length === 0}
          >
            <Trash2 className="h-3.5 w-3.5" /> {t('panel.clear')}
          </button>
        </div>
      </div>
      <div
        ref={list}
        className="min-h-0 flex-1 overflow-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {items.length === 0 ? (
          <p className="p-6 text-center text-sm text-fg-subtle">
            {session.items.length ? t('panel.noMatch') : t('panel.noMessages')}
          </p>
        ) : (
          <ul aria-label={kind === 'Sse' ? t('panel.listEvents') : t('panel.listMessages')}>
            {items.map((item) => (
              <ItemRow key={item.id} item={item} binaryLabel={kind === 'WebSocket'} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
