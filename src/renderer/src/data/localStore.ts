import type { CalendarStore } from './store'
import type { CalendarSnapshot, CategoryId, Milestone, TeamEvent } from './types'
import { demoSnapshot } from './demoData'
import { ESPACE_MINISTRIES } from './espaceStaff'
import { defaultBookers, defaultEspaceMapping, espaceBookers, espaceCategories, espaceEvents, type BookerMap } from './espaceDemo'

const KEY = 'constellation.calendar.v7'

type DemoState = CalendarSnapshot & { espaceMap: Record<number, CategoryId | null>; espaceBookers: BookerMap; espaceMinistries: string[]; espaceSync: string }

function read(): DemoState {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as DemoState
  } catch {
    /* storage unavailable: fall through to demo data */
  }
  const espaceMap = defaultEspaceMapping()
  const espaceBookers = defaultBookers()
  const demo = demoSnapshot()
  return { ...demo, events: [...demo.events, ...espaceEvents(espaceMap, espaceBookers)], espaceMap, espaceBookers, espaceMinistries: [...ESPACE_MINISTRIES], espaceSync: new Date(Date.now() - 4 * 60_000).toISOString() }
}

/** Demo mode: data lives only on this computer. Used until Supabase keys are added. */
export function createLocalStore(): CalendarStore {
  let state = read()
  const listeners = new Set<() => void>()

  const commit = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      /* keep working in memory */
    }
    listeners.forEach((l) => l())
  }

  // Same as a sync: bring in what's switched on, drop what's off, and keep everyone's edits on the rest
  const resync = (espaceMap: DemoState['espaceMap'], bookers: BookerMap) => {
    const fresh = new Map(espaceEvents(espaceMap, bookers).map((e) => [e.id, e]))
    const kept = state.events
      .filter((e) => !e.espace || fresh.has(e.id))
      .map((e) => {
        if (!e.espace) return e
        const f = fresh.get(e.id)!
        return { ...e, category: f.category, ministry: e.espace.ministryByHand ? e.ministry : f.ministry }
      })
    const have = new Set(kept.map((e) => e.id))
    const events = [...kept, ...[...fresh.values()].filter((e) => !have.has(e.id))]
    const ids = new Set(events.map((e) => e.id))
    state = { ...state, espaceMap, espaceBookers: bookers, events, milestones: state.milestones.filter((m) => ids.has(m.eventId)), espaceSync: new Date().toISOString() }
    commit()
  }

  return {
    mode: 'demo',
    async load() {
      return structuredClone({ events: state.events, milestones: state.milestones })
    },
    subscribe(onChange) {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    async saveEvent(event: TeamEvent, milestones: Milestone[]) {
      state = {
        ...state,
        events: [...state.events.filter((e) => e.id !== event.id), event],
        milestones: [...state.milestones.filter((m) => m.eventId !== event.id), ...milestones]
      }
      commit()
    },
    async deleteEvent(id) {
      state = {
        ...state,
        events: state.events.filter((e) => e.id !== id),
        milestones: state.milestones.filter((m) => m.eventId !== id)
      }
      commit()
    },
    async setMilestoneDone(id, done) {
      state = {
        ...state,
        milestones: state.milestones.map((m) => (m.id === id ? { ...m, done } : m))
      }
      commit()
    },
    staffLink: {
      get: async () => 'https://constellation.northstarchurch.org/track/calendar/sample-link-for-the-preview',
      rotate: async () => 'https://constellation.northstarchurch.org/track/calendar/a-new-sample-link'
    },
    espace: {
      async status() {
        return { connected: true, lastSync: state.espaceSync, lastError: null, categories: espaceCategories(state.espaceMap), bookers: espaceBookers(state.espaceMap, state.espaceBookers), ministries: state.espaceMinistries }
      },
      async setMapping(categoryId, mapTo) {
        resync({ ...state.espaceMap, [categoryId]: mapTo }, state.espaceBookers)
      },
      async setBooker(email, name, ministry) {
        const espaceBookers = { ...state.espaceBookers }
        if (ministry) espaceBookers[email.toLowerCase()] = { name, ministry }
        else delete espaceBookers[email.toLowerCase()]
        resync(state.espaceMap, espaceBookers)
      },
      async setMinistries(list) {
        const used = new Set(Object.values(state.espaceBookers).map((b) => b.ministry))
        const gone = state.espaceMinistries.filter((m) => !list.includes(m) && used.has(m))
        if (gone.length) throw new Error(`Move everyone off ${gone.join(', ')} first.`)
        state = { ...state, espaceMinistries: list }
        commit()
      },
      async syncNow() {
        await new Promise((r) => setTimeout(r, 900))
        state = { ...state, espaceSync: new Date().toISOString() }
        commit()
      }
    }
  }
}
