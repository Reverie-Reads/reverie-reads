import { useState } from 'react'
import { Button } from '../components/Button'
import { releaseDateLabel } from '../data/releases'
import { usePlannerEntries, useSavePlannerEntry, type PlannerEntry } from '../data/plannerEntries'

export function IndependentPlans({ kind }: { kind: PlannerEntry['kind'] }) {
  const entries = usePlannerEntries()
  const save = useSavePlannerEntry()
  const [draft, setDraft] = useState<PlannerEntry | null>(null)
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState('')
  const label = kind === 'watch' ? 'Release watch' : 'Reading plan'
  const filtered = (entries.data ?? []).filter(
    (row) =>
      row.kind === kind &&
      [row.title, row.author, row.series].some((s) =>
        s.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
      ),
  )
  return (
    <section className="my-4 rounded-lg border border-line p-4">
      <h2 className="text-lg font-semibold">
        {kind === 'watch' ? 'My release watch' : 'Plans outside my library'}
      </h2>
      <p className="my-2 text-sm">Track titles here without adding a copy to your library.</p>
      <Button
        onClick={() => {
          save.reset()
          setNotice('')
          setDraft({ id: crypto.randomUUID(), kind, title: '', author: '', series: '', timing: '' })
        }}
        disabled={!!draft}
      >
        Add {label.toLowerCase()}
      </Button>
      {draft && (
        <form
          className="my-3 grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate(draft, {
              onSuccess: () => {
                setDraft(null)
                setNotice(label + ' saved.')
              },
            })
          }}
        >
          {(['title', 'author', 'series', 'timing'] as const).map((field) => (
            <label key={field} className="block text-sm">
              {
                {
                  title: 'Title',
                  author: 'Author',
                  series: 'Series',
                  timing: 'Date (year, year-month, or full date)',
                }[field]
              }
              <input
                required={field === 'title'}
                maxLength={field === 'timing' ? 10 : 500}
                className="skin-field block min-h-11 w-full px-2"
                value={draft[field]}
                onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
              />
            </label>
          ))}
          <div>
            <button type="submit" disabled={save.isPending} className="skin-control min-h-11 px-3">
              Save {label.toLowerCase()}
            </button>
            <Button disabled={save.isPending} onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {entries.isError && (
        <p role="alert">
          Could not load entries.{' '}
          <button type="button" onClick={() => void entries.refetch()}>
            Retry
          </button>
        </p>
      )}
      {entries.isPending && <p role="status">Loading entries…</p>}
      {save.isError && <p role="alert">Could not save the change. Check the date and try again.</p>}
      {notice && <p role="status">{notice}</p>}
      <label className="mt-3 block text-sm">
        Find by title, author or series
        <input
          type="search"
          className="skin-field block min-h-11 w-full px-2"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <ul>
        {filtered.map((row) => (
          <li key={row.id} className="mt-2 flex flex-wrap items-center gap-2">
            <strong>{row.title}</strong>{' '}
            {[row.author, row.series, releaseDateLabel(row.timing) || 'Date unknown']
              .filter(Boolean)
              .join(' · ')}
            <Button
              disabled={!!draft || save.isPending}
              onClick={() => {
                save.reset()
                setDraft(row)
              }}
            >
              Edit {row.title}
            </Button>
            <Button
              disabled={!!draft || save.isPending}
              onClick={() => {
                if (window.confirm('Remove ' + row.title + ' from ' + label.toLowerCase() + '?'))
                  save.mutate({ remove: row.id }, { onSuccess: () => setNotice('Entry removed.') })
              }}
            >
              Remove {row.title}
            </Button>
          </li>
        ))}
      </ul>
      {entries.isSuccess && !filtered.length && (
        <p className="text-sm">{query ? 'No matching entries.' : 'No entries yet.'}</p>
      )}
    </section>
  )
}
