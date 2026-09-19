# Midniht logo handoff

Approved source: `midniht-logo-vector-clean-joins.ai`, September 19, 2026.
The face, short wavy hair, moon, book and five cream-to-gold joins are preserved.

- `midniht-master.ai`: editable Illustrator master; keep this as the source of truth.
- `midniht-master.pdf`: editable RGB vector interchange/print reference. A printer should convert to its required CMYK profile; this is not a press-certified PDF/X file.
- `midniht-master.svg`: complete original artboard.
- `midniht-mark.svg`: square, clear-space web export. Same geometry, no redraw.
- `midniht-mark-one-color-ink.svg` and `...cream.svg`: single-color versions with intentional transparent negative space.
- `midniht-mark-{size}.png`: transparent full-color exports from 32 to 2048 pixels.
- `midniht-mark-dark-2048.png` / `...light-2048.png`: opaque presentation exports.
- `midniht-maskable-512.png`: solid midnight app-icon tile with the full mark within the maskable safe area.
- `favicon.ico`: 16, 32 and 48 pixel compatibility export.
- `midniht-share-1200x630.png`: social sharing card.

The full-color mark is the same on both themes. Do not stretch, recolor individual
parts, smooth the whole path, or remove the short wavy hair. The tiny exports retain
the approved full mark; a separately simplified favicon would require another design
decision. Existing exploration files remain intact in `design/brand-exploration`.

The landing uses the full-color SVG and the existing preview illustration. It does
not replace the installed app's manifest or identity yet. The public name is Midniht;
the authenticated app remains Reverie pending a separate migration.

Reproduce with `python3 apps/web/scripts/package-midniht-brand.py` in an environment
with Pillow, pypdfium2 and macOS Georgia. The script reuses the canonical masters;
it imports the approved exploration files only when a master is missing. Existing
masters are never replaced by an older exploration. `checksums.json` records each packaged file. No private
reader data is included.
