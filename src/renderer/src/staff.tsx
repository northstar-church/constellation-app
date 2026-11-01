// The staff calendar page behind the private link (/track/calendar/<token>), or demo data in the preview.
import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { startTheme } from './data/theme'
import { StaffCalendar, type StaffSource } from './staffcal/StaffCalendar'
import { demoStaffSource } from './staffcal/demo'

startTheme()

function liveSource(): StaffSource {
  const token = location.pathname.split('/')[3] ?? ''
  const base = `/track/calendar/${token}`
  return {
    icsUrl: `${location.origin}${base}/calendar.ics`,
    async load() {
      const res = await fetch(`${base}/data`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'This calendar isn’t available. Check that you have the latest link.')
      return data
    }
  }
}

const source = import.meta.env.VITE_PREVIEW ? demoStaffSource() : liveSource()

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StaffCalendar source={source} />
  </React.StrictMode>
)
