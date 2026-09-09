# Reverie design system

Reverie is one living library expressed through nine reading rooms. Content, navigation, and
interaction semantics remain stable; typography, material, geometry, atmosphere, and voice change
with the active skin. A skin is an interface language, not a color swap.

The shipping token values live in `packages/core/src/skins.ts` and
`apps/web/src/styles/tokens.css`. The structural and component contract lives in
`docs/reference/SKIN_CHARACTER_CONTRACT.md`. Design-tool exports, when present, are references; the
shipped app is authoritative.

## The Reverie brand

The front door is a personal library after the world quiets down: midnight ink, parchment, and
aged-brass light. Newsreader at 500, with restrained genuine italic emphasis, supplies the display voice; Hanken Grotesk keeps navigation and body copy
plain and welcoming. The open-book wordmark belongs to Reverie across genres. Tryst retains its
own romance identity inside the product.

Midnight & Lamplight uses `#10121c` ink, `#d7bc88` aged brass, and `#f1eadc` parchment.
A soft pool of warm light moves behind the signed-out landing and account screens over 24 seconds
in each direction. Only the decorative layer's opacity and transform animate; text, controls and
room previews stay steady. The browser runs the animation without a JavaScript frame loop.
Hidden tabs pause it; reduced motion and unsupported browsers retain a still light.

Brand tokens live in `apps/web/src/styles/brand.css`. They scope the landing page and account
screens independently of the reader's saved skin. Product examples have their own complete
skin/mode scopes, including structural components and backgrounds. One room selection updates
every example without changing the visitor's saved appearance or sample reading choices.
The landing examples share a temporary guest library with real book selection, bounded CSV intake,
copy flags, reading transitions, and notes. Reuse product presentation and core logic; keep sample
state in memory and label any planned configuration explicitly. Catalog facts are public; reader
history is fictional until the visitor supplies it. Do not use production account screenshots or
private reader seed data. Guest book covers must not emit visitor titles to error telemetry.

Install icons, favicons, and share images use the same open-book mark and Midnight & Lamplight
palette as the public front door. Raster assets are generated reproducibly by
`apps/web/scripts/generate-brand-assets.mjs`; the dedicated maskable icon keeps the complete mark
inside the platform safe area. Social cards use curated public fixtures and typographic cover art,
never provider cover files or private reader data.

The brand promise is “A personal library that feels like home.” Explain that through concrete
actions: keep your books together, remember your reading, and find something you want to read.
Warmth comes from familiarity and permission, without romance-only language or reading pressure.

## Nine rooms, two modes

Every room supports light and dark modes independently of skin selection.

| Skin       | Room character                   | Control character                               |
| ---------- | -------------------------------- | ----------------------------------------------- |
| `tryst`    | intimate, gaslit, gilt           | compact invitation with a quiet gilt edge       |
| `grimoire` | scholarly, arcane, vellum        | precise manuscript control with a gilt rule     |
| `aphelion` | cold, orbital, instrumented      | machined notch and cyan instrument edge         |
| `marrow`   | forensic, mineral, severe        | hard chamfer and specimen-dark boundary         |
| `umbra`    | investigative, nocturnal, brass  | compact case label with a brass edge            |
| `folio`    | literary, editorial, tactile     | proof-red editorial edge                        |
| `hearth`   | domestic, warm, handmade         | softly squared label with restrained stitching  |
| `almanac`  | practical, field-recorded, exact | squared field label with a measured double rule |
| `bloom`    | youthful, luminous, optimistic   | softly rounded gel edge without sticker bulk    |

Prototype-era “Nocturne” and “Magnolia Dawn” do not name shipping themes. Their atmosphere survives
inside Tryst; mode remains `light`, `dark`, or `system` for every skin.

## Typography and readability

- Display typography gives each room identity; body and control typography must remain immediately
  readable.
- Primary reading text should be at least 14px in the product. Supporting labels should normally be
  12px or larger. Smaller type is reserved for nonessential cover marks and very narrow book spines.
- Body copy uses a 1.5–1.65 line height. Multiline display headings on the landing page use at least
  1.14; inspect ascenders, descenders, and wrapping in the actual fonts at every breakpoint.
- Letter spacing is restrained at small sizes. Uppercase labels use shorter words and no more
  tracking than their skin needs.
