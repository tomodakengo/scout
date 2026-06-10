import { describe, it, expect } from 'vitest'
import { formatClock, parseClock, localDateStamp, sessionDirStamp, isoWithOffset } from './time'
import { slugify, nextCharterId, attachmentSerial } from './slug'

// ---------------------------------------------------------------------------
// formatClock / parseClock round-trip
// ---------------------------------------------------------------------------
describe('formatClock', () => {
  it('formats 0 seconds as 00:00', () => {
    expect(formatClock(0)).toBe('00:00')
  })

  it('formats 65 seconds as 01:05', () => {
    expect(formatClock(65)).toBe('01:05')
  })

  it('formats 720 seconds as 12:00', () => {
    expect(formatClock(720)).toBe('12:00')
  })

  it('formats exactly 99 minutes', () => {
    expect(formatClock(99 * 60)).toBe('99:00')
  })

  it('formats >99 minutes (100 min = 6000 s)', () => {
    expect(formatClock(6000)).toBe('100:00')
  })

  it('formats 120:45 (7245 seconds)', () => {
    expect(formatClock(7245)).toBe('120:45')
  })

  it('clamps negative values to 00:00', () => {
    expect(formatClock(-10)).toBe('00:00')
  })

  it('floors fractional seconds', () => {
    expect(formatClock(65.9)).toBe('01:05')
  })
})

describe('parseClock', () => {
  it('parses 00:00 as 0', () => {
    expect(parseClock('00:00')).toBe(0)
  })

  it('parses 01:05 as 65', () => {
    expect(parseClock('01:05')).toBe(65)
  })

  it('parses 12:00 as 720', () => {
    expect(parseClock('12:00')).toBe(720)
  })

  it('parses >99 minutes: 100:00 as 6000', () => {
    expect(parseClock('100:00')).toBe(6000)
  })

  it('parses 120:45 as 7245', () => {
    expect(parseClock('120:45')).toBe(7245)
  })

  it('returns null for malformed input (single digit mm)', () => {
    expect(parseClock('0:00')).toBeNull()
  })

  it('returns null for malformed input (three digit ss)', () => {
    expect(parseClock('00:000')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseClock('')).toBeNull()
  })

  it('returns null for non-numeric input', () => {
    expect(parseClock('ab:cd')).toBeNull()
  })

  it('trims surrounding whitespace', () => {
    expect(parseClock('  01:05  ')).toBe(65)
  })
})

describe('formatClock/parseClock round-trip', () => {
  const cases = [0, 65, 720, 5999, 6000, 7245, 99 * 60 + 59]
  for (const s of cases) {
    it(`round-trips ${s} seconds`, () => {
      expect(parseClock(formatClock(s))).toBe(s)
    })
  }
})

// ---------------------------------------------------------------------------
// localDateStamp
// ---------------------------------------------------------------------------
describe('localDateStamp', () => {
  it('returns YYYY-MM-DD shape', () => {
    const result = localDateStamp(new Date(2026, 5, 10)) // June 10, 2026 (month 0-indexed)
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('returns correct date for known Date', () => {
    // new Date(year, month, day) — uses local time
    const d = new Date(2026, 5, 10) // June 10, 2026
    expect(localDateStamp(d)).toBe('2026-06-10')
  })

  it('pads single-digit month', () => {
    const d = new Date(2026, 0, 5) // January 5
    expect(localDateStamp(d)).toBe('2026-01-05')
  })

  it('pads single-digit day', () => {
    const d = new Date(2026, 11, 3) // December 3
    expect(localDateStamp(d)).toBe('2026-12-03')
  })
})

// ---------------------------------------------------------------------------
// sessionDirStamp
// ---------------------------------------------------------------------------
describe('sessionDirStamp', () => {
  it('returns YYYY-MM-DD-HHmm shape', () => {
    const d = new Date(2026, 5, 10, 14, 30, 0)
    const result = sessionDirStamp(d)
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}-\d{4}$/)
  })

  it('returns correct stamp for known date', () => {
    const d = new Date(2026, 5, 10, 14, 30, 0)
    expect(sessionDirStamp(d)).toBe('2026-06-10-1430')
  })

  it('pads hours and minutes', () => {
    const d = new Date(2026, 0, 5, 9, 3, 0)
    expect(sessionDirStamp(d)).toBe('2026-01-05-0903')
  })

  it('does not include seconds', () => {
    const d = new Date(2026, 5, 10, 14, 30, 59)
    expect(sessionDirStamp(d)).toBe('2026-06-10-1430')
  })
})

