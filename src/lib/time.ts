/** Format elapsed seconds as MM:SS (minutes may exceed 99 in theory; pad to 2). */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const mm = Math.floor(s / 60)
  const ss = s % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

/** Parse "MM:SS" into seconds. Returns null when malformed. */
export function parseClock(text: string): number | null {
  const m = /^(\d{2,}):(\d{2})$/.exec(text.trim())
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/** Local date as YYYY-MM-DD */
export function localDateStamp(d: Date = new Date()): string {
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}

/** Session directory timestamp: YYYY-MM-DD-HHmm */
export function sessionDirStamp(d: Date = new Date()): string {
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${localDateStamp(d)}-${hh}${mi}`
}

/** ISO 8601 with local UTC offset, e.g. 2026-06-10T14:30:00+09:00 */
export function isoWithOffset(d: Date = new Date()): string {
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0')
  const offMin = -d.getTimezoneOffset()
  const sign = offMin >= 0 ? '+' : '-'
  const offH = pad(offMin / 60)
  const offM = pad(offMin % 60)
  const hh = pad(d.getHours())
  const mi = pad(d.getMinutes())
  const ss = pad(d.getSeconds())
  return `${localDateStamp(d)}T${hh}:${mi}:${ss}${sign}${offH}:${offM}`
}
