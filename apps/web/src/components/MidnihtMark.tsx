/** Approved full-color vector, shared by the front door and every reading room. */
export function MidnihtMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <img
      aria-hidden="true"
      alt=""
      draggable={false}
      src="/midniht/midniht-mark.svg"
      width="48"
      height="48"
      className={`shrink-0 object-contain ${className}`}
    />
  )
}
