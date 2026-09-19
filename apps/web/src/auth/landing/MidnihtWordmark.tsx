import { APP_NAME } from '@reverie/core'
import { MidnihtMark } from '../../components/MidnihtMark'

/** Landing typography with the same identity as the installed app. */
export function MidnihtWordmark() {
  return (
    <span className="midniht-wordmark">
      <MidnihtMark className="h-12 w-12" />
      <span>
        {APP_NAME.toLowerCase()}
        <span className="midniht-wordmark-dot">.</span>
      </span>
    </span>
  )
}
