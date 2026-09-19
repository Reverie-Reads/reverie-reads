/** Public landing identity; the authenticated app keeps its existing name during migration. */
export function MidnihtWordmark() {
  return (
    <span className="midniht-wordmark">
      <img src="/midniht/midniht-mark.svg" width="48" height="48" alt="" />
      <span>
        midniht<span className="midniht-wordmark-dot">.</span>
      </span>
    </span>
  )
}
