/** Private, review-only transcription evidence. Permissions are operator attestations, never
 * provider qualification, identity support, or authorization to publish/model-process a source. */
export interface DocumentEvidenceBox {
  x: number
  y: number
  width: number
  height: number
}
export interface DocumentEvidenceLine {
  id: string
  text: string
  bbox: DocumentEvidenceBox
  /** OCR engine's normalized 0–100 recognition score, never factual or identity confidence. */
  confidence: number | null
}
export interface DocumentEvidencePage {
  id: string
  label: string
  imageSha256: string
  width: number
  height: number
  method: 'ocr_sidecar' | 'manual_transcription'
  status: 'complete' | 'partial' | 'failed'
  lines: DocumentEvidenceLine[]
  errors?: string[]
}
export interface DocumentEvidenceCorrection {
  id: string
  pageId: string
  lineId: string
  imageSha256: string
  previousText: string
  text: string
  bbox: DocumentEvidenceBox
  reason: string
  reviewedAt: string
}
export interface DocumentEvidencePacket {
  version: 1
  mode: 'review_only'
  targetFingerprint: string
  source: {
    url: string
    retrievedAt: string
    label: string
    permissions: {
      localReview: boolean
      catalogStorage: boolean
      modelInput: boolean
      export: boolean
    }
    permissionBasis: string
  }
  pages: DocumentEvidencePage[]
  corrections: DocumentEvidenceCorrection[]
}
export interface DocumentEvidenceEffectiveLine extends DocumentEvidenceLine {
  pageId: string
  lineId: string
  rawText: string
  correctionIds: string[]
  pageStatus: DocumentEvidencePage['status']
  /** Only a valid explicit correction reviews transcription; this never verifies a book fact. */
  needsReview: boolean
}
export interface DocumentTsvResult {
  status: DocumentEvidencePage['status']
  lines: DocumentEvidenceLine[]
  errors: string[]
}
const LIMIT = 6000
const TEXT_BUDGET = 2_000_000
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype
const keys = (
  v: unknown,
  required: string[],
  optional: string[] = [],
): v is Record<string, unknown> =>
  object(v) &&
  required.every((k) => Object.hasOwn(v, k)) &&
  Object.keys(v).every((k) => [...required, ...optional].includes(k))
const string = (v: unknown, max: number, empty = false): v is string =>
  typeof v === 'string' &&
  v.length <= max &&
  (empty || !!v.trim()) &&
  !Array.from(v).some((character) => {
    const code = character.charCodeAt(0)
    return (code < 32 && ![9, 10, 13].includes(code)) || code === 127
  })
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(v)
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const timestamp = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 19) === v.slice(0, 19)
const dimension = (v: unknown): v is number =>
  Number.isSafeInteger(v) && (v as number) > 0 && (v as number) <= 30000
const box = (v: unknown, width: number, height: number): v is DocumentEvidenceBox =>
  keys(v, ['x', 'y', 'width', 'height']) &&
  [v.x, v.y, v.width, v.height].every(Number.isSafeInteger) &&
  (v.x as number) >= 0 &&
  (v.y as number) >= 0 &&
  (v.width as number) > 0 &&
  (v.height as number) > 0 &&
  (v.x as number) + (v.width as number) <= width &&
  (v.y as number) + (v.height as number) <= height
const confidence = (v: unknown) =>
  v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100)
