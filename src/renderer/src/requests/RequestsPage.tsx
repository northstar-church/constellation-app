import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import { stageBg, tint } from '../data/tint'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Avatar, AvatarStack } from '../components/Avatar'
import { IconPeople, IconPlus } from '../components/Icons'
import { SignInError } from '../data/cloudStore'
import type { ReviewLinks } from './RequestPanel'
import { DEFAULT_TEAM, DELIVERABLES, assignableTeam, REQUEST_MINISTRIES, STAGES, deliverableTag, ministryTag, type MediaRequest, type RequestsSnapshot, type StageId, type TeamMember } from '../data/requests'
import { NewRequestDialog } from './NewRequestDialog'
import { EventEditor } from '../calendar/EventEditor'
import type { CalendarStore } from '../data/store'
import type { TeamEvent } from '../data/types'
import { MINISTRIES, newId } from '../data/constants'
import { RequestPanel } from './RequestPanel'
import type { RequestStore } from './requestStore'

/** Column header colors, like the Notion board's statuses. */
export const STAGE_COLORS: Record<StageId, { soft: string; ink: string; dot: string }> = {
  received: { soft: '#fde4e1', ink: '#b8432f', dot: '#e5644e' },
  scheduled: { soft: '#fdecd6', ink: '#9a5a12', dot: '#e59a3a' },
  design: { soft: '#dff1fc', ink: '#21709f', dot: '#00b7e2' },
  proof: { soft: '#efe6fb', ink: '#7445ad', dot: '#a679de' },
  approved: { soft: '#e3f6e5', ink: '#3b934b', dot: '#5cc46c' },
  delivered: { soft: '#ececee', ink: '#5f5f66', dot: '#a1a1aa' }
}

const DELIVERED_DAYS = 21

function dueBadge(due: string | null, stage: StageId) {
  if (!due) return null
  const days = differenceInCalendarDays(parseISO(due), new Date())
  const late = days < 0 && stage !== 'delivered'
  const soon = days >= 0 && days <= 3 && stage !== 'delivered' && stage !== 'approved'
  return (
    <span className={`due ${late ? 'late' : soon ? 'soon' : ''}`}>
      {format(parseISO(due), 'MMMM d, yyyy')}
      {late ? ' · overdue' : soon ? (days === 0 ? ' · today' : ` · ${days}d`) : ''}
    </span>
  )
}

interface Props {
  store: RequestStore
  me: { name: string; email: string }
  query: string
  onSignInExpired: () => void
  /** Opens a request (from a notification); `n` changes on every click */
  focus?: { id: string; n: number } | null
  calendar: CalendarStore
  onOpenEvent: (eventId: string, date: string | null) => void
  /** Video Review, for a request's review section */
  reviews?: ReviewLinks
}