- Text never relies on atmosphere or texture for contrast. It sits on an opaque authored surface or
  a tested scrim.

## Controls

All skins share one interaction hierarchy:

- Primary: the room's authored CTA fill and ink, a clear edge, and restrained depth.
- Secondary: opaque `--card-solid`, `--ink`, and a control boundary that clears 3:1 against its own
  surface.
- Icon: the same material as secondary, with a minimum 44×44px target in navigation and primary
  product flows.
- Ghost: reserved for low-emphasis actions whose location and label make interactivity clear.

Skin identity comes from corners, cut geometry, border rhythm, type, and accent treatment. Icon
buttons must not become wax seals, grommets, wooden buttons, or other decorative silhouettes whose
meaning disappears at small size. Theme and skin color changes land atomically so foreground and
background never animate through a low-contrast midpoint.

Every control has a visible `:focus-visible` outline, a clear disabled state, and conventional
hover/pressed feedback. Motion is disabled under `prefers-reduced-motion`.

Scrollbars retain the browser's native mechanics and user-selected width. Their thumb uses the
current room's contrast-tested muted ink over a transparent track; forced-color mode returns to the
system palette. Nested landing previews resolve the colors from their own room rather than the page
around them.

## Atmosphere and background

Atmosphere lives behind content. It may drift, breathe, pulse, or reveal room-specific structure,
but it must remain subtle, low-frequency, and nonessential. The opaque component surface is the
readability floor; texture, grid, crack, grain, or glow never becomes the text background.

Use the room's atmosphere only where it improves orientation or emotional continuity. Avoid an
effect when it competes with a cover, makes scrolling feel unstable, or exists only to prove the
skin is different.

Each room uses a material field rather than a literal illustration of a room. The renderer builds
fine-grained height and light maps in WebGL where available, copies the result to Canvas, and then
releases the WebGL context. Canvas supplies the room-specific detail and the quiet animated light.
That hybrid keeps the field tactile without reserving a scarce graphics context for every preview.

| Skin       | Atmospheric material                                                |
| ---------- | ------------------------------------------------------------------- |
| `tryst`    | plum-dark sky with the original layered stars and warm haze         |
| `grimoire` | illuminated vellum, worn pigment, and a restrained marginal rule    |
| `aphelion` | deep instrument sky with its original 46px orbital grid             |
| `marrow`   | weathered tombstone with branching fractures and mineral pits       |
| `umbra`    | rain crossing wet slate under a distant brass street glow           |
| `folio`    | fibrous cotton paper, deckled edges, and a faint editorial wash     |
| `hearth`   | woven linen, dark timber, and an intimate pool of lamplight         |
| `almanac`  | field paper with surveyed contours, grain, and a pressed fern trace |
| `bloom`    | translucent dawn cloud strata with a soft pearlescent horizon       |

Atmosphere moves like light on a familiar surface, never like scenery sliding behind the reader.
Reduced motion, hidden pages, and offscreen previews rest. Static material caching and a bounded
canvas resolution keep the effect inexpensive. Landing previews use the same renderer and tokens as
the signed-in app; their soft, curved threshold should feel like looking through a reverie rather
than placing the product inside a hard mock-device frame.

## Signature components

- Spine shelves: real skin-specific book spines that reveal a selected cover without changing the
  shelf's layout width.
- Cover cards: authentic book information and restrained status marks; never aggregate ratings.
- Reading-goal ring: a skin-specific progress motif with a guaranteed center surface/ink pair.
- Navigation: stable destinations and hit targets, with each room's material and active-state
  grammar.
- Landing playgrounds: use the same components, tokens, and synthetic fixtures as the app. They may
  be scaled, but informative text remains readable and the preview must not invent a second UI.

## Quality floor

- Mobile-first and visually checked at narrow mobile, large mobile, tablet, and desktop widths.
- WCAG AA text contrast in all nine skins × both modes; 3:1 boundaries for controls and focus cues.
- 44px targets for primary/icon navigation controls; never allow arrow or toggle controls to shrink.
- Visible keyboard focus, usable zoom, meaningful names, logical focus order, and reduced motion.
- Sentence case, plain verbs, honest product claims, and empty states that invite a concrete action.
- Automated contrast/axe checks are necessary but not sufficient: inspect wrapping, clipping,
  density, line spacing, and transient mode changes in the rendered interface.
