export function BrandMark({ size = 32 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
    <path d="M29 9a14 14 0 1 0 0 22" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
    <path d="M15 13v14m0-7h8a6 6 0 0 0 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="15" cy="12" r="3" fill="currentColor" /><circle cx="15" cy="28" r="3" fill="currentColor" /><circle cx="29" cy="12" r="3" fill="currentColor" />
    <circle cx="33" cy="26" r="3.5" fill="var(--accent)" />
  </svg>;
}
