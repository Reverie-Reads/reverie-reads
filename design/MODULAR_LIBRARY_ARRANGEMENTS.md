# Modular library arrangements

Status: **approved and implemented for account persistence** on 2026-09-06. The original study
remains available at `/lab/arrangements`; the signed-in editor lives at **Settings → Arrange
Reverie**. Both use the real room materials, controls, typography, navigation glyphs, cover
renderer, structural frames, and Home modules.

## Product decision

An arrangement has two independent parts:

1. **Close at hand** orders the reader's three priority destinations.
2. **Home modules** chooses and orders what greets the reader.

One control changes one outcome. Moving Next read in the dock does not move the Next read module on
Home. Hiding a Home module does not make its destination or data disappear.

The first implementation should use one logical order across devices. A phone renders that order in
three priority slots; Add and More occupy the two fixed slots. A desktop renders the same three as a
prominent group, then renders every remaining destination in a quieter complete rail. Per-device
overrides would make recovery and account switching harder to understand and are deferred until
reader evidence shows they are needed.

## Starting arrangements

| Arrangement         | Close at hand            | Home modules, in order                            | Reader intent                                           |
| ------------------- | ------------------------ | ------------------------------------------------- | ------------------------------------------------------- |
| Keep my books close | Library, Home, Shelves   | Priority shelves, Reading now, Coming soon        | Maintain a collection and return to chosen shelves      |
| Find my next read   | Home, Next read, Library | Choose a next read, Reading now, Priority shelves | Decide what to read with the books already available    |
| Remember my reading | Home, Library, Stats     | Reading now, Your reading year, Priority shelves  | Continue a reading life and preserve its private record |

These are starting points, not permanent personas. Every choice remains editable after selection.
The default is **Find my next read**, which matches Reverie's core promise while retaining Library as
an anchor.

## Reachability and slot contract

| Surface      | Fixed                                                | Configurable                                                     | Hidden items remain reachable through |
| ------------ | ---------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------- |
| Phone dock   | Add, More                                            | Three ordered priorities; Library required                       | More                                  |
| Desktop rail | Add, Appearance, Settings, complete destination list | Same three ordered priorities in a prominent group               | Complete rail                         |
| Home         | Page header and core Add/Browse actions              | Reading now, Next read, priority shelves, releases, reading year | Destination pages; arrangement editor |

Search is available from phone page chrome and the desktop shell. The arrangement never changes
book ownership, shelf membership, reading history, notes, ratings, series membership, Next read
candidate scope, room selection, or entitlements. Hidden destinations and modules retain their data.

Library cannot be hidden because it is the stable way back to the personal collection. A reader must
hide one of the other priority destinations before restoring another when all three phone slots are
occupied. This makes the result explicit and avoids silently evicting a destination.

## Editing flow

1. Open **Settings → Arrange Reverie**.
2. Choose a starting arrangement or edit the current one.
3. Move items with visible Up and Down buttons. Drag may be an enhancement, never the only control.
4. Hide or restore an item. The preview updates immediately.
5. Choose **Save**, **Cancel**, or **Restore default**. Restoring the default changes the draft and
   still requires Save.
6. Announce every state change in a polite live region. Move, hide, restore, save, and cancel controls
   use at least 44px touch targets and visible focus treatment in every room.

At 320px, labels remain centered under their glyphs and may truncate only after the complete
accessible name is present. At 390px, five dock items fit without horizontal scrolling. At desktop
width, the rail stays visually secondary to the books and modules.

## Home module states

| Module             | Content                                          | Empty or unavailable state                                      |
| ------------------ | ------------------------------------------------ | --------------------------------------------------------------- |
| Reading now        | Active books, progress, continue action          | “Nothing in progress” plus Start reading from Library           |
| Choose a next read | Available candidates from the personal library   | Explain which ownership states count and link to Library or Add |
| Priority shelves   | Books from reader-marked priority shelves        | Invite the reader to mark a shelf as priority                   |
| Coming soon        | Known dates from the reader's library            | Omit by default; editor still shows the module as available     |
| Your reading year  | Private completions and an optional private goal | Show completed count without requiring a goal                   |

Loading keeps the module's heading and a bounded skeleton. A failed module gives one local retry and
does not block other Home content. A capability unavailable under the current entitlement keeps its
saved position, renders a short explanation in the editor, and returns when access resumes.

## Persistence contract

Account persistence should store a versioned preference document, separate from the profile's room
selection:

```json
{
  "version": 1,
  "priorityDestinations": ["home", "match", "library"],
  "homeModules": ["next-read", "reading", "priority"]
}
```

- **Reload and another device:** the last confirmed server value wins after sign-in.
- **Editing:** mutations are explicit Save operations. Preview changes stay local until then.
- **Offline:** the saved arrangement may be read from the account-scoped cache. Configuration edits
  remain disabled or queued only after the app has a tested conflict strategy; v1 should not imply an
  offline save that does not exist.
- **Sign-out and account switching:** clear the in-memory draft and read only the next account's
  namespaced preference. Never let a guest or previous account arrangement bleed into another.
- **Guest handoff:** offer the guest arrangement during onboarding and import it only after the reader
  explicitly accepts it.
- **New destination or module:** add it to the complete menu/editor as available, without inserting it
  into an existing saved priority order.
- **Removed destination:** ignore the unknown key when rendering and preserve it during a versioned
  migration only if a planned replacement exists.
- **Unavailable entitlement:** keep the key and data, show the reason in the editor, and omit it from
  the live surface until available.
- **Corrupt or future version:** fall back to the default without overwriting the stored document until
  the reader saves.

## Release review protocol

Review the study at 320px, 390px, and 1440px in Tryst, Marginalia, Aphelion, and Hearth, in Day and
Night. Verify that a reader can choose a preset, move a destination, hide and restore it, modify Home
independently, cancel, save, and restore the default without explanation. Then run the registry-wide
contrast and focus checks before account persistence begins.

The implementation is accepted when an observed reader can change their starting arrangement,
reload into the same account value, find a hidden action through More or the desktop complete rail,
and restore the default without coaching. Record any prompt as a finding rather than explaining the
interface during the walkthrough.
