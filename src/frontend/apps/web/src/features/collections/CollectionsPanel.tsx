import { lazy, Suspense, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import {
  BookOpen,
  Library,
  ChevronRight,
  Code2,
  Copy,
  Download,
  FileJson,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  FolderTree,
  MessageSquare,
  ArrowRightLeft,
  Play,
  RefreshCw,
  KeyRound,
  Variable as VariableIcon,
  Pencil,
  Plus,
  Server,
  HeartPulse,
  GitFork,
  GitCompareArrows,
  GitBranch,
  Lock,
  Shield,
  Trash2,
  Upload,
} from 'lucide-react';
import { Alert, Button, Spinner, cn } from '@apivator/ui';
import {
  emptyDefinition,
  type CollectionTreeDto,
  type ExampleSummaryDto,
  type FolderDto,
  type RequestSummaryDto,
} from '@apivator/core';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useT } from '../../i18n';
import { AuthSettingsDialog } from './AuthSettingsDialog';
import { MoveCollectionDialog } from './MoveCollectionDialog';
import { CollectionAccessDialog } from './CollectionAccessDialog';
import { canEditCollection } from './collectionAccess';
import { useCommentCounts, useCommentsPanel } from '../activity/activity';
import { ExampleDialog } from './ExampleDialog';
import { ScriptsDialog } from '../scripts/ScriptsDialog';
import { mocksQueryKey, useMockUi } from '../mocks/useMocks';
import { useWorkspaceForks } from '../forks/useForks';
import type { ForkInfoDto } from '@apivator/core';
import { monitorsQueryKey, useMonitorUi } from '../monitors/useMonitors';
import { VariablesDialog } from '../environments/VariablesDialog';
import { scopeKeys, useEnvironmentStore } from '../environments/environmentStore';
import { InlineEdit } from '../../components/ui/InlineEdit';
import { Menu } from '../../components/ui/Menu';
import { api } from '../../lib/api';
import { saveFile } from '../../lib/download';
import { SourceDialogHost } from '../importExport/SourceDialogHost';
import { useSourceUi } from '../importExport/sourceUi';
import { errorMessage } from '../../lib/errors';
import { useWorkspaces } from '../../lib/useWorkspaces';
import { useUi } from '../../stores/ui';
import { methodColor, methodLabel } from '../requests/methodColors';
import { openApiAsYaml } from '../importExport/openApiExport';
import { useTabs } from '../requests/tabsStore';
import { dropPosition, planMove, type DragItem, type DropPosition, type DropTarget } from './dragDrop';
import {
  buildTree,
  collectionsQueryKey,
  requestIdsUnder,
  useCollections,
  type TreeNode,
} from './useCollections';
import { loadRequest } from '../../lib/offlineCache';
import { isLocalMode } from '../../lib/localMode';

type PendingDelete =
  | { kind: 'collection'; collection: CollectionTreeDto }
  | { kind: 'folder'; collection: CollectionTreeDto; folder: FolderDto }
  | { kind: 'request'; request: RequestSummaryDto }
  | { kind: 'example'; example: ExampleSummaryDto };

const INDENT = 14;

const bold = (c: ReactNode) => <strong className="text-fg">{c}</strong>;

// Seyrek açılan diyaloglar ana pakete girmez; ilk açılışta yüklenir.
const RunnerDialog = lazy(() => import('../runner/RunnerDialog').then((m) => ({ default: m.RunnerDialog })));
const MockSettingsDialog = lazy(() =>
  import('../mocks/MockSettingsDialog').then((m) => ({ default: m.MockSettingsDialog })),
);
const MonitorSettingsDialog = lazy(() =>
  import('../monitors/MonitorSettingsDialog').then((m) => ({ default: m.MonitorSettingsDialog })),
);
const ForkCollectionDialog = lazy(() =>
  import('../forks/ForkCollectionDialog').then((m) => ({ default: m.ForkCollectionDialog })),
);
const GitSyncDialog = lazy(() =>
  import('../gitsync/GitSyncDialog').then((m) => ({ default: m.GitSyncDialog })),
);
const ForkStatusDialog = lazy(() =>
  import('../forks/ForkStatusDialog').then((m) => ({ default: m.ForkStatusDialog })),
);
const ImportDialog = lazy(() =>
  import('../importExport/ImportDialog').then((m) => ({ default: m.ImportDialog })),
);

// Markdown kütüphanesi yalnızca açıklama açılınca yüklenir.
const DescriptionDialog = lazy(() =>
  import('./DescriptionDialog').then((m) => ({ default: m.DescriptionDialog })),
);

interface DropProps {
  /** Bu satırın bırakma hedefi; sürüklenemez/bırakılamaz satırda undefined. */
  target?: DropTarget;
  /** Bu satır sürüklenebiliyorsa sürüklenen öğe. */
  item?: DragItem;
}

