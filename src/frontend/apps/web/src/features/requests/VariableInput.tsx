import { useContext, useLayoutEffect, useRef, type InputHTMLAttributes } from 'react';
import { cn } from '@apivator/ui';
import { isDynamicVariable, splitVariables, type VariableMap } from '@apivator/core';
import { CollabSessionContext } from '../collab/CollabContext';
import { diffRange } from '../collab/diffRange';

/**
 * {{değişken}} ifadelerini renklendiren tek satırlık giriş. Arkada aynı metni renkli çizen bir katman
 * vardır; giriş kutusunun yazısı şeffaftır, imleç ve seçim normal çalışır.
 */
export function VariableInput({
  value,
  onChange,
  variables,
  className,
  collabField,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  /** Ortak düzenlemede alanın yolu: odaklanınca diğer kişilere bildirilir. */
  collabField?: string;
  value: string;
  onChange: (value: string) => void;
  variables: VariableMap;
}) {
  const overlay = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const session = useContext(CollabSessionContext);
  // Son bilinen değer ve imleç: dışarıdan (başkasının yazımıyla) değişince imleç değişikliğe göre kaydırılır.
  const known = useRef(value);
  const selection = useRef<[number, number]>([0, 0]);
  useLayoutEffect(() => {
    const el = input.current;
    if (value === known.current) return;
    if (el && document.activeElement === el) {
      const { from, to, insert } = diffRange(known.current, value);
      const shift = (p: number) =>
        p <= from ? p : p >= to ? p + insert.length - (to - from) : from + insert.length;
      el.setSelectionRange(shift(selection.current[0]), shift(selection.current[1]));
    }
    known.current = value;
  }, [value]);
  const sync = (e: { currentTarget: HTMLInputElement }) => {
    if (overlay.current) overlay.current.scrollLeft = e.currentTarget.scrollLeft;
  };

  return (
    <div className={cn('relative min-w-0 flex-1', className)}>
      <div
        ref={overlay}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre px-3 font-mono text-[13px] leading-9 text-fg"
      >
        {splitVariables(value).map((segment, i) =>
          segment.variable ? (
            <span
              key={i}
              className={cn(
                'rounded-sm',
                variables.has(segment.variable) || isDynamicVariable(segment.variable)
                  ? 'bg-accent/15 text-accent'
                  : 'bg-danger/15 text-danger',
              )}
            >
              {segment.text}
            </span>
          ) : (
            <span key={i}>{segment.text}</span>
          ),
        )}
      </div>
      <input
        {...props}
        ref={input}
        value={value}
        onChange={(e) => {
          known.current = e.target.value;
          onChange(e.target.value);
          sync(e);
        }}
        onFocus={(e) => {
          props.onFocus?.(e);
          if (collabField) session?.setFocus(collabField);
        }}
        onBlur={(e) => {
          props.onBlur?.(e);
          if (collabField) session?.setFocus(null);
        }}
        onScroll={sync}
        onKeyUp={sync}
        onSelect={(e) => {
          selection.current = [e.currentTarget.selectionStart ?? 0, e.currentTarget.selectionEnd ?? 0];
          sync(e);
        }}
        spellCheck={false}
        className="relative h-9 w-full min-w-0 bg-transparent px-3 font-mono text-[13px] text-transparent caret-[var(--app-fg)] selection:bg-accent/30 selection:text-transparent placeholder:text-fg-subtle focus:outline-none"
      />
    </div>
  );
}
