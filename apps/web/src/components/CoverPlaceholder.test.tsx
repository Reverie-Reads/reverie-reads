import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { monogram, SKINS, type SkinId } from '@reverie/core'
import { CoverPlaceholder } from './CoverPlaceholder'

// The monogram was computed-and-dropped for the plates' whole life: placeholderSpec derived
// `initials` from day one and no consumer ever rendered it, which is how five ACOTAR spines came to
// read "Cou of…" five times over (feat/discover-phase-a). This file pins the wiring — the part a
// core test cannot see, exactly like seriesSeedProvenance.test.tsx vs the merge gate.
//
// jsdom computes no container queries, so nothing here asserts which plate is VISIBLE at a given
// width — that's the browser verification's job. What is assertable: both plates exist, the
// monogram is really in the narrow one, the toggle classes carry actual CSS (a class with no rule
// behind it fails silent — the bulk-insert lesson: nothing read the result), and the accessible
// name is identical at every width because both visual blocks are aria-hidden.

describe('CoverPlaceholder renders the monogram plate beside the designed plate', () => {
  const book = { title: 'A Court of Mist and Fury', first: 'Sarah', last: 'Maas' }

  it('the narrow plate contains the monogram — the signal that survives 36px', () => {
    const { container } = render(<CoverPlaceholder book={book} />)
    const narrow = container.querySelector('.ph-plate-narrow')
    expect(narrow, 'narrow plate missing').toBeTruthy()
    expect(narrow!.textContent).toContain(monogram(book.title)) // "CM"
  })

  it('the designed plate still renders, and the wrapper owns the single accessible name', () => {
    const { container } = render(<CoverPlaceholder book={book} />)
    expect(container.querySelector('.ph-plate-wide'), 'wide plate missing').toBeTruthy()
    const img = screen.getByRole('img')
    expect(img.getAttribute('aria-label')).toBe(
      'A Court of Mist and Fury by Sarah Maas — placeholder cover',
    )
    // Both visual blocks are aria-hidden — the monogram is a visual differentiator, never the
    // accessible name, so what a screen reader announces is width-independent.
    expect(container.querySelector('.ph-plate-wide')!.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('.ph-plate-narrow')!.getAttribute('aria-hidden')).toBe('true')
  })

  it('same-series neighbours get distinct monograms — the defect this exists to prevent', () => {
    const titles = [
      'A Court of Thorns and Roses',
      'A Court of Mist and Fury',
      'A Court of Wings and Ruin',
      'A Court of Silver Flames',
    ]
    const marks = titles.map((t) => {
      const { container, unmount } = render(
        <CoverPlaceholder book={{ title: t, first: 'Sarah', last: 'Maas' }} />,
      )
      const text = container.querySelector('.ph-plate-narrow')!.textContent
      unmount()
      return text
    })
    expect(new Set(marks).size).toBe(titles.length)
  })

  it('the toggle classes have real CSS behind them — a class with no rule fails silent', () => {
    const css = readFileSync(join(__dirname, '../styles/globals.css'), 'utf8')
    // Base state hides the narrow plate (no-container-query browsers keep today's behaviour)…
    expect(css).toMatch(/\.ph-plate-narrow\s*\{\s*display:\s*none;?\s*\}/)
    // …and the container query flips them at the spine threshold.
    expect(css).toMatch(/@container\s*\(max-width:\s*64px\)/)
    const query = css.slice(css.indexOf('@container (max-width: 64px)'))
    expect(query).toMatch(/\.ph-plate-wide\s*\{\s*display:\s*none;?\s*\}/)
    expect(query).toMatch(/\.ph-plate-narrow\s*\{\s*display:\s*flex;?\s*\}/)
  })
})

describe('every plate composes its placeholder title deliberately', () => {
  const single = { title: 'Accumulation', first: 'Aimee', last: 'Pokwatka' }
  const multiple = {
    title: 'The Extraordinary Inheritance',
    first: 'Nell',
    last: 'Marrow',
  }

  const titleSpan = (container: HTMLElement): HTMLElement | null =>
    container.querySelector<HTMLElement>('.ph-plate-wide [data-placeholder-title]')

  for (const skin of Object.keys(SKINS) as SkinId[]) {
    it(`${skin}: a one-word title stays one line and has an honest floor fallback`, () => {
      const { container } = render(<CoverPlaceholder book={single} skin={skin} />)
      const el = titleSpan(container)
      expect(el, `${skin}: placeholder title missing`).toBeTruthy()
      expect(el!.style.whiteSpace).toBe('nowrap')
      expect(el!.style.textOverflow).toBe('ellipsis')
      expect(el!.style.maxWidth).toBe('100%')
      expect(el!.style.fontSize).toMatch(/^clamp\([\d.]+px, [\d.]+cqw, [\d.]+px\)$/)
    })

    it(`${skin}: a multi-word title balances whole words inside its clamp`, () => {
      const { container } = render(<CoverPlaceholder book={multiple} skin={skin} />)
      const el = titleSpan(container)
      expect(el, `${skin}: placeholder title missing`).toBeTruthy()
      expect(el!.style.textWrap).toBe('balance')
      expect(el!.style.overflowWrap).toBe('normal')
      expect(el!.style.wordBreak).toBe('normal')
      expect(Number(el!.style.webkitLineClamp)).toBeGreaterThan(0)
    })
  }

  it('shrinks a long word while keeping a short title at its display scale', () => {
    const fluidCqw = (title: string): number => {
      const { container } = render(
        <CoverPlaceholder book={{ title, first: 'Nell', last: 'Marrow' }} skin="tryst" />,
      )
      const value = titleSpan(container)?.style.fontSize ?? ''
      const match = value.match(/, ([\d.]+)cqw,/)
      expect(match, `no fluid container size in ${value}`).toBeTruthy()
      return Number(match![1])
    }
    expect(fluidCqw('Accumulation')).toBeLessThan(fluidCqw('Lure'))
  })

  it('the narrow monogram plate is untouched — it never renders a title at all', () => {
    // Verified rather than assumed: both blocks are always in the DOM (a container query toggles
    // them), so "out of scope" needs checking, not asserting.
    const { container } = render(<CoverPlaceholder book={single} />)
    const narrow = container.querySelector('.ph-plate-narrow')
    expect(narrow, 'narrow plate missing').toBeTruthy()
    expect(narrow!.textContent).not.toContain(single.title)
    expect(narrow!.textContent).toContain(monogram(single.title))
  })
})