function Row({
  depth,
  active,
  onClick,
  icon,
  label,
  trailing,
  editing,
  onRename,
  onCancelRename,
  menu,
  expanded,
  drop,
  dropIndicator,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  depth: number;
  active?: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  trailing?: ReactNode;
  editing: boolean;
  onRename: (name: string) => void;
  onCancelRename: () => void;
  menu: ReactNode;
  expanded?: boolean;
  drop?: DropProps;
  dropIndicator?: DropPosition | null;
  onDragStart?: (e: DragEvent) => void;
  onDragOver?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
  onDragEnd?: () => void;
}) {
  return (
    <div
      role="treeitem"
      aria-selected={active}
      aria-expanded={expanded}
      tabIndex={0}
      draggable={!!drop?.item && !editing}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && !editing && onClick()}
      style={{ paddingLeft: 8 + depth * INDENT }}
      className={cn(
        'group relative flex h-7 cursor-pointer items-center gap-1.5 pe-1.5 text-[13px] focus:outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-inset',
        active ? 'bg-accent/10 text-fg' : 'text-fg-muted hover:bg-muted hover:text-fg',
        dropIndicator === 'inside' && 'bg-accent/15 ring-1 ring-accent/60 ring-inset',
      )}
    >
      {dropIndicator === 'before' && (
        <span className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-accent" />
      )}
      {dropIndicator === 'after' && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-accent" />
      )}
      {icon}
      {editing ? (
        <InlineEdit value={label} onSubmit={onRename} onCancel={onCancelRename} />
      ) : (
        <span className="min-w-0 flex-1 truncate">{label}</span>
      )}
      {!editing && trailing}
      {!editing && (
        <div className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">{menu}</div>
      )}
    </div>
  );
}

function statusColor(status: number) {
  if (status < 300) return 'text-success';
  if (status < 400) return 'text-accent';
  if (status < 500) return 'text-warning';
  return 'text-danger';
}

