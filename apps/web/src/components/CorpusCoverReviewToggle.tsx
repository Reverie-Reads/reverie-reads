import { Surface } from './Surface'
import { Switch } from './Switch'

export function CorpusCoverReviewToggle({
  reviewed,
  loading,
  unavailable,
  saving,
  scope = 'personal',
  onReview,
  onChooseImage,
  reviewError,
  retryStatus,
}: {
  reviewed: boolean
  loading: boolean
  unavailable: boolean
  saving: boolean
  scope?: 'personal' | 'household'
  onChooseImage?: () => void
  reviewError?: string
  retryStatus?: () => void
  onReview: () => void
}) {
  const coverLabel = scope === 'household' ? 'Household cover' : 'Personal cover'
  return (
    <Surface tone="field" radius="card" pad={2} className="mt-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold text-ink">Corpus cover review</div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
            {unavailable
              ? 'Review status is unavailable. Refresh before reviewing this cover.'
              : reviewed
                ? 'Reviewed and available as a shared cover option.'
                : onChooseImage
                  ? 'This cover is saved in your library. Choose an image from the picker or upload one to share it with the catalog.'
                  : `Off until an administrator explicitly reviews this ${scope === 'household' ? 'household copy cover' : 'cover'}. If the corpus has no cover, approval also makes this the default.`}
          </p>
        </div>
        <Switch
          checked={reviewed}
          disabled={loading || unavailable || saving || reviewed || !!onChooseImage}
          label={
            unavailable
              ? `${coverLabel} review status unavailable`
              : reviewed
                ? `${coverLabel} reviewed for corpus`
                : `Review ${coverLabel.toLowerCase()} for corpus`
          }
          onChange={(next) => {
            if (next) onReview()
          }}
        />
      </div>
      {reviewError && (
        <p role="alert" className="mt-2 text-sm">
          Corpus cover review failed. {reviewError}
        </p>
      )}
      {onChooseImage && !reviewed && !unavailable && !loading && (
        <button type="button" className="min-h-11 underline" onClick={onChooseImage}>
          Open cover picker
        </button>
      )}
      {unavailable && retryStatus && (
        <button type="button" className="min-h-11 underline" onClick={retryStatus}>
          Retry review status
        </button>
      )}
    </Surface>
  )
}
