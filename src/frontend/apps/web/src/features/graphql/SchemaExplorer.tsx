import { useMemo, useState } from 'react';
import { ChevronLeft, CornerDownLeft, Search } from 'lucide-react';
import { cn } from '@apivator/ui';
import {
  getNamedType,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isObjectType,
  isScalarType,
  isUnionType,
  type GraphQLArgument,
  type GraphQLField,
  type GraphQLInputField,
  type GraphQLNamedType,
  type GraphQLSchema,
  type GraphQLType,
} from 'graphql';
import { useT } from '../../i18n';
import { buildOperation, rootType, type OperationKind } from './operations';

const KINDS: { kind: OperationKind; label: string }[] = [
  { kind: 'query', label: 'Query' },
  { kind: 'mutation', label: 'Mutation' },
  { kind: 'subscription', label: 'Subscription' },
];

function TypeLink({ type, onOpen }: { type: GraphQLType; onOpen: (name: string) => void }) {
  const t = useT('graphql');
  const named = getNamedType(type);
  const text = String(type);
  const at = text.indexOf(named.name);
  return (
    <span className="font-mono text-[11.5px]">
      {text.slice(0, at)}
      <button
        type="button"
        onClick={() => onOpen(named.name)}
        className="text-accent hover:underline"
        title={t('explorer.openType', { name: named.name })}
      >
        {named.name}
      </button>
      {text.slice(at + named.name.length)}
    </span>
  );
}

function Args({ args, onOpen }: { args: readonly GraphQLArgument[]; onOpen: (name: string) => void }) {
  if (args.length === 0) return null;
  return (
    <span className="text-fg-subtle">
      (
      {args.map((a, i) => (
        <span key={a.name}>
          {i > 0 && ', '}
          <span className="text-fg-muted">{a.name}</span>: <TypeLink type={a.type} onOpen={onOpen} />
        </span>
      ))}
      )
    </span>
  );
}

