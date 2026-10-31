export function Logo({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-accent" />
      <path
        d="M9 22 16 9l7 13"
        fill="none"
        className="stroke-accent-fg"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 18h8" className="stroke-accent-fg" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
