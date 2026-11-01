import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import type { Milestone, TeamEvent } from '../data/types'

export const ymd = (d: Date) => format(d, 'yyyy-MM-dd')
export const todayStr = () => ymd(new Date())

export const eventEnd = (e: TeamEvent) => e.endDate ?? e.startDate

export const occursOn = (e: TeamEvent, day: string) => e.startDate <= day && day <= eventEnd(e)

export function timeLabel(t: string | null): string {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const ap = h >= 12 ? 'p' : 'a'
  const h12 = h % 12 || 12
  return m ? `${h12}:${String(m).padStart(2, '0')}${ap}` : `${h12}${ap}`
}

export function whenLabel(e: TeamEvent): string {
  const s = parseISO(e.startDate)
  let out = format(s, 'EEE, MMM d')
  if (e.endDate && e.endDate !== e.startDate) out += ` – ${format(parseISO(e.endDate), 'EEE, MMM d')}`
  if (e.startTime) out += ` · ${timeLabel(e.startTime)}${e.endTime ? `–${timeLabel(e.endTime)}` : ''}`
  return out
}

export function relativeLabel(due: string, eventDate: string): string {
  const d = differenceInCalendarDays(parseISO(due), parseISO(eventDate))
  if (d === 0) return 'day of'
  const abs = Math.abs(d)
  const unit = abs % 7 === 0 ? `${abs / 7} wk` : `${abs} d`
  return d < 0 ? `${unit} before` : `${unit} after`
}

export const byDue = (a: Milestone, b: Milestone) =>
  a.dueDate.localeCompare(b.dueDate) || a.sortOrder - b.sortOrder
