import { useId, useState } from 'react'
import { SERIES_STATUS_LABELS, SERIES_STATUS_VALUES } from '@reverie/core'
import type { HouseholdBook, HouseholdMember } from '../data/household'
import { Chip } from '../components/Chip'
import { Surface } from '../components/Surface'
import {
  defaultHouseholdFilters,
  householdCopyFormats,
  householdFilterCount,
  householdGenres,
  householdSubgenres,
  householdTags,
  type HouseholdFilters,
} from './householdFilters'

export function HouseholdToolbar({
  books,
  members,
  value,
  onChange,
}: {
  books: HouseholdBook[]
  members: HouseholdMember[]
  value: HouseholdFilters
  onChange: (value: HouseholdFilters) => void
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const count = householdFilterCount(value)
  const unique = (items: string[]) => [...new Set(items)].sort((a, b) => a.localeCompare(b))
  const select = (
    label: string,
    field: 'genre' | 'sub' | 'status' | 'len' | 'member' | 'format' | 'possession',
    options: { value: string; label: string }[],
  ) => (
    <label className="flex min-w-0 flex-col gap-1.5 text-sm text-ink">
      {label}
      <select
        aria-label={label}
        className="skin-field min-h-11 w-full min-w-0 border border-line px-3"
        value={value[field]}
        onChange={(e) => onChange({ ...value, [field]: e.target.value })}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
  const options = (items: string[]) =>
    ['All', ...unique(items)].map((v) => ({ value: v, label: v }))
  const tags = unique(books.flatMap(householdTags))
  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="Search household library"
          placeholder="Search title, author, series, trope, ISBN…"
          value={value.q}
          onChange={(e) => onChange({ ...value, q: e.target.value })}
          className="skin-field min-h-11 min-w-0 flex-[1_1_240px] border border-line px-4 text-sm text-ink"
        />
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
          className="skin-control min-h-11 border border-line px-4 text-sm text-ink"
        >
          Filters{count > 0 ? ` (${count})` : ''}
        </button>
        <select
          aria-label="Sort household library"
          value={value.sort}
          onChange={(e) => onChange({ ...value, sort: e.target.value as HouseholdFilters['sort'] })}
          className="skin-control min-h-11 min-w-0 border border-line px-3 text-sm text-ink"
        >
          <option value="az">Title A–Z</option>
          <option value="author">Author</option>
          <option value="series">Series order</option>
          <option value="recent">Recently added</option>
        </select>
        {(count > 0 || value.q) && (
          <button
            type="button"
            className="min-h-11 px-2 text-sm text-ink underline underline-offset-4"
            onClick={() => onChange(defaultHouseholdFilters())}
          >
            Clear search and filters
          </button>
        )}
      </div>
      {open && (
        <Surface id={id} tone="field" pad={3} radius="panel">
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {select('Genre', 'genre', options(books.flatMap(householdGenres)))}
            {select('Subgenre', 'sub', options(books.flatMap(householdSubgenres)))}
            {select('Member', 'member', [
              { value: 'All', label: 'All members' },
              ...members.map((m) => ({ value: m.userId, label: m.displayName })),
            ])}
            {select(
              'Format',
              'format',
              options(books.flatMap((b) => b.owners.flatMap(householdCopyFormats))),
            )}
            {select('Possession', 'possession', [
              { value: 'All', label: 'All shared books' },
              { value: 'owned', label: 'Owned' },
              { value: 'borrowed', label: 'Borrowed' },
            ])}
            {select('Series status', 'status', [
              { value: 'All', label: 'All' },
              ...SERIES_STATUS_VALUES.map((s) => ({ value: s, label: SERIES_STATUS_LABELS[s] })),
            ])}
            {select(
              'Books in series',
              'len',
              ['Any', '1', '2', '3', '4', '5+', 'Unknown'].map((v) => ({
                value: v,
                label: v === 'Unknown' ? 'None set' : v,
              })),
            )}
          </div>
          {tags.length > 0 && (
            <fieldset className="mt-4">
              <legend className="mb-2 text-sm text-ink">Shared tags and tropes</legend>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <Chip
                    key={tag}
                    active={value.tags.includes(tag)}
                    onClick={() =>
                      onChange({
                        ...value,
                        tags: value.tags.includes(tag)
                          ? value.tags.filter((t) => t !== tag)
                          : [...value.tags, tag],
                      })
                    }
                  >
                    {tag}
                  </Chip>
                ))}
              </div>
            </fieldset>
          )}
        </Surface>
      )}
    </div>
  )
}
