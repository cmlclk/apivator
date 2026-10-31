import { cn } from '@apivator/ui';
import type { SectionDiff } from '../../lib/diff';

/** Bölüm bölüm satır farkı (− eski, + yeni). */
export function DiffSections({ sections, empty }: { sections: SectionDiff[]; empty: string }) {
  if (sections.length === 0) return <p className="text-[13px] text-fg-subtle">{empty}</p>;
  return (
    <div className="flex flex-col gap-4 text-[13px]">
      {sections.map((section) => (
        <section key={section.label} aria-label={section.label}>
          <h3 className="mb-1 font-semibold">{section.label}</h3>
          <pre className="max-h-72 overflow-auto rounded-md border border-line bg-muted/40 py-1 font-mono text-xs">
            {section.lines.map((line, i) => (
              <div
                key={i}
                className={cn(
                  'px-3 break-all whitespace-pre-wrap',
                  line.kind === 'added' && 'bg-success/10 text-success',
                  line.kind === 'removed' && 'bg-danger/10 text-danger',
                )}
              >
                <span className="me-2 opacity-60 select-none">
                  {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}
                </span>
                {line.text || ' '}
              </div>
            ))}
          </pre>
        </section>
      ))}
    </div>
  );
}
