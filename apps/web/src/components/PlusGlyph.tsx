/** A font-independent plus. Display faces in Marginalia and Almanac give the full-width `＋`
 * uneven side bearings, which makes an otherwise centered add control look left weighted. */
export function PlusGlyph({ className = 'h-[18px] w-[18px]' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M10 3.75v12.5M3.75 10h12.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