export function CollectionsPanel() {
  const t = useT('collections');
  const { current } = useWorkspaces();
  const workspaceId = current?.id;
  // Workspace düzeyindeki işler (yeni collection, içe aktarma, mock, monitör) workspace rolüne; bir collection'ın
  // içeriğini değiştirmek o collection'daki role bağlıdır (collection rolleri workspace rolünü daraltabilir).
  const canEditWorkspace = current?.role !== 'Viewer';
  const navigate = useNavigate();
  const editable = (c: CollectionTreeDto | undefined) => canEditCollection(c, current?.role);
  const [accessTarget, setAccessTarget] = useState<CollectionTreeDto | null>(null);
  const { data: commentCounts } = useCommentCounts(current?.id);
  const { data: collections, isLoading, error } = useCollections(workspaceId);
  const { data: forks } = useWorkspaceForks(workspaceId);
  const [gitTarget, setGitTarget] = useState<CollectionTreeDto | null>(null);
  const [forkTarget, setForkTarget] = useState<CollectionTreeDto | null>(null);
  const [forkStatus, setForkStatus] = useState<ForkInfoDto | null>(null);
  const queryClient = useQueryClient();
  const expanded = useUi((s) => s.expanded);
  const setExpanded = useUi((s) => s.setExpanded);
  const activeRequestId = useTabs((s) => s.tabs.find((t) => t.id === s.activeTabId)?.requestId ?? null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [variablesTarget, setVariablesTarget] = useState<CollectionTreeDto | null>(null);
  const [descriptionTarget, setDescriptionTarget] = useState<{
    collection: CollectionTreeDto;
    folder?: FolderDto;
  } | null>(null);
  const [openExample, setOpenExample] = useState<string | null>(null);
  const [runTarget, setRunTarget] = useState<{
    collection: CollectionTreeDto;
    folderId: string | null;
  } | null>(null);
  const [scriptsTarget, setScriptsTarget] = useState<
    { kind: 'collection'; collection: CollectionTreeDto } | { kind: 'folder'; folder: FolderDto } | null
  >(null);
  const currentValues = useEnvironmentStore((s) => s.currentValues);
  const [authTarget, setAuthTarget] = useState<
    { kind: 'collection'; collection: CollectionTreeDto } | { kind: 'folder'; folder: FolderDto } | null
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<CollectionTreeDto | null>(null);
  const [mockTarget, setMockTarget] = useState<CollectionTreeDto | null>(null);
  const [monitorTarget, setMonitorTarget] = useState<CollectionTreeDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const dragging = useRef<DragItem | null>(null);
  const [indicator, setIndicator] = useState<{ key: string; position: DropPosition } | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: collectionsQueryKey(workspaceId) });

  async function run(action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      await refresh();
    }
  }

  const createCollection = () =>
    run(async () => {
      setBusy(true);
      try {
        const created = await api.collections.create(workspaceId!, t('tree.newCollection'));
        setExpanded(created.id, true);
        setRenaming(created.id);
      } finally {
        setBusy(false);
      }
    });

  const createFolder = (collectionId: string, parentFolderId: string | null) =>
    run(async () => {
      const folder = await api.folders.create(collectionId, t('tree.newFolder'), parentFolderId);
      setExpanded(collectionId, true);
      if (parentFolderId) setExpanded(parentFolderId, true);
      setRenaming(folder.id);
    });

  const createRequest = (collectionId: string, folderId: string | null) =>
    run(async () => {
      const request = await api.requests.create(
        collectionId,
        t('tree.newRequest'),
        folderId,
        emptyDefinition(),
      );
      setExpanded(collectionId, true);
      if (folderId) setExpanded(folderId, true);
      useTabs.getState().openSaved(workspaceId!, request);
    });

  const openRequest = (request: RequestSummaryDto) =>
    run(async () => {
      const existing = useTabs.getState().tabs.find((t) => t.requestId === request.id);
      if (existing) {
        useTabs.getState().activate(existing.id);
        return;
      }
      useTabs.getState().openSaved(workspaceId!, await loadRequest(request.id));
    });

  const renameRequest = (id: string, name: string) =>
    run(async () => {
      const latest = await loadRequest(id);
      const saved = await api.requests.update(id, name, latest.definition, latest.version);
      useTabs.getState().syncName(id, saved.name, saved.version);
    });

  const duplicateRequest = (request: RequestSummaryDto) =>
    run(async () => {
      const copy = await api.requests.duplicate(request.id);
      setRenaming(copy.id);
    });

  async function confirmDelete(target: PendingDelete) {
    if (target.kind === 'collection') {
      await api.collections.remove(target.collection.id);
      useTabs.getState().closeByRequestIds(target.collection.requests.map((r) => r.id));
    } else if (target.kind === 'folder') {
      await api.folders.remove(target.folder.id);
      useTabs.getState().closeByRequestIds(requestIdsUnder(target.collection, target.folder.id));
    } else if (target.kind === 'request') {
      await api.requests.remove(target.request.id);
      useTabs.getState().closeByRequestIds([target.request.id]);
    } else {
      await api.examples.remove(target.example.id);
    }
    await refresh();
  }

  // --- Sürükle-bırak ---------------------------------------------------------------------------------

  const keyOf = (target: DropTarget) =>
    target.kind === 'collection'
      ? target.collectionId
      : target.kind === 'folder'
        ? target.folder.id
        : target.request.id;

  function dragHandlers(item: DragItem | undefined, target: DropTarget) {
    // Düzenlenemeyen collection'dan sürüklenemez, ona bırakılamaz.
    if (!editable(collections?.find((c) => c.id === target.collectionId))) return {};
    const key = keyOf(target);
    return {
      drop: { item, target },
      dropIndicator: indicator?.key === key ? indicator.position : null,
      onDragStart: (e: DragEvent) => {
        if (!item) return;
        e.stopPropagation();
        dragging.current = item;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.id);
      },
      onDragOver: (e: DragEvent) => {
        const drag = dragging.current;
        if (!drag || !collections) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const position = dropPosition(drag, target, (e.clientY - rect.top) / rect.height);
        if (!position || !planMove(drag, target, position, collections)) {
          if (indicator?.key === key) setIndicator(null);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        if (indicator?.key !== key || indicator.position !== position) setIndicator({ key, position });
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const drag = dragging.current;
        const position = indicator?.key === key ? indicator.position : null;
        dragging.current = null;
        setIndicator(null);
        if (!drag || !position || !collections) return;
        const plan = planMove(drag, target, position, collections);
        if (!plan) return;
        void run(async () => {
          const { syncMoved, tabs } = useTabs.getState();
          if (plan.kind === 'request') {
            const moved = await api.requests.move(plan.id, plan.folderId, plan.index, plan.collectionId);
            syncMoved(moved.id, moved.collectionId, moved.version);
            if (plan.folderId) setExpanded(plan.folderId, true);
          } else {
            const source = collections.find((c) => c.id === drag.collectionId);
            await api.folders.move(plan.id, plan.parentFolderId, plan.index, plan.collectionId);
            if (plan.parentFolderId) setExpanded(plan.parentFolderId, true);
            // Başka collection'a geçen klasördeki isteklerin sürümü de değişir; açık sekmeleri eşitle.
            if (source && plan.collectionId !== source.id) {
              const moved = new Set(requestIdsUnder(source, plan.id));
              for (const tab of tabs.filter((t) => t.requestId && moved.has(t.requestId))) {
                const latest = await loadRequest(tab.requestId!);
                syncMoved(latest.id, latest.collectionId, latest.version);
              }
            }
          }
          setExpanded(plan.collectionId, true);
        });
      },
      onDragEnd: () => {
        dragging.current = null;
        setIndicator(null);
      },
    };
  }

  // --- Ağaç ------------------------------------------------------------------------------------------

  function renderExamples(examples: ExampleSummaryDto[], depth: number, canEdit: boolean): ReactNode {
    return examples.map((example) => (
      <Row
        key={example.id}
        depth={depth}
        onClick={() => setOpenExample(example.id)}
        icon={<FileJson className="ms-[22px] h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />}
        label={example.name}
        trailing={
          <span
            className={cn('shrink-0 font-mono text-[10.5px] group-hover:hidden', statusColor(example.status))}
          >
            {example.status}
          </span>
        }
        editing={renaming === example.id}
        onRename={(name) => {
          setRenaming(null);
          void run(async () => void (await api.examples.update(example.id, { name })));
        }}
        onCancelRename={() => setRenaming(null)}
        menu={
          <Menu
            label={t('tree.itemActions', { name: example.name })}
            items={[
              { label: t('tree.open'), icon: FileJson, onSelect: () => setOpenExample(example.id) },
              {
                label: t('tree.rename'),
                icon: Pencil,
                disabled: !canEdit,
                onSelect: () => setRenaming(example.id),
              },
              {
                label: t('tree.delete'),
                icon: Trash2,
                danger: true,
                disabled: !canEdit,
                onSelect: () => setPendingDelete({ kind: 'example', example }),
              },
            ]}
          />
        }
      />
    ));
  }

  function renderNodes(collection: CollectionTreeDto, nodes: TreeNode[], depth: number): ReactNode {
    const canEdit = editable(collection);
    return nodes.map((node) => {
      if (node.kind === 'request') {
        const r = node.request;
        const hasExamples = node.examples.length > 0;
        const examplesOpen = hasExamples && (expanded[r.id] ?? false);
        return (
          <div key={r.id} role="group">
            <Row
              depth={depth}
              active={r.id === activeRequestId}
              expanded={hasExamples ? examplesOpen : undefined}
              onClick={() => void openRequest(r)}
              icon={
                <>
                  {hasExamples ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpanded(r.id, !examplesOpen);
                      }}
                      aria-label={examplesOpen ? t('tree.hideExamples') : t('tree.showExamples')}
                      className="-ms-1 shrink-0 rounded p-0.5 hover:bg-line"
                    >
                      <ChevronRight
                        className={cn('h-3 w-3 transition-transform', examplesOpen && 'rotate-90')}
                        aria-hidden="true"
                      />
                    </button>
                  ) : (
                    <span className="w-3 shrink-0" />
                  )}
                  <span
                    className={cn(
                      'w-8 shrink-0 text-end font-mono text-[10px] font-bold',
                      methodColor(r.method, r.kind),
                    )}
                  >
                    {methodLabel(r.method, r.kind)}
                  </span>
                </>
              }
              label={r.name}
              trailing={
                commentCounts?.get(r.id) ? (
                  <span
                    className="flex shrink-0 items-center gap-0.5 pe-1 text-[10.5px] text-fg-subtle"
                    title={t('tree.openComments', { count: commentCounts.get(r.id) ?? 0 })}
                  >
                    <MessageSquare className="h-3 w-3" aria-hidden="true" />
                    {commentCounts.get(r.id)}
                  </span>
                ) : undefined
              }
              editing={renaming === r.id}
              onRename={(name) => {
                setRenaming(null);
                void renameRequest(r.id, name);
              }}
              onCancelRename={() => setRenaming(null)}
              {...dragHandlers(
                { kind: 'request', id: r.id, collectionId: collection.id },
                { kind: 'request', collectionId: collection.id, request: r },
              )}
              menu={
                <Menu
                  label={t('tree.itemActions', { name: r.name })}
                  items={[
                    {
                      label: t('tree.rename'),
                      icon: Pencil,
                      disabled: !canEdit,
                      onSelect: () => setRenaming(r.id),
                    },
                    {
                      label: t('tree.duplicate'),
                      icon: Copy,
                      disabled: !canEdit,
                      onSelect: () => void duplicateRequest(r),
                    },
                    {
                      label: t('tree.delete'),
                      icon: Trash2,
                      danger: true,
                      disabled: !canEdit,
                      onSelect: () => setPendingDelete({ kind: 'request', request: r }),
                    },
                  ]}
                />
              }
            />
            {examplesOpen && renderExamples(node.examples, depth + 1, canEdit)}
          </div>
        );
      }

      const f = node.folder;
      const open = expanded[f.id] ?? false;
      return (
        <div key={f.id} role="group">
          <Row
            depth={depth}
            expanded={open}
            onClick={() => setExpanded(f.id, !open)}
            icon={
              <>
                <ChevronRight
                  className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')}
                  aria-hidden="true"
                />
                {open ? (
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
                ) : (
                  <FolderIcon className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
                )}
              </>
            }
            label={f.name}
            editing={renaming === f.id}
            onRename={(name) => {
              setRenaming(null);
              void run(async () => void (await api.folders.update(f.id, { name })));
            }}
            onCancelRename={() => setRenaming(null)}
            {...dragHandlers(
              { kind: 'folder', id: f.id, collectionId: collection.id },
              { kind: 'folder', collectionId: collection.id, folder: f },
            )}
            menu={
              <Menu
                label={t('tree.itemActions', { name: f.name })}
                items={[
                  {
                    label: t('tree.run'),
                    icon: Play,
                    onSelect: () => setRunTarget({ collection, folderId: f.id }),
                  },
                  {
                    label: t('tree.addRequest'),
                    icon: Plus,
                    disabled: !canEdit,
                    onSelect: () => void createRequest(collection.id, f.id),
                  },
                  {
                    label: t('tree.addFolder'),
                    icon: FolderPlus,
                    disabled: !canEdit,
                    onSelect: () => void createFolder(collection.id, f.id),
                  },
                  {
                    label: t('tree.rename'),
                    icon: Pencil,
                    disabled: !canEdit,
                    onSelect: () => setRenaming(f.id),
                  },
                  {
                    label: t('tree.description'),
                    icon: BookOpen,
                    onSelect: () => setDescriptionTarget({ collection, folder: f }),
                  },
                  {
                    label: t('tree.auth'),
                    icon: KeyRound,
                    onSelect: () => setAuthTarget({ kind: 'folder', folder: f }),
                  },
                  {
                    label: t('tree.scripts'),
                    icon: Code2,
                    onSelect: () => setScriptsTarget({ kind: 'folder', folder: f }),
                  },
                  {
                    label: t('tree.duplicate'),
                    icon: Copy,
                    disabled: !canEdit,
                    onSelect: () =>
                      void run(async () => {
                        const copy = await api.folders.duplicate(f.id);
                        setRenaming(copy.id);
                      }),
                  },
                  {
                    label: t('tree.delete'),
                    icon: Trash2,
                    danger: true,
                    disabled: !canEdit,
                    onSelect: () => setPendingDelete({ kind: 'folder', collection, folder: f }),
                  },
                ]}
              />
            }
          />
          {open && renderNodes(collection, node.children, depth + 1)}
        </div>
      );
    });
  }

  return (
    <section
      aria-label={t('panel.title')}
      className="flex w-72 shrink-0 flex-col border-e border-line bg-surface"
    >
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3">
        <h2 className="text-sm font-semibold">{t('panel.title')}</h2>
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setImporting(true)}
            disabled={!workspaceId || !canEditWorkspace}
            title={t('panel.importTitle')}
            aria-label={t('panel.import')}
          >
            <Upload className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void createCollection()}
            disabled={!workspaceId || busy || !canEditWorkspace}
            title={t('panel.new')}
            aria-label={t('panel.new')}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {actionError && (
        <Alert tone="error" className="m-2 text-xs">
          {actionError}
        </Alert>
      )}

      <div role="tree" aria-label={t('panel.treeLabel')} className="min-h-0 flex-1 overflow-y-auto py-1">
        {isLoading && (
          <div className="flex justify-center py-8 text-fg-subtle">
            <Spinner className="h-4 w-4" />
          </div>
        )}
        {error && (
          <Alert tone="error" className="m-2 text-xs">
            {errorMessage(error)}
          </Alert>
        )}

        {collections?.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <FolderTree className="h-8 w-8 text-fg-subtle/60" aria-hidden="true" />
            <p className="text-sm text-fg-muted">{t('panel.emptyHint')}</p>
            {canEditWorkspace && (
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => void createCollection()} disabled={busy}>
                  <Plus className="h-3.5 w-3.5" /> {t('panel.new')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setImporting(true)}>
                  <Upload className="h-3.5 w-3.5" /> {t('panel.import')}
                </Button>
              </div>
            )}
          </div>
        )}

        {collections?.map((collection) => {
          const open = expanded[collection.id] ?? false;
          const nodes = buildTree(collection);
          const canEdit = editable(collection);
          const locked = collection.editingRestricted || (canEditWorkspace && !canEdit);
          return (
            <div key={collection.id} role="group">
              <Row
                depth={0}
                expanded={open}
                onClick={() => setExpanded(collection.id, !open)}
                icon={
                  <ChevronRight
                    className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')}
                    aria-hidden="true"
                  />
                }
                label={collection.name}
                trailing={
                  <>
                    {locked && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAccessTarget(collection);
                        }}
                        title={canEdit ? t('tree.lockedEditing') : t('tree.lockedViewer')}
                        aria-label={t('tree.lockedLabel')}
                        className="rounded p-0.5 text-fg-subtle hover:bg-muted hover:text-accent"
                      >
                        <Lock className="h-3 w-3" />
                      </button>
                    )}
                    {collection.source?.changeDetected && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          useSourceUi.getState().open(collection.id);
                        }}
                        title={t('tree.sourceChanged')}
                        aria-label={t('tree.sourceChanged')}
                        className="rounded p-0.5 text-accent hover:bg-muted"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {forks?.get(collection.id) && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setForkStatus(forks.get(collection.id)!);
                        }}
                        title={
                          forks.get(collection.id)!.sourceName
                            ? t('tree.forkTitle', { name: forks.get(collection.id)!.sourceName! })
                            : t('tree.forkTitleUnknown')
                        }
                        aria-label={t('tree.forkStatusLabel')}
                        className="rounded p-0.5 text-fg-subtle hover:bg-muted hover:text-accent"
                      >
                        <GitFork className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </>
                }
                editing={renaming === collection.id}
                onRename={(name) => {
                  setRenaming(null);
                  void run(async () => void (await api.collections.update(collection.id, { name })));
                }}
                onCancelRename={() => setRenaming(null)}
                {...dragHandlers(undefined, { kind: 'collection', collectionId: collection.id })}
                menu={
                  <Menu
                    label={t('tree.itemActions', { name: collection.name })}
                    items={[
                      {
                        label: t('tree.run'),
                        icon: Play,
                        onSelect: () => setRunTarget({ collection, folderId: null }),
                      },
                      {
                        label: t('tree.fork'),
                        icon: GitFork,
                        onSelect: () => setForkTarget(collection),
                      },
                      { label: t('tree.gitSync'), icon: GitBranch, onSelect: () => setGitTarget(collection) },
                      ...(forks?.get(collection.id)
                        ? [
                            {
                              label: t('tree.compareSource'),
                              icon: GitCompareArrows,
                              onSelect: () => setForkStatus(forks.get(collection.id)!),
                            },
                          ]
                        : []),
                      {
                        label: t('tree.createMock'),
                        icon: Server,
                        disabled: !canEditWorkspace,
                        onSelect: () => setMockTarget(collection),
                      },
                      {
                        label: t('tree.createMonitor'),
                        icon: HeartPulse,
                        disabled: !canEditWorkspace,
                        onSelect: () => setMonitorTarget(collection),
                      },
                      {
                        label: t('tree.addRequest'),
                        icon: Plus,
                        disabled: !canEdit,
                        onSelect: () => void createRequest(collection.id, null),
                      },
                      {
                        label: t('tree.addFolder'),
                        icon: FolderPlus,
                        disabled: !canEdit,
                        onSelect: () => void createFolder(collection.id, null),
                      },
                      {
                        label: t('tree.rename'),
                        icon: Pencil,
                        disabled: !canEdit,
                        onSelect: () => setRenaming(collection.id),
                      },
                      {
                        label: t('tree.description'),
                        icon: BookOpen,
                        onSelect: () => setDescriptionTarget({ collection }),
                      },
                      {
                        label: t('tree.docs'),
                        icon: Library,
                        onSelect: () => navigate(`/collections/${collection.id}/docs`),
                      },
                      ...(collection.source
                        ? [
                            {
                              label: t('tree.updateFromSource'),
                              icon: RefreshCw,
                              onSelect: () => useSourceUi.getState().open(collection.id),
                            },
                          ]
                        : []),
                      {
                        label: t('tree.auth'),
                        icon: KeyRound,
                        onSelect: () => setAuthTarget({ kind: 'collection', collection }),
                      },
                      {
                        label: t('tree.variables'),
                        icon: VariableIcon,
                        onSelect: () => setVariablesTarget(collection),
                      },
                      {
                        label: t('tree.scripts'),
                        icon: Code2,
                        onSelect: () => setScriptsTarget({ kind: 'collection', collection }),
                      },
                      {
                        label: t('tree.duplicate'),
                        icon: Copy,
                        disabled: !canEdit,
                        onSelect: () =>
                          void run(async () => {
                            const copy = await api.collections.duplicate(collection.id);
                            setRenaming(copy.id);
                          }),
                      },
                      ...(isLocalMode()
                        ? []
                        : [
                            {
                              label: t('tree.comments'),
                              icon: MessageSquare,
                              onSelect: () =>
                                useCommentsPanel
                                  .getState()
                                  .open({ type: 'Collection', id: collection.id, name: collection.name }),
                            },
                          ]),
                      ...(current?.type !== 'Personal'
                        ? [
                            {
                              label: t('tree.accessRoles'),
                              icon: Shield,
                              onSelect: () => setAccessTarget(collection),
                            },
                          ]
                        : []),
                      {
                        label: t('tree.moveCopy'),
                        icon: ArrowRightLeft,
                        onSelect: () => setMoveTarget(collection),
                      },
                      {
                        label: t('tree.exportPostman'),
                        icon: Download,
                        onSelect: () =>
                          void run(async () =>
                            saveFile(await api.importExport.exportCollection(collection.id)),
                          ),
                      },
                      {
                        label: t('tree.exportOpenApiJson'),
                        icon: Download,
                        onSelect: () =>
                          void run(async () => saveFile(await api.importExport.exportOpenApi(collection.id))),
                      },
                      {
                        label: t('tree.exportOpenApiYaml'),
                        icon: Download,
                        onSelect: () =>
                          void run(async () =>
                            saveFile(
                              await openApiAsYaml(await api.importExport.exportOpenApi(collection.id)),
                            ),
                          ),
                      },
                      {
                        label: t('tree.delete'),
                        icon: Trash2,
                        danger: true,
                        disabled: !canEdit,
                        onSelect: () => setPendingDelete({ kind: 'collection', collection }),
                      },
                    ]}
                  />
                }
              />
              {open && (
                <>
                  {renderNodes(collection, nodes, 1)}
                  {nodes.length === 0 && (
                    <p className="py-1.5 text-xs text-fg-subtle" style={{ paddingLeft: 8 + INDENT * 1.5 }}>
                      {t('tree.emptyCollection')}{' '}
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => void createRequest(collection.id, null)}
                          className="text-accent hover:underline"
                        >
                          {t('tree.addRequest')}
                        </button>
                      )}
                    </p>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {variablesTarget && (
        <VariablesDialog
          title={t('dialogs.variablesTitle', { name: variablesTarget.name })}
          description={t('dialogs.variablesDescription')}
          readOnly={!editable(variablesTarget)}
          variables={variablesTarget.variables ?? []}
          currentValues={currentValues[scopeKeys.collection(variablesTarget.id)] ?? {}}
          onSave={async ({ variables, currentValues: values }) => {
            await api.collections.update(variablesTarget.id, { variables });
            useEnvironmentStore.getState().setCurrentValues(scopeKeys.collection(variablesTarget.id), values);
            await refresh();
          }}
          onClose={() => setVariablesTarget(null)}
        />
      )}

      {descriptionTarget && (
        <Suspense fallback={null}>
          <DescriptionDialog
            title={t('dialogs.descriptionTitle', {
              name: (descriptionTarget.folder ?? descriptionTarget.collection).name,
            })}
            initial={(descriptionTarget.folder ?? descriptionTarget.collection).description ?? ''}
            readOnly={!editable(descriptionTarget.collection)}
            onSave={async (description) => {
              if (descriptionTarget.folder)
                await api.folders.update(descriptionTarget.folder.id, { description });
              else await api.collections.update(descriptionTarget.collection.id, { description });
              await refresh();
            }}
            onClose={() => setDescriptionTarget(null)}
          />
        </Suspense>
      )}

      {authTarget && (
        <AuthSettingsDialog
          title={t('dialogs.authTitle', {
            name: authTarget.kind === 'collection' ? authTarget.collection.name : authTarget.folder.name,
          })}
          initial={authTarget.kind === 'collection' ? authTarget.collection.auth : authTarget.folder.auth}
          allowInherit={authTarget.kind === 'folder'}
          workspaceId={workspaceId}
          collection={
            authTarget.kind === 'collection'
              ? authTarget.collection
              : collections?.find((c) => c.folders.some((f) => f.id === authTarget.folder.id))
          }
          onSave={async (auth) => {
            if (authTarget.kind === 'collection')
              await api.collections.update(authTarget.collection.id, { auth });
            else await api.folders.update(authTarget.folder.id, { auth });
            await refresh();
          }}
          onClose={() => setAuthTarget(null)}
        />
      )}

      <Suspense fallback={null}>
        {gitTarget && (
          <GitSyncDialog
            collection={gitTarget}
            canEdit={editable(gitTarget)}
            canAdmin={current?.role === 'Admin'}
            onClose={() => setGitTarget(null)}
          />
        )}
        {forkTarget && (
          <ForkCollectionDialog
            collection={forkTarget}
            onForked={(fork) => {
              setForkTarget(null);
              if (fork.forkWorkspaceId) useUi.getState().setCurrentWorkspaceId(fork.forkWorkspaceId);
              setExpanded(fork.forkCollectionId, true);
            }}
            onClose={() => setForkTarget(null)}
          />
        )}

        {forkStatus && (
          <ForkStatusDialog
            fork={forkStatus}
            canEdit={editable(collections?.find((c) => c.id === forkStatus.forkCollectionId))}
            onClose={() => setForkStatus(null)}
          />
        )}

        {monitorTarget && workspaceId && (
          <MonitorSettingsDialog
            workspaceId={workspaceId}
            collectionId={monitorTarget.id}
            onSaved={(monitor) => {
              setMonitorTarget(null);
              void queryClient.invalidateQueries({ queryKey: monitorsQueryKey(workspaceId) });
              useMonitorUi.getState().open(monitor.id);
              useUi.getState().setSidebarSection('monitors');
            }}
            onClose={() => setMonitorTarget(null)}
          />
        )}

        {mockTarget && workspaceId && (
          <MockSettingsDialog
            workspaceId={workspaceId}
            collectionId={mockTarget.id}
            onSaved={(mock) => {
              setMockTarget(null);
              void queryClient.invalidateQueries({ queryKey: mocksQueryKey(workspaceId) });
              useMockUi.getState().open(mock.id);
              useUi.getState().setSidebarSection('mocks');
            }}
            onClose={() => setMockTarget(null)}
          />
        )}

        {runTarget && workspaceId && (
          <RunnerDialog
            workspaceId={workspaceId}
            collection={collections?.find((c) => c.id === runTarget.collection.id) ?? runTarget.collection}
            folderId={runTarget.folderId}
            onClose={() => setRunTarget(null)}
          />
        )}
      </Suspense>

      {scriptsTarget && (
        <ScriptsDialog
          title={t('dialogs.scriptsTitle', {
            name:
              scriptsTarget.kind === 'collection' ? scriptsTarget.collection.name : scriptsTarget.folder.name,
          })}
          hint={
            scriptsTarget.kind === 'collection'
              ? t('dialogs.scriptsHintCollection')
              : t('dialogs.scriptsHintFolder')
          }
          initial={
            (scriptsTarget.kind === 'collection'
              ? scriptsTarget.collection.scripts
              : scriptsTarget.folder.scripts) ?? {
              preRequest: '',
              postResponse: '',
            }
          }
          readOnly={
            !editable(
              scriptsTarget.kind === 'collection'
                ? scriptsTarget.collection
                : collections?.find((c) => c.folders.some((f) => f.id === scriptsTarget.folder.id)),
            )
          }
          onSave={async (scripts) => {
            if (scriptsTarget.kind === 'collection')
              await api.collections.update(scriptsTarget.collection.id, { scripts });
            else await api.folders.update(scriptsTarget.folder.id, { scripts });
            await refresh();
          }}
          onClose={() => setScriptsTarget(null)}
        />
      )}

      {openExample && workspaceId && (
        <ExampleDialog
          exampleId={openExample}
          workspaceId={workspaceId}
          readOnly={!editable(collections?.find((c) => c.examples.some((e) => e.id === openExample)))}
          onClose={() => setOpenExample(null)}
        />
      )}

      {moveTarget && workspaceId && (
        <MoveCollectionDialog
          collection={moveTarget}
          sourceWorkspaceId={workspaceId}
          canMove={editable(moveTarget)}
          onClose={() => setMoveTarget(null)}
        />
      )}

      {accessTarget && current && (
        <CollectionAccessDialog
          collection={accessTarget}
          workspace={current}
          onClose={() => setAccessTarget(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={t('delete.title')}
          confirmLabel={t('tree.delete')}
          onConfirm={() => confirmDelete(pendingDelete)}
          onClose={() => setPendingDelete(null)}
        >
          {pendingDelete.kind === 'collection' && (
            <p>
              {t.rich(
                'delete.collection',
                { b: bold },
                {
                  name: pendingDelete.collection.name,
                  count: pendingDelete.collection.requests.length,
                },
              )}
            </p>
          )}
          {pendingDelete.kind === 'folder' && (
            <p>
              {t.rich(
                'delete.folder',
                { b: bold },
                {
                  name: pendingDelete.folder.name,
                  count: requestIdsUnder(pendingDelete.collection, pendingDelete.folder.id).length,
                },
              )}
            </p>
          )}
          {pendingDelete.kind === 'request' && (
            <p>{t.rich('delete.request', { b: bold }, { name: pendingDelete.request.name })}</p>
          )}
          {pendingDelete.kind === 'example' && (
            <p>{t.rich('delete.example', { b: bold }, { name: pendingDelete.example.name })}</p>
          )}
        </ConfirmDialog>
      )}

      {importing && workspaceId && (
        <Suspense fallback={null}>
          <ImportDialog workspaceId={workspaceId} onClose={() => setImporting(false)} />
        </Suspense>
      )}
      <SourceDialogHost collections={collections} canEdit={(c) => editable(c)} />
    </section>
  );
}
