import { formatDistanceToNow, parseISO } from 'date-fns'
import { useCallback, useEffect, useState } from 'react'
import { IconClose } from '../components/Icons'
import { CATEGORIES, categoryById, ministryColor } from '../data/constants'
import type { EspaceApi } from '../data/store'
import type { CategoryId, EspaceStatus } from '../data/types'
import { tint } from '../data/tint'

/** Which eSpace categories show up on the Event Calendar, and as what. */
export function EspaceDialog({ espace, canEdit, admins, onClose }: { espace: EspaceApi; canEdit: boolean; admins: string; onClose: () => void }) {
  const [st, setSt] = useState<EspaceStatus | null>(null)
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [, tick] = useState(0)

  const load = useCallback(() => {
    espace
      .status()
      .then(setSt)
      .catch((e: Error) => setError(e.message))
  }, [espace])
  useEffect(load, [load])
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const setMap = async (id: number, v: string) => {
    setError('')
    try {
      await espace.setMapping(id, (v || null) as CategoryId | null)
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const sync = async () => {
    setSyncing(true)
    setError('')
    try {
      await espace.syncNow()
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSyncing(false)
    }
  }

  const setBooker = async (email: string, name: string, ministry: string | null) => {
    setError('')
    try {
      await espace.setBooker(email, name, ministry)
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const [adding, setAdding] = useState<{ name: string; email: string; ministry: string } | null>(null)
  const addBooker = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!adding) return
    const email = adding.email.trim().toLowerCase()
    if (!adding.name.trim() || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return setError('Add their name and church email.')
    await setBooker(email, adding.name.trim(), adding.ministry)
    setAdding(null)
  }
  const [newMin, setNewMin] = useState<string | null>(null)
  const saveMinistries = async (list: string[]) => {
    setError('')
    try {
      await espace.setMinistries(list)
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const addMinistry = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = (newMin ?? '').trim()
    if (!name || !st) return
    if (st.ministries.some((m) => m.toLowerCase() === name.toLowerCase())) return setError(`${name} is already on the list.`)
    await saveMinistries([...st.ministries, name])
    setNewMin(null)
  }
  const inUse = new Set(st?.bookers.map((b) => b.ministry) ?? [])
  const unset = st?.bookers.filter((b) => !b.ministry && b.count) ?? []

  const on = st?.categories.filter((c) => c.mapTo) ?? []
  const total = on.reduce((n, c) => n + c.count, 0)

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal es-modal" role="dialog" aria-label="Events from eSpace">
        <div className="modal-head">
          <h2>Events From eSpace</h2>
          <button className="round-btn" onClick={onClose} aria-label="Close"><IconClose size={20} /></button>
        </div>
        <div className="modal-body">
          {!st ? (
            <div className="empty">{error || 'Loading…'}</div>
          ) : !st.connected ? (
            <p style={{ margin: 0 }}>eSpace isn’t connected yet. Jeremy runs <b>espace.command</b> once with the eSpace API key, then events start showing up here.</p>
          ) : (
            <>
              <div className={`es-status ${st.lastError ? 'warn' : ''}`}>
                <i className="es-dot" />
                <div>
                  <b>{st.lastError ? 'Last sync had a problem' : 'Connected to eSpace'}</b>
                  <span>
                    {st.lastError
                      ? st.lastError
                      : `${total} approved event${total === 1 ? '' : 's'} coming up · synced ${st.lastSync ? formatDistanceToNow(parseISO(st.lastSync), { addSuffix: true }) : 'never'}`}
                  </span>
                </div>
                <button className="btn" onClick={sync} disabled={syncing}>{syncing ? 'Syncing…' : 'Sync Now'}</button>
              </div>

              <p className="es-help">
                Only <b>fully approved</b> events come in, and Constellation checks every 15 minutes. Names, times and rooms stay managed in eSpace. Here you can set the ministry and add notes.
              </p>

              <div className="es-cats">
                <div className="es-cat head">
                  <span>eSpace category</span>
                  <span>Shows here as</span>
                </div>
                {st.categories.map((c) => {
                  const cc = c.mapTo ? categoryById(c.mapTo) : null
                  return (
                    <div key={c.id} className={`es-cat ${c.mapTo ? '' : 'off'}`}>
                      <span>
                        <b>{c.name}</b>
                        <small>{c.count} upcoming</small>
                      </span>
                      {canEdit ? (
                        <select value={c.mapTo ?? ''} onChange={(e) => setMap(c.id, e.target.value)} style={cc ? tint(cc.soft, cc.ink) : undefined} aria-label={`${c.name} shows as`}>
                          <option value="">Don’t bring in</option>
                          {CATEGORIES.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                        </select>
                      ) : cc ? (
                        <span className="tag" style={tint(cc.soft, cc.ink)}>{cc.label}</span>
                      ) : (
                        <span className="muted-sm">Not brought in</span>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="es-sec">
                <b>Who Books For Which Ministry</b>
                <span>Each event takes the ministry of the staff member who booked it in eSpace. Changing the ministry on a single event in Constellation overrides this.</span>
              </div>
              <div className="es-mins" aria-label="eSpace ministries">
                {st.ministries.map((m) => {
                  const mc = ministryColor(m)
                  const people = st.bookers.filter((b) => b.ministry === m).length
                  return (
                    <span key={m} className="tag es-min" style={tint(mc.soft, mc.ink)} title={`${people} ${people === 1 ? 'person' : 'people'}`}>
                      <i style={{ background: mc.color }} /> {m}
                      {canEdit && !inUse.has(m) && (
                        <button onClick={() => saveMinistries(st.ministries.filter((x) => x !== m))} aria-label={`Remove ${m}`} title="Remove (no one is on it)">
                          <IconClose size={12} />
                        </button>
                      )}
                    </span>
                  )
                })}
                {canEdit &&
                  (newMin !== null ? (
                    <form onSubmit={addMinistry} className="es-newmin">
                      <input autoFocus value={newMin} onChange={(e) => setNewMin(e.target.value)} placeholder="New ministry" aria-label="New ministry" />
                      <button className="btn-primary sm">Add</button>
                      <button type="button" className="btn" onClick={() => setNewMin(null)}>Cancel</button>
                    </form>
                  ) : (
                    <button className="es-addmin" onClick={() => setNewMin('')}>+ Add Ministry</button>
                  ))}
              </div>
              {unset.length > 0 && (
                <div className="banner warn es-unset">
                  {unset.map((b) => `${b.name} (${b.count} event${b.count === 1 ? '' : 's'})`).join(', ')} {unset.length === 1 ? 'has' : 'have'} no ministry yet, so {unset.length === 1 ? 'those events show' : 'their events show'} as All church.
                </div>
              )}
              <div className="es-cats">
                {st.bookers.map((b) => {
                  const mc = b.ministry ? ministryColor(b.ministry) : null
                  return (
                    <div key={b.email} className={`es-cat ${b.ministry ? '' : 'unset'}`}>
                      <span>
                        <b>{b.name}</b>
                        <small>
                          {b.email} · {b.count ? `${b.count} upcoming` : 'nothing booked yet'}
                        </small>
                      </span>
                      {canEdit ? (
                        <span className="es-bk">
                          <select value={b.ministry ?? ''} onChange={(e) => setBooker(b.email, b.name, e.target.value || null)} style={mc ? tint(mc.soft, mc.ink) : undefined} aria-label={`${b.name}’s ministry`}>
                            {!b.ministry && <option value="">Pick a ministry</option>}
                            {st.ministries.map((m) => <option key={m}>{m}</option>)}
                          </select>
                          {b.ministry && (
                            <button className="x" onClick={() => setBooker(b.email, b.name, null)} aria-label={`Remove ${b.name}`} title="Remove from the list">
                              <IconClose size={14} />
                            </button>
                          )}
                        </span>
                      ) : mc ? (
                        <span className="tag" style={tint(mc.soft, mc.ink)}>{b.ministry}</span>
                      ) : (
                        <span className="muted-sm">No ministry yet</span>
                      )}
                    </div>
                  )
                })}
                {canEdit &&
                  (adding ? (
                    <form className="es-cat es-add" onSubmit={addBooker}>
                      <input autoFocus placeholder="Name" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
                      <input placeholder="Church email" type="email" value={adding.email} onChange={(e) => setAdding({ ...adding, email: e.target.value })} />
                      <select value={adding.ministry} onChange={(e) => setAdding({ ...adding, ministry: e.target.value })} aria-label="Ministry">
                        {st.ministries.map((m) => <option key={m}>{m}</option>)}
                      </select>
                      <button className="btn-primary sm">Add</button>
                      <button type="button" className="btn" onClick={() => setAdding(null)}>Cancel</button>
                    </form>
                  ) : (
                    <button className="es-cat es-addbtn" onClick={() => setAdding({ name: '', email: '', ministry: st.ministries[0] ?? 'All church' })}>
                      + Add A Person
                    </button>
                  ))}
              </div>
              {!canEdit && <p className="muted-sm" style={{ margin: 0 }}>Only {admins} can change these settings.</p>}
            </>
          )}
          {error && st && <div className="error">{error}</div>}
        </div>
        <div className="modal-foot">
          <span className="spacer" />
          <button className="btn-primary sm" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
