import { useEffect, useRef, useState } from 'react';
import { cn } from '@apivator/ui';
import { useT } from '../../i18n';

/** Ağaçta yerinde ad düzenleme: Enter kaydeder, Escape veya boş değer vazgeçer. */
export function InlineEdit({
  value,
  onSubmit,
  onCancel,
  className,
}: {
  value: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const t = useT('common');
  const [text, setText] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  function finish(commit: boolean) {
    if (done.current) return;
    done.current = true;
    const trimmed = text.trim();
    if (commit && trimmed && trimmed !== value) onSubmit(trimmed);
    else onCancel();
  }

  return (
    <input
      ref={ref}
      value={text}
      aria-label={t('fields.name')}
      onChange={(e) => setText(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
      onBlur={() => finish(true)}
      className={cn(
        'h-6 min-w-0 flex-1 rounded border border-accent bg-surface px-1.5 text-sm text-fg outline-none ring-2 ring-accent/20',
        className,
      )}
    />
  );
}
