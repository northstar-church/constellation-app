import { addMonths, format, startOfMonth } from 'date-fns'
import { tint } from '../data/tint'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { IconChevron, IconFilter, IconLink, IconPeople, IconPlus } from '../components/Icons'
import { CATEGORIES, MINISTRIES, MINISTRY_COLORS, ministryColor, newId } from '../data/constants'
import { SignInError } from '../data/cloudStore'
import { stageById, type MediaRequest } from '../data/requests'
import type { RequestStore } from '../requests/requestStore'
import type { CalendarStore } from '../data/store'
import type { CalendarSnapshot, Milestone, TeamEvent } from '../data/types'
import { AgendaView } from './AgendaView'
import { EventEditor } from './EventEditor'
import { EventPanel } from './EventPanel'
import { MonthView } from './MonthView'
import { SubscribeDialog } from './SubscribeDialog'
import { EspaceDialog } from './EspaceDialog'
import { StaffLinkDialog } from './StaffLinkDialog'
import type { TeamStore } from '../team/teamStore'
import { TimelineView } from './TimelineView'
import { todayStr } from './util'

type View = 'timeline' | 'month' | 'agenda'

/** Ministry Events are colored by ministry, so their toggle shows all the colors */
const RAINBOW = `conic-gradient(${Object.values(MINISTRY_COLORS)
  .slice(1)
  .map((c) => c.color)
  .join(', ')})`

interface EditorState {
  event: TeamEvent
  milestones: Milestone[]
  isNew: boolean
}

function pref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`constellation.${key}`)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
function savePref(key: string, v: unknown) {
  try {
    localStorage.setItem(`constellation.${key}`, JSON.stringify(v))
  } catch {
    /* ignore */
  }
}