export function RequestsPage({ store, me, query, onSignInExpired, focus, calendar, onOpenEvent, reviews }: Props) {
  const [data, setData] = useState<RequestsSnapshot | null>(null)
  const [error, setError] = useState('')
  const [who, setWho] = useState<string>('all')
  const [ministry, setMinistry] = useState('all')
  const [kind, setKind] = useState('all')
  const [allDelivered, setAllDelivered] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overStage, setOverStage] = useState<StageId | null>(null)
  const [team, setTeam] = useState<TeamMember[]>(DEFAULT_TEAM)
  const [eventDraft, setEventDraft] = useState<{ requestId: string; event: TeamEvent } | null>(null)

  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof SignInError) onSignInExpired()
      else setError(e instanceof Error ? e.message : 'Something went wrong')
    },
    [onSignInExpired]
  )

  const reload = useCallback(() => {
    store
      .load()
      .then((d) => {
        setData(d)
        setError('')
      })
      .catch(fail)
  }, [store, fail])

  useEffect(() => {
    reload()
    return store.subscribe(reload)
  }, [store, reload])

  useEffect(() => {
    store.team().then(setTeam).catch(() => {})
  }, [store])

  useEffect(() => {
    if (focus) setSelectedId(focus.id)
  }, [focus])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const cutoff = Date.now() - DELIVERED_DAYS * 864e5
    return (data?.requests ?? []).filter((r) => {
      if (who === 'unassigned' && r.assignees.length) return false
      if (who !== 'all' && who !== 'unassigned' && !r.assignees.some((a) => a.name === who && !a.done)) return false
      if (ministry !== 'all' && r.ministry !== ministry) return false
      if (kind !== 'all' && !r.deliverables.includes(kind)) return false
      if (r.stage === 'delivered' && !allDelivered && Date.parse(r.updatedAt) < cutoff) return false
      if (q && ![r.title, r.requesterName, r.ministry, r.details, ...r.assignees.map((a) => a.name), ...r.deliverables].some((f) => f.toLowerCase().includes(q))) return false
      return true
    })
  }, [data, who, ministry, kind, allDelivered, query])

  const byStage = useMemo(() => {
    const m = new Map<StageId, MediaRequest[]>(STAGES.map((s) => [s.id, []]))
    for (const r of visible) m.get(r.stage)?.push(r)
    for (const list of m.values()) list.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.sortOrder - b.sortOrder)
    return m
  }, [visible])

  const counts = useMemo(() => {
    const open = (data?.requests ?? []).filter((r) => r.stage !== 'delivered')
    return { open: open.length, proof: open.filter((r) => r.stage === 'proof').length }
  }, [data])

  const historyCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of data?.comments ?? []) m.set(c.requestId, (m.get(c.requestId) ?? 0) + 1)
    return m
  }, [data])

  const fileCount = useMemo(() => {
    const m = new Map<string, { proof: number; final: number; reference: number }>()
    for (const f of data?.files ?? []) {
      const c = m.get(f.requestId) ?? { proof: 0, final: 0, reference: 0 }
      c[f.kind]++
      m.set(f.requestId, c)
    }
    return m
  }, [data])

  const requesters = useMemo(() => [...new Set((data?.requests ?? []).map((r) => r.requesterName).filter(Boolean))].sort(), [data])
  const selected = data?.requests.find((r) => r.id === selectedId) ?? null

  const move = async (id: string, stage: StageId) => {
    const r = data?.requests.find((x) => x.id === id)
    if (!r || r.stage === stage) return
    // Moving to Proof Ready without a proof link: open the card so it can be added first.
    if (stage === 'proof' && !r.proofUrl) {
      setSelectedId(id)
      setError('Add the proof link in the panel, then move it to Proof Ready so the requester can review it.')
      return
    }
    setData((d) => d && { ...d, requests: d.requests.map((x) => (x.id === id ? { ...x, stage } : x)) })
    store.update(id, { stage }).catch((e) => {
      fail(e)
      reload()
    })
  }

  return (
    <>
      <main className="main">
        <div className="page-head">
          <h1>Media Requests</h1>
          <button className="btn-primary" onClick={() => setCreating(true)}>
            New Request <IconPlus size={18} />
          </button>
          <div className="contributors">
            {counts.open} Open{counts.proof ? ` · ${counts.proof} Awaiting Approval` : ''}
            {requesters.length > 0 && <AvatarStack names={requesters} max={3} size={40} />}
          </div>
        </div>

        <div className="pills">
          <div className="pill-group" role="tablist" aria-label="Assigned to">
            {['all', ...assignableTeam(team).map((m) => m.name), 'unassigned'].map((p) => (
              <button key={p} className={who === p ? 'on' : ''} role="tab" aria-selected={who === p} onClick={() => setWho(p)}>
                {p === 'all' ? 'Everyone' : p === 'unassigned' ? 'Unassigned' : p.split(' ')[0]}
              </button>
            ))}
          </div>
          <label className={`pill ${ministry !== 'all' ? 'on' : ''}`}>
            <IconPeople size={20} />
            <select value={ministry} onChange={(e) => setMinistry(e.target.value)} aria-label="Ministry">
              <option value="all">All Ministries</option>
              {REQUEST_MINISTRIES.map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
          <label className={`pill ${kind !== 'all' ? 'on' : ''}`}>
            <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Deliverable">
              <option value="all">All Deliverables</option>
              {DELIVERABLES.map((d) => <option key={d.label}>{d.label}</option>)}
            </select>
          </label>
          <button className={`pill ${allDelivered ? 'on' : ''}`} onClick={() => setAllDelivered((v) => !v)} aria-pressed={allDelivered}>
            {allDelivered ? 'Showing All Delivered' : `Delivered: Last ${DELIVERED_DAYS} Days`}
          </button>
        </div>

        {store.mode === 'demo' && (
          <div className="banner">Demo mode: sample requests saved only on this computer. Once connected, Typeform submissions land here and requesters get Slack updates.</div>
        )}
        {error && (
          <div className="banner warn" role="alert" onClick={() => setError('')}>
            {error}
          </div>
        )}
        {query && <div className="banner">Showing requests matching “{query}” · {visible.length}</div>}

        <div className="content">
          {!data ? (
            <div className="empty">Loading…</div>
          ) : (
            <div className="board">
              {STAGES.map((s) => {
                const list = byStage.get(s.id) ?? []
                const c = STAGE_COLORS[s.id]
                return (
                  <section
                    key={s.id}
                    className={`column ${overStage === s.id ? 'over' : ''}`}
                    style={{ background: stageBg(c.soft, c.dot) }}
                    onDragOver={(e) => {
                      if (!dragId) return
                      e.preventDefault()
                      setOverStage(s.id)
                    }}
                    onDragLeave={() => setOverStage((o) => (o === s.id ? null : o))}
                    onDrop={(e) => {
                      e.preventDefault()
                      setOverStage(null)
                      if (dragId) void move(dragId, s.id)
                      setDragId(null)
                    }}
                    aria-label={`${s.label}, ${list.length} requests`}
                  >
                    <header className="column-head">
                      <span className="stage-pill" style={tint(c.soft, c.ink)}>
                        <span className="dot" style={{ background: c.dot }} /> {s.label}
                      </span>
                      <span className="count">{list.length}</span>
                    </header>
                    {list.map((r) => (
                      <button
                        key={r.id}
                        className={`rq-card ${selectedId === r.id ? 'selected' : ''} ${dragId === r.id ? 'dragging' : ''}`}
                        draggable
                        onDragStart={(e) => {
                          setDragId(r.id)
                          e.dataTransfer.effectAllowed = 'move'
                        }}
                        onDragEnd={() => {
                          setDragId(null)
                          setOverStage(null)
                        }}
                        onClick={() => setSelectedId(r.id)}
                      >
                        <span className="rq-title">{r.title}</span>
                        {r.deliverables.length > 0 && (
                          <span className="rq-tags">
                            {r.deliverables.map((d) => {
                              const t = deliverableTag(d)
                              return (
                                <span key={d} className="rq-tag" style={tint(t.soft, t.ink)}>
                                  {d}
                                </span>
                              )
                            })}
                          </span>
                        )}
                        {r.ministry && (
                          <span className="rq-tags">
                            <span className="rq-tag" style={tint(ministryTag(r.ministry).soft, ministryTag(r.ministry).ink)}>
                              {r.ministry}
                            </span>
                          </span>
                        )}
                        {dueBadge(r.dueDate, r.stage)}
                        <span className="rq-foot">
                          <span className="rq-from">{r.requesterName || r.requesterEmail || 'Unknown requester'}</span>
                          {(fileCount.get(r.id)?.reference ?? 0) > 0 && <span className="rq-notes" title="Files from the requester">📎 {fileCount.get(r.id)!.reference}</span>}
                          {(fileCount.get(r.id)?.proof ?? 0) > 0 && <span className="rq-notes" title="Proof files">🖼 {fileCount.get(r.id)!.proof}</span>}
                          {(fileCount.get(r.id)?.final ?? 0) > 0 && <span className="rq-notes" title="Final artwork">📦 {fileCount.get(r.id)!.final}</span>}
                          {(historyCount.get(r.id) ?? 0) > 0 && <span className="rq-notes" title="Team comments">💬 {historyCount.get(r.id)}</span>}
                          {r.assignees.length ? (
                            <span className="rq-people" title={r.assignees.map((a) => `${a.name}${a.done ? ' (done)' : ''}`).join(', ')}>
                              {[...r.assignees].sort((a, b) => Number(a.done) - Number(b.done)).map((a) => (
                                <span key={a.name} className={`rq-person ${a.done ? 'done' : ''}`}>
                                  <Avatar name={a.name} size={28} />
                                  {a.done && <span className="rq-check">✓</span>}
                                </span>
                              ))}
                            </span>
                          ) : (
                            <span className="rq-unassigned">Unassigned</span>
                          )}
                        </span>
                      </button>
                    ))}
                    {list.length === 0 && <div className="column-empty">{dragId ? 'Drop here' : 'Nothing here'}</div>}
                  </section>
                )
              })}
            </div>
          )}
        </div>
      </main>

      {selected && data && (
        <RequestPanel
          key={selected.id}
          request={selected}
          history={data.history.filter((h) => h.requestId === selected.id)}
          files={data.files.filter((f) => f.requestId === selected.id)}
          comments={data.comments.filter((c) => c.requestId === selected.id)}
          me={me}
          team={team}
          store={store}
          reviews={reviews}
          onOpenEvent={(eventId) => onOpenEvent(eventId, selected.eventDate)}
          onAddToCalendar={() => {
            const r = selected
            const today = new Date().toISOString().slice(0, 10)
            setEventDraft({
              requestId: r.id,
              event: {
                id: newId(),
                title: r.title,
                category: 'ministry',
                ministry: MINISTRIES.includes(r.ministry) ? r.ministry : 'All church',
                startDate: r.eventDate ?? r.dueDate ?? today,
                endDate: null,
                startTime: null,
                endTime: null,
                location: '',
                owner: r.requesterName,
                notes: [`From media request: ${r.title}${r.requesterName ? ` (${r.requesterName})` : ''}`, r.details].filter(Boolean).join('\n\n').slice(0, 4900),
                templateId: null,
                updatedAt: new Date().toISOString(),
                updatedBy: me.name
              }
            })
          }}
          onClose={() => setSelectedId(null)}
          onError={fail}
        />
      )}
      {eventDraft && (
        <EventEditor
          key={eventDraft.event.id}
          initial={eventDraft.event}
          initialMilestones={[]}
          isNew
          me={me.name}
          onSave={async (e, ms) => {
            await calendar.saveEvent(e, ms)
            await store.update(eventDraft.requestId, { eventId: e.id, ...(e.startDate ? { eventDate: e.startDate } : {}) })
          }}
          onDelete={async () => {}}
          onClose={() => setEventDraft(null)}
        />
      )}
      {creating && (
        <NewRequestDialog
          me={me.name}
          onClose={() => setCreating(false)}
          onCreate={async (input) => {
            const r = await store.create(input)
            setSelectedId(r.id)
            reload()
          }}
        />
      )}
    </>
  )
}
