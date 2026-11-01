// Preview of the staff link: the same sample events as the Event Calendar preview (made up).
import { createLocalStore } from '../data/localStore'
import type { StaffSource } from './StaffCalendar'

export function demoStaffSource(): StaffSource {
  const store = createLocalStore()
  return {
    icsUrl: 'https://constellation.northstarchurch.org/track/calendar/sample-link-for-the-preview/calendar.ics',
    async load() {
      const { events } = await store.load()
      return { events: events.map(({ id, title, category, ministry, startDate, endDate, startTime, endTime, location }) => ({ id, title, category, ministry, startDate, endDate, startTime, endTime, location })) }
    }
  }
}
