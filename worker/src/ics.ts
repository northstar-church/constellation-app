import type { Milestone, TeamEvent } from '../../src/renderer/src/data/types'

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** RFC 5545 lines are folded at 75 octets. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line
  const out: string[] = []
  let cur = ''
  let len = 0
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length
    if (len + n > (out.length ? 74 : 75)) {
      out.push(cur)
      cur = ''
      len = 0
    }
    cur += ch
    len += n
  }
  out.push(cur)
  return out.join('\r\n ')
}

const d = (date: string) => date.replace(/-/g, '')
const t = (time: string) => time.replace(':', '') + '00'

function nextDay(date: string): string {
  const x = new Date(`${date}T12:00:00Z`)
  x.setUTCDate(x.getUTCDate() + 1)
  return x.toISOString().slice(0, 10)
}

const stamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d+/, '').slice(0, 15) + 'Z'

const TZ = 'America/New_York'
const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  `TZID:${TZ}`,
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0400',
  'TZNAME:EDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0400',
  'TZOFFSETTO:-0500',
  'TZNAME:EST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE'
]

export function buildIcs(name: string, events: TeamEvent[], milestones: Milestone[], host: string): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NorthStar Creative//Constellation//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(name)}`,
    `X-WR-TIMEZONE:${TZ}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...VTIMEZONE
  ]

  for (const e of events) {
    const last = e.endDate ?? e.startDate
    lines.push('BEGIN:VEVENT', `UID:${e.id}@${host}`, `DTSTAMP:${stamp(e.updatedAt)}`, `LAST-MODIFIED:${stamp(e.updatedAt)}`)
    if (e.startTime) {
      lines.push(`DTSTART;TZID=${TZ}:${d(e.startDate)}T${t(e.startTime)}`)
      const endTime = e.endTime && (e.endTime > e.startTime || last !== e.startDate) ? e.endTime : null
      if (endTime) lines.push(`DTEND;TZID=${TZ}:${d(last)}T${t(endTime)}`)
      else lines.push('DURATION:PT1H')
    } else {
      lines.push(`DTSTART;VALUE=DATE:${d(e.startDate)}`, `DTEND;VALUE=DATE:${d(nextDay(last))}`)
    }
    lines.push(`SUMMARY:${esc(e.title)}`)
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`)
    const desc = [e.ministry && `Ministry: ${e.ministry}`, e.owner && `Contact: ${e.owner}`, e.notes].filter(Boolean).join('\n')
    if (desc) lines.push(`DESCRIPTION:${esc(desc)}`)
    lines.push('END:VEVENT')
  }

  const byId = new Map(events.map((e) => [e.id, e]))
  for (const m of milestones) {
    const ev = byId.get(m.eventId)
    if (!ev) continue
    lines.push(
      'BEGIN:VEVENT',
      `UID:${m.id}@${host}`,
      `DTSTAMP:${stamp(ev.updatedAt)}`,
      `DTSTART;VALUE=DATE:${d(m.dueDate)}`,
      `DTEND;VALUE=DATE:${d(nextDay(m.dueDate))}`,
      `SUMMARY:${esc(`${m.done ? '✓' : '◆'} ${m.title} (${ev.title})`)}`,
      'TRANSP:TRANSPARENT'
    )
    if (m.owner) lines.push(`DESCRIPTION:${esc(`Owner: ${m.owner}`)}`)
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
