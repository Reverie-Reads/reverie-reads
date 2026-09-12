import type { ComponentType } from 'react'
import type { GuideId } from './model'

export interface GuideChapterDetailsProps {
  chapterId: GuideId
  /** The complete walkthrough may open extra explanations; gentle and self-led visits stay brief. */
  expanded: boolean
}

let ChapterDetails: ComponentType<GuideChapterDetailsProps> | null = null

/** Optional reader tools can explain their place in a chapter without changing the core tour,
 * progress document or access rules. The registered component owns its entitlement check. */
export function registerGuideChapterDetails(
  component: ComponentType<GuideChapterDetailsProps>,
): () => void {
  ChapterDetails = component
  return () => {
    if (ChapterDetails === component) ChapterDetails = null
  }
}

export function getGuideChapterDetails(): ComponentType<GuideChapterDetailsProps> | null {
  return ChapterDetails
}