function FieldRow({
  field,
  onOpen,
  onInsert,
}: {
  field: GraphQLField<unknown, unknown> | GraphQLInputField;
  onOpen: (name: string) => void;
  onInsert?: () => void;
}) {
  const t = useT('graphql');
  const args = 'args' in field ? field.args : [];
  return (
    <li className="group px-3 py-1.5">
      <div className="flex items-start gap-1.5">
        <span className="min-w-0 flex-1 font-mono text-[12px] break-words">
          <span
            className={cn('font-medium', field.deprecationReason ? 'text-fg-subtle line-through' : 'text-fg')}
          >
            {field.name}
          </span>
          <Args args={args} onOpen={onOpen} />: <TypeLink type={field.type} onOpen={onOpen} />
        </span>
        {onInsert && (
          <button
            type="button"
            onClick={onInsert}
            aria-label={t('explorer.insertSample', { name: field.name })}
            title={t('explorer.createSample')}
            className="shrink-0 rounded p-0.5 text-fg-subtle opacity-0 group-hover:opacity-100 hover:bg-accent/10 hover:text-accent focus:opacity-100"
          >
            <CornerDownLeft className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {field.description && <p className="mt-0.5 text-xs text-fg-subtle">{field.description}</p>}
      {field.deprecationReason && (
        <p className="mt-0.5 text-xs text-warning">
          {t('explorer.deprecated', { reason: field.deprecationReason })}
        </p>
      )}
    </li>
  );
}

function TypeDetail({ type, onOpen }: { type: GraphQLNamedType; onOpen: (name: string) => void }) {
  const t = useT('graphql');
  const kind = isObjectType(type)
    ? 'type'
    : isInterfaceType(type)
      ? 'interface'
      : isInputObjectType(type)
        ? 'input'
        : isEnumType(type)
          ? 'enum'
          : isUnionType(type)
            ? 'union'
            : 'scalar';
  return (
    <div className="flex flex-col">
      <div className="border-b border-line px-3 py-2">
        <p className="font-mono text-[12.5px]">
          <span className="text-fg-subtle">{kind} </span>
          <span className="font-semibold">{type.name}</span>
          {isObjectType(type) && type.getInterfaces().length > 0 && (
            <span className="text-fg-subtle">
              {' '}
              implements{' '}
              {type.getInterfaces().map((i, n) => (
                <span key={i.name}>
                  {n > 0 && ' & '}
                  <TypeLink type={i} onOpen={onOpen} />
                </span>
              ))}
            </span>
          )}
        </p>
        {type.description && <p className="mt-1 text-xs text-fg-muted">{type.description}</p>}
      </div>
      {(isObjectType(type) || isInterfaceType(type) || isInputObjectType(type)) && (
        <ul className="divide-y divide-line/60">
          {Object.values(type.getFields()).map((f) => (
            <FieldRow key={f.name} field={f} onOpen={onOpen} />
          ))}
        </ul>
      )}
      {isEnumType(type) && (
        <ul className="divide-y divide-line/60">
          {type.getValues().map((v) => (
            <li key={v.name} className="px-3 py-1.5">
              <span className={cn('font-mono text-[12px]', v.deprecationReason && 'line-through')}>
                {v.name}
              </span>
              {v.description && <p className="text-xs text-fg-subtle">{v.description}</p>}
            </li>
          ))}
        </ul>
      )}
      {isUnionType(type) && (
        <p className="px-3 py-2 text-[12px]">
          {type.getTypes().map((member, n) => (
            <span key={member.name}>
              {n > 0 && ' | '}
              <TypeLink type={member} onOpen={onOpen} />
            </span>
          ))}
        </p>
      )}
      {isScalarType(type) && !type.description && (
        <p className="px-3 py-2 text-xs text-fg-subtle">{t('explorer.scalar')}</p>
      )}
    </div>
  );
}

/**
 * Şema gezgini: kök işlemler (Query/Mutation/Subscription), tip ayrıntıları ve arama. Kök alandan örnek işlem
 * oluşturulup editöre eklenir.
 */
export function SchemaExplorer({
  schema,
  onInsert,
}: {
  schema: GraphQLSchema;
  onInsert: (operation: { query: string; variables: Record<string, unknown> }) => void;
}) {
  const t = useT('graphql');
  const [stack, setStack] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const available = KINDS.filter((k) => rootType(schema, k.kind));
  const [kind, setKind] = useState<OperationKind>(available[0]?.kind ?? 'query');
  const open = (name: string) => {
    setSearch('');
    setStack((s) => [...s, name]);
  };
  const current = stack.length ? schema.getType(stack[stack.length - 1]!) : null;

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    const types = Object.values(schema.getTypeMap())
      .filter((type) => !type.name.startsWith('__') && type.name.toLowerCase().includes(q))
      .slice(0, 30);
    const fields = available.flatMap(({ kind: k }) =>
      Object.values(rootType(schema, k)!.getFields())
        .filter((f) => f.name.toLowerCase().includes(q))
        .map((f) => ({ kind: k, field: f })),
    );
    return { types, fields: fields.slice(0, 30) };
  }, [schema, search, available]);

  const root = rootType(schema, kind);

  return (
    <section aria-label={t('explorer.section')} className="flex h-full min-h-0 flex-col text-[13px]">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        {stack.length > 0 && (
          <button
            type="button"
            onClick={() => setStack((s) => s.slice(0, -1))}
            aria-label={t('explorer.back')}
            className="rounded p-0.5 text-fg-muted hover:bg-muted"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        <label className="flex min-w-0 flex-1 items-center gap-1 rounded-md border border-line px-1.5">
          <Search className="h-3 w-3 shrink-0 text-fg-subtle" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('explorer.searchPlaceholder')}
            aria-label={t('explorer.searchLabel')}
            className="h-6 min-w-0 flex-1 bg-transparent text-xs focus:outline-none"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {matches ? (
          <div className="flex flex-col">
            {matches.fields.length > 0 && (
              <ul aria-label={t('explorer.matchingFields')} className="divide-y divide-line/60">
                {matches.fields.map(({ kind: k, field }) => (
                  <FieldRow
                    key={`${k}.${field.name}`}
                    field={field}
                    onOpen={open}
                    onInsert={() => onInsert(buildOperation(k, field))}
                  />
                ))}
              </ul>
            )}
            {matches.types.length > 0 && (
              <ul aria-label={t('explorer.matchingTypes')} className="border-t border-line px-3 py-1.5">
                {matches.types.map((type) => (
                  <li key={type.name}>
                    <button
                      type="button"
                      onClick={() => open(type.name)}
                      className="font-mono text-[12px] text-accent hover:underline"
                    >
                      {type.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {matches.fields.length === 0 && matches.types.length === 0 && (
              <p className="p-4 text-center text-xs text-fg-subtle">{t('explorer.noMatch')}</p>
            )}
          </div>
        ) : current ? (
          <TypeDetail type={current} onOpen={open} />
        ) : (
          <>
            <div
              className="flex gap-1 border-b border-line px-2 py-1.5"
              role="tablist"
              aria-label={t('explorer.operationKind')}
            >
              {available.map((k) => (
                <button
                  key={k.kind}
                  type="button"
                  role="tab"
                  aria-selected={kind === k.kind}
                  onClick={() => setKind(k.kind)}
                  className={cn(
                    'rounded px-2 py-0.5 text-xs',
                    kind === k.kind ? 'bg-accent/10 font-medium text-accent' : 'text-fg-muted hover:bg-muted',
                  )}
                >
                  {k.label}
                </button>
              ))}
            </div>
            {root && (
              <ul aria-label={t('explorer.fields', { kind })} className="divide-y divide-line/60">
                {Object.values(root.getFields()).map((f) => (
                  <FieldRow
                    key={f.name}
                    field={f}
                    onOpen={open}
                    onInsert={() => onInsert(buildOperation(kind, f))}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}
