/** Quiet membership text, separate from the action row and from a particular shelf's save status. */
export function LibraryStatus() {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[12px] font-medium leading-5 text-ink"
      style={{ fontFamily: 'var(--font-body)', textTransform: 'none', letterSpacing: 'normal' }}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none">
        <path
          d="m3.5 8 3 3 6-6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      In your library
    </span>
  )
}
