import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCorpusAdminStatus } from '../data/enrichCorpus'
import { supabase } from '../lib/supabase'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'

type Membership = {
  name: string | null
  position: number | null
  count: number | null
  status: string | null
}
interface PublicationRow {
  entry: string
  title: string
  work: string | null
  previous: Membership
  value: Membership
  eligible: boolean
}

const describe = (v: Membership) =>
  [
    v.name || 'No series',
    v.position == null ? '' : '#' + v.position,
    v.count == null ? '' : v.count + ' books',
    v.status,
  ]
    .filter(Boolean)
    .join(' · ')

export function SeriesPublication({ id }: { id: string }) {
  const admin = useCorpusAdminStatus()
  const [open, setOpen] = useState(false)
  return admin.data ? (
    <>
      <Button onClick={() => setOpen(true)}>Review series for the shared catalog</Button>
      {open && <PublicationReview id={id} close={() => setOpen(false)} />}
    </>
  ) : null
}

function PublicationReview({ id, close }: { id: string; close: () => void }) {
  const qc = useQueryClient()
  const [rows, setRows] = useState<PublicationRow[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const review = useMutation({
    retry: false,
    mutationFn: async () => {
      const pageSize = 100
      const all: PublicationRow[] = []
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .rpc('review_personal_series_publication', { p_series: id })
          .range(from, from + pageSize - 1)
        if (error) throw error
        const page = (data ?? []) as PublicationRow[]
        all.push(...page)
        if (page.length < pageSize) return all
      }
    },
    onSuccess: (data) => {
      setRows(data)
      setSelected([])
    },
  })
  const publish = useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('publish_reviewed_personal_series', {
        p_series: id,
        p_rows: rows.filter((row) => selected.includes(row.entry)),
      })
      if (error) throw error
      return Number(data)
    },
    onSuccess: async () => {
      await Promise.all(
        [
          ['corpus-series-catalog'],
          ['works'],
          ['books'],
          ['household'],
          ['series'],
          ['seriesList'],
          ['corpus-record'],
        ].map((queryKey) => qc.invalidateQueries({ queryKey })),
      )
    },
  })
  return (
    <Modal
      title="Review series for the shared catalog"
      onClose={() => {
        if (!publish.isPending) close()
      }}
      wide
    >
      <p>
        Choose the saved memberships to publish together. Each selected work updates its shared
        series details.
      </p>
      <Button
        disabled={review.isPending || publish.isPending}
        onClick={() => {
          publish.reset()
          setRows([])
          setSelected([])
          review.mutate()
        }}
      >
        {review.isPending ? 'Loading entries…' : 'Load current entries'}
      </Button>
      {review.isError && <p role="alert">Could not load the series entries.</p>}
      {review.isSuccess && rows.length === 0 && <p>No saved memberships to publish.</p>}
      {rows.map((row) => (
        <label className="my-2 block" key={row.entry}>
          <input
            type="checkbox"
            disabled={!row.eligible || publish.isPending || publish.isSuccess || publish.isError}
            checked={selected.includes(row.entry)}
            onChange={(e) =>
              setSelected((old) =>
                e.target.checked ? [...old, row.entry] : old.filter((x) => x !== row.entry),
              )
            }
          />{' '}
          {row.title}
          <span className="block text-sm">
            {row.eligible
              ? describe(row.previous) + ' → ' + describe(row.value)
              : 'Needs a linked shared work and confirmed primary position.'}
          </span>
        </label>
      ))}
      {selected.length > 100 && <p>Select up to 100 works per review.</p>}
      <Button
        disabled={
          !selected.length ||
          selected.length > 100 ||
          publish.isPending ||
          publish.isSuccess ||
          publish.isError
        }
        onClick={() => publish.mutate()}
      >
        Publish selected memberships ({selected.length})
      </Button>
      {publish.isError && (
        <p role="alert">
          Publication could not be confirmed. Load current entries before trying again.
        </p>
      )}
      {publish.isSuccess && <p role="status">Published {publish.data} memberships.</p>}
    </Modal>
  )
}
