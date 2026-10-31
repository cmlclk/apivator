import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, cn } from '@apivator/ui';
import type { PersonDto } from '@apivator/core';
import { toLower, useT } from '../../i18n';
import { api } from '../../lib/api';
import { initials, presenceColor } from '../../lib/presence';
import { useSession } from '../../stores/session';
import { peopleQueryKey } from '../activity/activity';
import { mentionQuery, toEditable, toStored } from './mentions';

const normalize = toLower;

/**
 * Yorum yazma alanı. "@" yazınca workspace'e erişimi olan kişiler önerilir; seçilen kişi bildirim ve e-posta
 * alır. Ctrl+Enter gönderir.
 */
export function CommentComposer({
  workspaceId,
  initialBody = '',
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
  autoFocus,
}: {
  workspaceId: string;
  initialBody?: string;
  placeholder: string;
  submitLabel: string;
  onSubmit: (body: string) => Promise<void>;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const t = useT('comments');
  const me = useSession((s) => s.user?.id);
  const initial = useMemo(() => toEditable(initialBody), [initialBody]);
  const [text, setText] = useState(initial.text);
  const mentions = useRef(initial.mentions);
  const [query, setQuery] = useState<{ start: number; query: string } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  const { data: people = [] } = useQuery({
    queryKey: peopleQueryKey(workspaceId),
    queryFn: () => api.comments.people(workspaceId),
    staleTime: 60_000,
  });
  const suggestions = useMemo(() => {
    if (!query) return [];
    const q = normalize(query.query);
    return people
      .filter((p) => p.userId !== me)
      .filter((p) => normalize(p.displayName).includes(q) || normalize(p.email).startsWith(q))
      .slice(0, 6);
  }, [people, query, me]);

  const updateQuery = (value: string, caret: number) => {
    setQuery(mentionQuery(value, caret));
    setHighlight(0);
  };

  const pick = (person: PersonDto) => {
    if (!query) return;
    const caret = query.start + 1 + query.query.length;
    const insert = `@${person.displayName} `;
    const next = text.slice(0, query.start) + insert + text.slice(caret);
    mentions.current.set(person.displayName, person.userId);
    setText(next);
    setQuery(null);
    requestAnimationFrame(() => {
      const position = query.start + insert.length;
      ref.current?.focus();
      ref.current?.setSelectionRange(position, position);
    });
  };

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(toStored(text.trim(), mentions.current));
      setText('');
      mentions.current = new Map();
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => (h + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(suggestions[highlight]!);
        return;
      }
    }
    if (e.key === 'Escape') {
      if (query) setQuery(null);
      else onCancel?.();
      return;
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      // Ctrl+Enter burada yorumu gönderir; isteği göndermesin (genel kısayol).
      e.preventDefault();
      e.stopPropagation();
      void submit();
    }
  };

  return (
    <div className="relative flex flex-col gap-2">
      <textarea
        ref={ref}
        value={text}
        rows={3}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          updateQuery(e.target.value, e.target.selectionStart);
        }}
        onClick={(e) => updateQuery(text, e.currentTarget.selectionStart)}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        className="w-full resize-y rounded-md border border-line bg-surface px-2.5 py-2 text-[13px] placeholder:text-fg-subtle focus:border-accent focus:outline-none"
      />
      {suggestions.length > 0 && (
        <ul
          role="listbox"
          aria-label={t('composer.mentionList')}
          className="absolute bottom-full start-0 z-30 mb-1 w-64 rounded-md border border-line bg-surface p-1 shadow-lg"
        >
          {suggestions.map((p, i) => (
            <li key={p.userId}>
              <button
                type="button"
                role="option"
                aria-selected={i === highlight}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-[13px]',
                  i === highlight ? 'bg-muted' : 'hover:bg-muted',
                )}
              >
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white',
                    presenceColor(p.userId),
                  )}
                >
                  {initials(p.displayName)}
                </span>
                <span className="min-w-0 flex-1 truncate">{p.displayName}</span>
                <span className="truncate text-[11px] text-fg-subtle">{p.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <span className="me-auto text-[11px] text-fg-subtle">{t('composer.hint')}</span>
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t('composer.cancel')}
          </Button>
        )}
        <Button size="sm" onClick={() => void submit()} loading={busy} disabled={!text.trim()}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
