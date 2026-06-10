/**
 * Build a filesystem-safe ASCII slug from a charter title.
 * Japanese titles often produce an empty slug after stripping; fall back to "charter".
 */
export function slugify(text: string, maxLength = 40): string {
  const ascii = text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const trimmed = ascii.slice(0, maxLength).replace(/-+$/g, '')
  return trimmed || 'charter'
}

/** Next charter id for a year: "2026-0003" given existing ids. */
export function nextCharterId(existingIds: string[], year: number): string {
  const prefix = `${year}-`
  let max = 0
  for (const id of existingIds) {
    if (!id.startsWith(prefix)) continue
    const n = Number(id.slice(prefix.length))
    if (Number.isFinite(n) && n > max) max = n
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`
}

/** Attachment serial: 4-digit zero padded counter. */
export function attachmentSerial(n: number): string {
  return String(n).padStart(4, '0')
}