const safeUrl = (v: unknown) => {
  if (!string(v, 2000) || !v.startsWith('https://') || /[?#\s\\]/.test(v)) return false
  try {
    const u = new URL(v)
    return (
      u.protocol === 'https:' && !!u.hostname && !u.username && !u.password && !u.search && !u.hash
    )
  } catch {
    return false
  }
}

/** Strict schema validation and correction-chain replay. Unknown fields (including personal data)
 * are refused. Returns a detached copy so validation cannot mutate the caller's evidence. */
export function parseDocumentEvidence(value: unknown): DocumentEvidencePacket | null {
  if (
    !keys(value, ['version', 'mode', 'targetFingerprint', 'source', 'pages', 'corrections']) ||
    value.version !== 1 ||
    value.mode !== 'review_only' ||
    !hash(value.targetFingerprint)
  )
    return null
  const s = value.source
  if (
    !keys(s, ['url', 'retrievedAt', 'label', 'permissions', 'permissionBasis']) ||
    !safeUrl(s.url) ||
    !timestamp(s.retrievedAt) ||
    !string(s.label, 300) ||
    !string(s.permissionBasis, 2000) ||
    !keys(s.permissions, ['localReview', 'catalogStorage', 'modelInput', 'export']) ||
    !Object.values(s.permissions).every((v) => typeof v === 'boolean')
  )
    return null
  if (
    !Array.isArray(value.pages) ||
    !value.pages.length ||
    value.pages.length > 8 ||
    !Array.isArray(value.corrections) ||
    value.corrections.length > LIMIT
  )
    return null
  let total = 0,
    chars = 0
  const pages = new Map<string, DocumentEvidencePage>()
  const current = new Map<string, string>()
  for (const p of value.pages) {
    if (
      !keys(
        p,
        ['id', 'label', 'imageSha256', 'width', 'height', 'method', 'status', 'lines'],
        ['errors'],
      ) ||
      !id(p.id) ||
      pages.has(p.id) ||
      !string(p.label, 300) ||
      !hash(p.imageSha256) ||
      !dimension(p.width) ||
      !dimension(p.height) ||
      !['ocr_sidecar', 'manual_transcription'].includes(p.method as string) ||
      !['complete', 'partial', 'failed'].includes(p.status as string) ||
      !Array.isArray(p.lines) ||
      (total += p.lines.length) > LIMIT ||
      (p.errors !== undefined &&
        (!Array.isArray(p.errors) ||
          p.errors.length > 100 ||
          !p.errors.every((e) => string(e, 500)) ||
          (p.status === 'complete' && p.errors.length > 0)))
    )
      return null
    for (const line of p.lines) {
      if (
        !keys(line, ['id', 'text', 'bbox', 'confidence']) ||
        !id(line.id) ||
        !string(line.text, 2000, true) ||
        !box(line.bbox, p.width, p.height) ||
        !confidence(line.confidence) ||
        current.has(`${p.id}/${line.id}`) ||
        (chars += line.text.length) > TEXT_BUDGET
      )
        return null
      current.set(`${p.id}/${line.id}`, line.text)
    }
    pages.set(p.id, p as unknown as DocumentEvidencePage)
  }
  const correctionIds = new Set<string>()
  const lastTime = new Map<string, number>()
  for (const c of value.corrections) {
    if (
      !keys(c, [
        'id',
        'pageId',
        'lineId',
        'imageSha256',
        'previousText',
        'text',
        'bbox',
        'reason',
        'reviewedAt',
      ]) ||
      !id(c.id) ||
      correctionIds.has(c.id) ||
      !id(c.pageId) ||
      !id(c.lineId) ||
      !hash(c.imageSha256) ||
      !string(c.previousText, 2000, true) ||
      !string(c.text, 2000, true) ||
      !string(c.reason, 1000) ||
      !timestamp(c.reviewedAt)
    )
      return null
    const p = pages.get(c.pageId),
      key = `${c.pageId}/${c.lineId}`,
      time = Date.parse(c.reviewedAt)
    if (
      !p ||
      p.imageSha256 !== c.imageSha256 ||
      !current.has(key) ||
      current.get(key) !== c.previousText ||
      !box(c.bbox, p.width, p.height) ||
      time < Date.parse(s.retrievedAt) ||
      time < (lastTime.get(key) ?? 0) ||
      (chars += c.previousText.length + c.text.length + c.reason.length) > TEXT_BUDGET
    )
      return null
    current.set(key, c.text)
    lastTime.set(key, time)
    correctionIds.add(c.id)
  }
  return structuredClone(value) as unknown as DocumentEvidencePacket
}

/** Revalidate even typed packets: stale corrections must never silently fall back to raw OCR. */
export function documentEvidenceLines(
  packet: DocumentEvidencePacket,
): DocumentEvidenceEffectiveLine[] {
  const parsed = parseDocumentEvidence(packet)
  if (!parsed) throw new Error('Invalid document evidence or correction chain')
  const lines = parsed.pages.flatMap((p) =>
    p.lines.map((l) => ({
      ...l,
      pageId: p.id,
      lineId: l.id,
      rawText: l.text,
      correctionIds: [] as string[],
      pageStatus: p.status,
      needsReview: true,
    })),
  )
  const byId = new Map(lines.map((l) => [`${l.pageId}/${l.lineId}`, l]))
  for (const c of parsed.corrections) {
    const l = byId.get(`${c.pageId}/${c.lineId}`)!
    l.text = c.text
    l.bbox = c.bbox
    l.correctionIds.push(c.id)
    l.needsReview = l.pageStatus !== 'complete'
  }
  return lines
}

const TSV_HEADER =
  'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext'
/** One rendered page per TSV. Reconstructs literal words with spaces; no bibliographic inference.
 * Invalid rows remain visible as diagnostics. Recognition confidence never clears review. */
export function parseDocumentTsv(text: string, width: number, height: number): DocumentTsvResult {
  const fail = (error: string): DocumentTsvResult => ({
    status: 'failed',
    lines: [],
    errors: [error],
  })
  if (
    typeof text !== 'string' ||
    text.length > 4_000_000 ||
    !dimension(width) ||
    !dimension(height)
  )
    return fail('Invalid or oversized TSV input')
  const rows = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (rows.shift() !== TSV_HEADER) return fail('Invalid Tesseract TSV header')
  if (rows.length > 60000) return fail('TSV row limit exceeded')
  const errors: string[] = [],
    lines: DocumentEvidenceLine[] = [],
    groups = new Map<string, { line: DocumentEvidenceLine; scores: number[]; words: Set<number> }>()
  const error = (n: number, message: string) => {
    if (errors.length < 100) errors.push(`Row ${n}: ${message}`)
  }
  let pageNumber: number | undefined,
    chars = 0
  for (const [i, row] of rows.entries()) {
    if (!row.trim()) continue
    const cells = row.split('\t')
    if (cells.length !== 12 || !cells.slice(0, 10).every((v) => /^\d+$/.test(v))) {
      error(i + 2, 'Invalid row fields')
      continue
    }
    const nums = cells.slice(0, 10).map(Number)
    const [level, page, block, par, lineNum, word, x, y, w, h] = nums as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ]
    if (!nums.every(Number.isSafeInteger) || level < 1 || level > 5 || page < 1) {
      error(i + 2, 'Invalid row coordinates')
      continue
    }
    if (pageNumber !== undefined && page !== pageNumber)
      return fail('Multiple pages in one TSV are not supported')
    pageNumber = page
    if (level !== 5) continue
    const bbox = { x, y, width: w, height: h },
      raw = cells[11]!,
      scoreText = cells[10]!
    const score = /^-?\d+(?:\.\d+)?$/.test(scoreText) ? Number(scoreText) : NaN
    if (
      block < 1 ||
      par < 1 ||
      lineNum < 1 ||
      word < 1 ||
      !box(bbox, width, height) ||
      !string(raw, 2000) ||
      !(score === -1 || confidence(score))
    ) {
      error(i + 2, 'Invalid word, confidence, or bounding box')
      continue
    }
    const key = `p${page}_b${block}_p${par}_l${lineNum}`
    let group = groups.get(key)
    if (group?.words.has(word)) {
      error(i + 2, 'Repeated word position')
      continue
    }
    if (group && word <= Math.max(...group.words)) {
      error(i + 2, 'Out-of-order word position')
      continue
    }
    if ((chars += raw.length + 1) > TEXT_BUDGET) return fail('TSV text limit exceeded')
    if (!group) {
      if (lines.length >= LIMIT) return fail('TSV line limit exceeded')
      const line = { id: key, text: raw, bbox, confidence: null }
      group = { line, scores: [], words: new Set() }
      groups.set(key, group)
      lines.push(line)
    } else {
      if (group.line.text.length + raw.length + 1 > 2000) {
        error(i + 2, 'Line text limit exceeded')
        continue
      }
      group.line.text += ` ${raw}`
      const b = group.line.bbox,
        right = Math.max(b.x + b.width, x + w),
        bottom = Math.max(b.y + b.height, y + h)
      b.x = Math.min(b.x, x)
      b.y = Math.min(b.y, y)
      b.width = right - b.x
      b.height = bottom - b.y
    }
    group.words.add(word)
    group.scores.push(score)
  }
  for (const { line, scores } of groups.values())
    line.confidence = scores.some((s) => s < 0) ? null : Math.min(...scores)
  // A successful OCR process with no recognized words does not prove the page is blank.
  if (!lines.length)
    return {
      status: 'failed',
      lines,
      errors: ['No recognized text; page requires review', ...errors].slice(0, 100),
    }
  return {
    status: errors.length ? (lines.length ? 'partial' : 'failed') : 'complete',
    lines,
    errors,
  }
}
