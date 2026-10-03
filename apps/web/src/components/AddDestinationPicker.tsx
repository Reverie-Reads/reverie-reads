import type { HouseholdMember } from '../data/household'
import type { AddDestination } from './addDestination'

interface AddDestinationPickerProps {
  value: AddDestination
  onChange: (value: AddDestination) => void
  members: HouseholdMember[]
  currentReaderId: string
  /** Imports always create personal rows, so only Mine and Mine + Household are meaningful. */
  importOnly?: boolean
}

export function AddDestinationPicker({
  value,
  onChange,
  members,
  currentReaderId,
  importOnly = false,
}: AddDestinationPickerProps) {
  const householdAvailable = members.length > 0
  const delegates = importOnly
    ? []
    : members.filter((member) => member.userId !== currentReaderId && member.allowMemberLibraryAdds)
  const choices: { value: AddDestination; label: string; detail: string }[] = [
    ...(householdAvailable
      ? [
          {
            value: 'both' as const,
            label: 'My library + Household',
            detail: 'Creates my personal book and one shared household entry.',
          },
        ]
      : []),
    {
      value: 'mine',
      label: 'My library only',
      detail:
        'Creates my personal book. Owned copies appear in Household; borrowed copies appear only when I share them.',
    },
    ...(!importOnly && householdAvailable
      ? [
          {
            value: 'household' as const,
            label: 'Household only',
            detail: 'Adds one shared entry without creating a personal book.',
          },
        ]
      : []),
    ...delegates.map((member) => ({
      value: `member:${member.userId}` as const,
      label: `${member.displayName}’s library + Household`,
      detail: `Adds a neutral personal book for ${member.displayName}; no ownership or reading state.`,
    })),
  ]

  return (
    <fieldset className="mb-4">
      <legend className="mb-2 text-[11px] uppercase tracking-[0.15em] text-muted">
        Where should this go?
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {choices.map((choice) => {
          const checked = value === choice.value
          return (
            <label
              key={choice.value}
              className="skin-control flex min-h-16 cursor-pointer items-start gap-2.5 border p-3 text-left"
              style={{
                background: checked ? 'var(--accent-fill)' : 'var(--field)',
                color: checked ? 'var(--on-primary)' : 'var(--ink)',
                borderColor: checked ? 'transparent' : 'var(--line)',
              }}
            >
              <input
                type="radio"
                name={importOnly ? 'import-destination' : 'add-destination'}
                value={choice.value}
                checked={checked}
                onChange={() => onChange(choice.value)}
                onClick={() => {
                  // Confirming the already displayed default is still a deliberate choice.
                  // Otherwise a later household response may replace it without another gesture.
                  if (checked) onChange(choice.value)
                }}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold leading-tight">
                  {choice.label}
                </span>
                <span className="mt-1 block text-[11.5px] leading-snug">{choice.detail}</span>
              </span>
            </label>
          )
        })}
      </div>
      {!householdAvailable ? (
        <p className="mt-2 text-[12px] text-muted">
          Link this account to a household to add shared books.
        </p>
      ) : null}
      {!importOnly && householdAvailable && delegates.length === 0 && members.length > 1 ? (
        <p className="mt-2 text-[12px] text-muted">
          Other members appear here after they allow household additions to their personal library.
        </p>
      ) : null}
    </fieldset>
  )
}