// ---------------------------------------------------------------------------
// isoWithOffset
// ---------------------------------------------------------------------------
describe('isoWithOffset', () => {
  it('matches ISO 8601 with offset shape', () => {
    const result = isoWithOffset(new Date(2026, 5, 10, 14, 30, 0))
    // e.g. 2026-06-10T14:30:00+09:00 or 2026-06-10T14:30:00+00:00
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
  })

  it('contains the T separator between date and time', () => {
    const result = isoWithOffset(new Date(2026, 5, 10, 14, 30, 0))
    expect(result).toContain('T')
  })

  it('has a timezone offset at the end', () => {
    const result = isoWithOffset(new Date(2026, 5, 10, 14, 30, 0))
    expect(result).toMatch(/[+-]\d{2}:\d{2}$/)
  })

  it('preserves the date part', () => {
    const d = new Date(2026, 5, 10, 14, 30, 0)
    const result = isoWithOffset(d)
    expect(result.startsWith('2026-06-10T')).toBe(true)
  })

  it('preserves hours minutes seconds in local time', () => {
    const d = new Date(2026, 5, 10, 14, 30, 55)
    const result = isoWithOffset(d)
    expect(result).toContain('T14:30:55')
  })
})

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------
describe('slugify', () => {
  it('lowercases ASCII text', () => {
    expect(slugify('PaymentErrors')).toBe('paymenterrors')
  })

  it('replaces spaces with dashes', () => {
    expect(slugify('payment error paths')).toBe('payment-error-paths')
  })

  it('strips leading/trailing dashes', () => {
    expect(slugify('  hello world  ')).toBe('hello-world')
  })

  it('collapses multiple non-ascii characters into one dash', () => {
    expect(slugify('hello   world')).toBe('hello-world')
  })

  it('returns "charter" for a Japanese-only title (no ASCII)', () => {
    expect(slugify('決済フローの異常系を探索する')).toBe('charter')
  })

  it('returns "charter" for an empty string', () => {
    expect(slugify('')).toBe('charter')
  })

  it('trims to maxLength default (40)', () => {
    const longTitle = 'a'.repeat(50)
    const result = slugify(longTitle)
    expect(result.length).toBeLessThanOrEqual(40)
  })

  it('respects custom maxLength', () => {
    const result = slugify('hello-world-testing', 5)
    expect(result.length).toBeLessThanOrEqual(5)
  })

  it('does not end with a dash after trimming', () => {
    // 10 chars: "hello-worl" then trimmed to 9 → "hello-wor"
    const result = slugify('hello world', 9)
    expect(result.endsWith('-')).toBe(false)
  })

  it('handles mixed ASCII and Japanese (uses only ASCII part)', () => {
    // "payment 決済" → normalize → "payment-" → strip trailing dash → "payment"
    expect(slugify('payment 決済')).toBe('payment')
  })

  it('handles numeric characters', () => {
    expect(slugify('Test 123')).toBe('test-123')
  })
})

// ---------------------------------------------------------------------------
// nextCharterId
// ---------------------------------------------------------------------------
describe('nextCharterId', () => {
  it('returns 2026-0001 for an empty list', () => {
    expect(nextCharterId([], 2026)).toBe('2026-0001')
  })

  it('increments from max existing id in the year', () => {
    expect(nextCharterId(['2026-0001', '2026-0002', '2026-0003'], 2026)).toBe('2026-0004')
  })

  it('ignores ids from other years', () => {
    expect(nextCharterId(['2025-0099', '2026-0001'], 2026)).toBe('2026-0002')
  })

  it('ignores ids from other years (only other year present)', () => {
    expect(nextCharterId(['2025-0010'], 2026)).toBe('2026-0001')
  })

  it('pads with zeros to 4 digits', () => {
    const id = nextCharterId([], 2026)
    expect(id).toMatch(/^2026-\d{4}$/)
  })

  it('handles gaps in sequence', () => {
    expect(nextCharterId(['2026-0001', '2026-0005'], 2026)).toBe('2026-0006')
  })

  it('uses the correct year prefix', () => {
    expect(nextCharterId([], 2027)).toBe('2027-0001')
  })

  it('handles large existing number', () => {
    expect(nextCharterId(['2026-0099'], 2026)).toBe('2026-0100')
  })
})

// ---------------------------------------------------------------------------
// attachmentSerial
// ---------------------------------------------------------------------------
describe('attachmentSerial', () => {
  it('pads single digit to 4 digits', () => {
    expect(attachmentSerial(1)).toBe('0001')
  })

  it('pads double digit to 4 digits', () => {
    expect(attachmentSerial(12)).toBe('0012')
  })

  it('pads triple digit to 4 digits', () => {
    expect(attachmentSerial(123)).toBe('0123')
  })

  it('does not pad 4-digit number', () => {
    expect(attachmentSerial(1234)).toBe('1234')
  })

  it('returns 0000 for 0', () => {
    expect(attachmentSerial(0)).toBe('0000')
  })

  it('does not truncate numbers larger than 4 digits', () => {
    expect(attachmentSerial(12345)).toBe('12345')
  })
})