export function CalendarPage({
  store,
  me,
  query,
  onSignInExpired,
  focus,
  requests,
  onOpenRequest,
  team
}: {
  store: CalendarStore
  me: string
  query: string
  onSignInExpired: () => void
  /** Opens an event (e.g. from a media request); `n` changes on every click */
  focus?: { id: string; date: string | null; n: number } | null
  /** Media requests, to show and maintain request ↔ event links */
  requests?: RequestStore
  onOpenRequest?: (requestId: string) => void
  /** To know who can change which eSpace categories come in (team admins) */
  team?: TeamStore
}) {
  const [data, setData] = useState<CalendarSnapshot | null>(null)
  const [loadError, setLoadError] = useState('')
  const [view, setView] = useState<View>(() => pref('view3', 'month'))
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [ministry, setMinistry] = useState('all')
  const [hidden, setHidden] = useState<string[]>(() => pref('hiddenCategories', []))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [linked, setLinked] = useState<MediaRequest[]>([])
  useEffect(() => {
    if (!requests) return
    const load = () =>
      requests
        .load()
        .then((d) => setLinked(d.requests.filter((r) => r.eventId)))
        .catch(() => {})
    load()
    return requests.subscribe(load)
  }, [requests])
  const requestFor = (eventId: string) => linked.find((r) => r.eventId === eventId) ?? null
  useEffect(() => {
    if (!focus) return
    setSelectedId(focus.id)
    if (focus.date) setMonth(startOfMonth(new Date(`${focus.date}T12:00:00`)))
  }, [focus])
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [subscribing, setSubscribing] = useState(false)
  const [espaceOpen, setEspaceOpen] = useState(false)
  const [sharing, setSharing] = useState(false)
  // eSpace's own ministry list: for eSpace events' ministry picker and the ministry filter
  const [espaceMinistries, setEspaceMinistries] = useState<string[]>([])
  useEffect(() => {
    if (espaceOpen || !store.espace) return
    store.espace
      .status()
      .then((st) => setEspaceMinistries(st.ministries))
      .catch(() => {})
  }, [store, espaceOpen])
  const allMinistries = useMemo(() => [...new Set([...MINISTRIES, ...espaceMinistries])], [espaceMinistries])
  const [espaceAccess, setEspaceAccess] = useState({ canEdit: store.mode === 'demo', admins: 'Jeremy and Stephanie' })
  useEffect(() => {
    if (!espaceOpen || !team || store.mode === 'demo') return
    team
      .list()
      .then((t) => {
        const admins = t.filter((m) => m.admin)
        setEspaceAccess({ canEdit: admins.some((m) => m.name === me), admins: admins.map((m) => m.name.split(' ')[0]).join(' and ') || 'team admins' })
      })
      .catch(() => {})
  }, [espaceOpen, team, store.mode, me])
  const [live, setLive] = useState(true)

  const reload = useCallback(() => {
    store
      .load()
      .then((d) => {
        setData(d)
        setLoadError('')
      })
      .catch((e: Error) => (e instanceof SignInError ? onSignInExpired() : setLoadError(e.message)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  useEffect(() => {
    reload()
    return store.subscribe(reload, setLive)
  }, [store, reload])

  useEffect(() => savePref('view3', view), [view])
  useEffect(() => savePref('hiddenCategories', hidden), [hidden])

  const eventsById = useMemo(() => new Map((data?.events ?? []).map((e) => [e.id, e])), [data])

  const { events, milestones } = useMemo(() => {
    const norm = (s: string) => s.trim().toLowerCase()
    const q = norm(query)
    const matches = (e: TeamEvent) =>
      !q || [e.title, e.location, e.owner, e.ministry, e.notes].some((f) => f.toLowerCase().includes(q))
    const events = (data?.events ?? []).filter(
      (e) => !hidden.includes(e.category) && (ministry === 'all' || e.ministry === ministry) && matches(e)
    )
    const visible = new Set(events.map((e) => e.id))
    const milestones = (data?.milestones ?? []).filter((m) => visible.has(m.eventId))
    return { events, milestones }
  }, [data, hidden, ministry, query])

  // Color key: the ministries that have Ministry Events in what's on screen
  const legend = useMemo(() => {
    const from = view === 'month' ? format(month, 'yyyy-MM-01') : todayStr()
    const to = view === 'month' ? format(addMonths(month, 1), 'yyyy-MM-01') : '9999'
    const set = new Set((data?.events ?? []).filter((e) => e.category === 'ministry' && e.startDate >= from && e.startDate < to && !hidden.includes('ministry')).map((e) => e.ministry))
    return [...allMinistries.filter((m) => set.has(m)), ...[...set].filter((m) => !allMinistries.includes(m))]
  }, [data, view, month, hidden, allMinistries])

  const selected = selectedId ? eventsById.get(selectedId) ?? null : null

  const openEditor = (id: string) => {
    const event = eventsById.get(id)
    if (!event || !data) return
    setEditor({ event, milestones: data.milestones.filter((m) => m.eventId === id), isNew: false })
  }

  const newEvent = (date = todayStr()) =>
    setEditor({
      isNew: true,
      milestones: [],
      event: {
        id: newId(),
        title: '',
        category: 'ministry',
        ministry: 'All church',
        startDate: date,
        endDate: null,
        startTime: null,
        endTime: null,
        location: '',
        owner: me,
        notes: '',
        templateId: null,
        updatedAt: new Date().toISOString(),
        updatedBy: me
      }
    })

  const toggle = (m: Milestone) => {
    setData((d) => d && { ...d, milestones: d.milestones.map((x) => (x.id === m.id ? { ...x, done: !m.done } : x)) })
    store.setMilestoneDone(m.id, !m.done).catch((e: Error) => {
      if (e instanceof SignInError) return onSignInExpired()
      setLoadError(e.message)
      reload()
    })
  }

  const toggleCategory = (id: string) => setHidden((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]))

  return (
    <>
      <main className="main">
        <div className="page-head">
          <h1>Event Calendar</h1>
          <button className="btn-primary" onClick={() => newEvent()}>
            New Event <IconPlus size={18} />
          </button>
          <div className="pill-group" role="tablist" aria-label="View" style={{ marginLeft: 'auto' }}>
            {(['month', 'agenda', 'timeline'] as View[]).map((v) => (
              <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)} role="tab" aria-selected={view === v}>
                {v === 'timeline' ? 'Timeline' : v === 'month' ? 'Month' : 'Upcoming'}
              </button>
            ))}
          </div>
          {store.staffLink && (
            <button className="pill" onClick={() => setSharing(true)} title="A read-only page of this calendar for all staff">
              <IconPeople size={20} /> Staff Link
            </button>
          )}
          <button className="pill" onClick={() => setSubscribing(true)}>
            <IconLink size={20} /> Subscribe
          </button>
        </div>

        <div className="pills">
          {view === 'month' && (
            <div className="month-nav">
              <button onClick={() => setMonth((m) => addMonths(m, -1))} aria-label="Previous month"><IconChevron dir="left" size={18} /></button>
              <button className="label" onClick={() => setMonth(startOfMonth(new Date()))} title="Back to this month">{format(month, 'MMMM yyyy')}</button>
              <button onClick={() => setMonth((m) => addMonths(m, 1))} aria-label="Next month"><IconChevron dir="right" size={18} /></button>
            </div>
          )}
          <label className={`pill ${ministry !== 'all' ? 'on' : ''}`}>
            <IconFilter size={20} />
            <select value={ministry} onChange={(e) => setMinistry(e.target.value)} aria-label="Ministry">
              <option value="all">All Ministries</option>
              {allMinistries.map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
          {CATEGORIES.map((c) => {
            const off = hidden.includes(c.id)
            return (
              <button
                key={c.id}
                className={`tag pill-h ${off ? 'off' : ''}`}
                style={tint(c.soft, c.ink)}
                onClick={() => toggleCategory(c.id)}
                aria-pressed={!off}
                title={off ? `Show ${c.label}` : `Hide ${c.label}`}
              >
                <span className="dot" style={{ background: c.id === 'ministry' ? RAINBOW : c.color }} /> {c.label}
              </button>
            )
          })}
          {store.espace && (
            <button className="pill es-pill" onClick={() => setEspaceOpen(true)} title="Which eSpace events show up here">
              <i className="es-dot" /> eSpace
            </button>
          )}
        </div>

        {legend.length > 0 && (
          <div className="min-legend" aria-label="Ministry colors">
            {legend.map((m) => {
              const mc = ministryColor(m)
              return (
                <button key={m} className={ministry === m ? 'on' : ''} onClick={() => setMinistry(ministry === m ? 'all' : m)} title={ministry === m ? 'Show all ministries' : `Only ${m}`}>
                  <i style={{ background: mc.color }} /> {m}
                </button>
              )
            })}
          </div>
        )}

        {store.mode === 'demo' && (
          <div className="banner">Demo mode: sample events, saved only on this computer. Once connected to the team hub, everyone shares one calendar and changes appear live.</div>
        )}
        {store.mode === 'cloud' && !live && <div className="banner">You’re offline or reconnecting. Teammates’ changes will appear when the connection is back.</div>}
        {loadError && <div className="banner warn">{loadError}</div>}
        {query && <div className="banner">Showing results for “{query}” · {events.length} event{events.length === 1 ? '' : 's'}</div>}

        <div className="content" key={view}>
          {!data ? (
            <div className="empty">Loading…</div>
          ) : view === 'timeline' ? (
            <TimelineView events={events} milestones={milestones} selectedId={selectedId} onOpen={setSelectedId} />
          ) : view === 'month' ? (
            <MonthView month={month} events={events} milestones={milestones} eventsById={eventsById} showMilestones={false} onOpen={setSelectedId} onNew={newEvent} />
          ) : (
            <AgendaView events={events} milestones={milestones} eventsById={eventsById} showMilestones={false} onOpen={setSelectedId} onToggle={toggle} />
          )}
        </div>
      </main>

      {selected && data && (
        <EventPanel
          key={selected.id}
          event={selected}
          milestones={data.milestones.filter((m) => m.eventId === selected.id)}
          onClose={() => setSelectedId(null)}
          onEdit={() => openEditor(selected.id)}
          onToggle={toggle}
          seriesDates={selected.espace ? data.events.filter((x) => x.espace?.eventId === selected.espace!.eventId && x.startDate >= todayStr()).length : 0}
          linkedRequest={(() => {
            const r = requestFor(selected.id)
            return r ? { id: r.id, title: r.title, requesterName: r.requesterName, stage: stageById(r.stage).label } : null
          })()}
          onOpenRequest={onOpenRequest}
        />
      )}
      {sharing && store.staffLink && <StaffLinkDialog link={store.staffLink} onClose={() => setSharing(false)} />}
      {espaceOpen && store.espace && <EspaceDialog espace={store.espace} canEdit={espaceAccess.canEdit} admins={espaceAccess.admins} onClose={() => setEspaceOpen(false)} />}
      {subscribing && <SubscribeDialog feeds={store.feeds} onClose={() => setSubscribing(false)} />}
      {editor && (
        <EventEditor
          key={editor.event.id}
          initial={editor.event}
          initialMilestones={editor.milestones}
          isNew={editor.isNew}
          me={me}
          espaceMinistries={espaceMinistries}
          onSave={async (e, ms) => {
            await store.saveEvent(e, ms)
            // A recurring eSpace event's ministry belongs to the whole series (the server does this itself)
            if (store.mode === 'demo' && e.espace?.ministryByHand && data) {
              const series = data.events.filter((x) => x.id !== e.id && x.espace?.eventId === e.espace!.eventId && x.ministry !== e.ministry)
              for (const x of series) await store.saveEvent({ ...x, ministry: e.ministry, espace: { ...x.espace!, ministryByHand: true } }, data.milestones.filter((m) => m.eventId === x.id))
            }
            setSelectedId(e.id)
            // Moving the event moves the linked request's event date with it.
            const r = requestFor(e.id)
            if (r && requests && r.eventDate !== e.startDate) await requests.update(r.id, { eventDate: e.startDate }).catch(() => {})
          }}
          onDelete={async (id) => {
            await store.deleteEvent(id)
            setSelectedId(null)
            // The server clears the link itself; demo mode has no server, so clear it here.
            const r = requestFor(id)
            if (r && requests?.mode === 'demo') await requests.update(r.id, { eventId: null }).catch(() => {})
          }}
          onClose={() => setEditor(null)}
        />
      )}
    </>
  )
}
