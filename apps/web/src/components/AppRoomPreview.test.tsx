import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppRoomPreview } from './AppRoomPreview'

describe('AppRoomPreview', () => {
  it('uses the same navigation and control hooks as the shipped app shell', () => {
    const { container } = render(<AppRoomPreview />)

    expect(
      screen.getByRole('img', {
        name: 'A miniature Midniht library with its skin-specific navigation and cover shelf',
      }),
    ).toBeInTheDocument()
    expect(container.querySelector('.rv-nav-surface')).not.toBeNull()
    expect(container.querySelectorAll('.rv-nav-item')).toHaveLength(3)
    expect(container.querySelector('.rv-nav-item-active')).not.toBeNull()
    expect(container.querySelector('.skin-btn-primary')).not.toBeNull()
    expect(container.querySelectorAll('.skin-card')).toHaveLength(4)
  })
})
