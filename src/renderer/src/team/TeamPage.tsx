// Team: who's on Constellation and what they do. Team admins can add and remove people and change roles.
import { formatDistanceToNow, parseISO } from 'date-fns'
import { useCallback, useEffect, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { IconClose, IconPlus } from '../components/Icons'
import type { TeamMember } from '../data/requests'
import type { RolePatch, TeamEntry, TeamStore } from './teamStore'
import './team.css'

type RoleKey = 'assignable' | 'pm' | 'socialLead' | 'admin'
const ROLES: { key: RoleKey; label: string; hint: string }[] = [
  { key: 'assignable', label: 'Assigned list', hint: 'Can be assigned Media Requests' },
  { key: 'pm', label: 'Every comment', hint: 'Hears about every comment on every request' },
  { key: 'socialLead', label: 'Social lead', hint: 'Approves posts on the Posting Calendar (one person)' },
  { key: 'admin', label: 'Team admin', hint: 'Can add and remove people and change roles' }
]
const on = (m: TeamMember, k: RoleKey) => (k === 'assignable' ? m.assignable !== false : !!m[k])
const INSTALL = 'https://constellation.northstarchurch.org/updates/Constellation.dmg'

function lastSeen(m: TeamEntry) {
  if (!m.lastActive) return 'Hasn’t signed in yet'
  const d = parseISO(m.lastActive)
  return Date.now() - d.getTime() < 3600_000 * 6 ? 'Active today' : `Active ${formatDistanceToNow(d, { addSuffix: true })}`
}

export function TeamPage({ store, me, query }: { store: TeamStore; me: string; query: string }) {
  const [team, setTeam] = useState<TeamEntry[] | null>(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [confirm, setConfirm] = useState<{ email: string; what: 'remove' | 'signout' | 'social' } | null>(null)

  const load = useCallback(() => {
    store
      .list()
      .then((t) => {
        setTeam(t)
        setError('')
      })
      .catch((e: Error) => setError(e.message))
  }, [store])
  useEffect(() => {
    load()
    return store.subscribe(load)
  }, [store, load])

  const myEntry = team?.find((m) => m.name === me)
  const canEdit = !!myEntry?.admin || store.mode === 'demo'
  const admins = team?.filter((m) => m.admin).map((m) => m.name.split(' ')[0]) ?? []
  const q = query.trim().toLowerCase()
  const shown = (team ?? []).filter((m) => !q || `${m.name} ${m.email}`.toLowerCase().includes(q))

  const act = async (fn: () => Promise<void>) => {
    setError('')
    try {
      await fn()
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const toggle = (m: TeamEntry, k: RoleKey) => {
    const next = !on(m, k)
    if (k === 'socialLead' && next && team?.some((t) => t.socialLead && t.email !== m.email)) return setConfirm({ email: m.email, what: 'social' })
    act(() => store.update(m.email, { [k]: next } as RolePatch))
  }
  const target = confirm ? team?.find((m) => m.email === confirm.email) : null
  const currentLead = team?.find((m) => m.socialLead)

  return (
    <main className="main tm-main">
      <div className="page-head">
        <h1>Team</h1>
        <span className="tm-sub">{team ? `${team.length} people` : ''}</span>
        <span style={{ flex: 1 }} />
        {canEdit && (
          <button className="btn-primary" onClick={() => setAdding(true)}>
            Add Person <IconPlus size={18} />
          </button>
        )}
      </div>
      {!canEdit && team && <div className="banner">Only {admins.join(' and ')} can add people or change roles.</div>}
      {error && <div className="banner warn">{error}</div>}

      <div className="tm-scroll">
        <div className="tm-body">
          <div className="tm-legend">
            {ROLES.map((r) => (
              <span key={r.key}>
                <b>{r.label}</b> {r.hint.charAt(0).toLowerCase() + r.hint.slice(1)}
              </span>
            ))}
          </div>
          {!team ? (
            <div className="empty">Loading…</div>
          ) : (
            <div className="tm-list">
              {shown.map((m) => (
                <div key={m.email} className="tm-row">
                  <Avatar name={m.name} size={44} />
                  <div className="tm-who">
                    <b>
                      {m.name}
                      {m.name === me && <span className="tm-you">You</span>}
                    </b>
                    <span>{m.email}</span>
                  </div>
                  <div className="tm-roles">
                    {ROLES.map((r) =>
                      canEdit ? (
                        <button key={r.key} className={`tm-role ${on(m, r.key) ? 'on' : ''}`} onClick={() => toggle(m, r.key)} aria-pressed={on(m, r.key)} title={r.hint}>
                          <i aria-hidden>{on(m, r.key) ? '✓' : '+'}</i> {r.label}
                        </button>
                      ) : on(m, r.key) ? (
                        <span key={r.key} className="tm-role on static" title={r.hint}>
                          {r.label}
                        </span>
                      ) : null
                    )}
                  </div>
                  <div className={`tm-seen ${m.lastActive ? '' : 'never'}`}>
                    {lastSeen(m)}
                    {m.devices > 1 && <small>{m.devices} devices</small>}
                  </div>
                  {canEdit && (
                    <div className="tm-actions">
                      {m.devices > 0 && (
                        <button className="tm-mini" onClick={() => setConfirm({ email: m.email, what: 'signout' })} title="Sign them out on every device">
                          Sign Out
                        </button>
                      )}
                      {m.name !== me && (
                        <button className="tm-mini danger" onClick={() => setConfirm({ email: m.email, what: 'remove' })}>
                          Remove
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {!shown.length && <div className="empty">No one matches “{query}”.</div>}
            </div>
          )}
          <p className="tm-foot">
            Everyone signs in with their church email; the code arrives as a Slack DM from Constellation, so they need to be in Slack under that same email. New people install the app from{' '}
            <a href={INSTALL}>{INSTALL.replace('https://', '')}</a>.
          </p>
        </div>
      </div>

      {adding && <AddPerson onClose={() => setAdding(false)} onAdd={async (m) => { await store.add(m); load() }} hasLead={!!currentLead} />}

      {confirm && target && (
        <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && setConfirm(null)}>
          <div className="modal tm-confirm" role="dialog">
            <div className="modal-head">
              <h2>{confirm.what === 'remove' ? `Remove ${target.name}?` : confirm.what === 'signout' ? `Sign ${target.name.split(' ')[0]} Out?` : `Make ${target.name.split(' ')[0]} The Social Lead?`}</h2>
              <button className="round-btn" onClick={() => setConfirm(null)} aria-label="Close"><IconClose size={20} /></button>
            </div>
            <div className="modal-body">
              <p style={{ margin: 0 }}>
                {confirm.what === 'remove'
                  ? `They’re signed out of Constellation right away and can’t sign back in. Requests and posts they worked on keep their name.`
                  : confirm.what === 'signout'
                    ? `Signs them out on every device (${target.devices}). They can sign back in with a new code. Useful if a laptop is lost or replaced.`
                    : `Only one person can be the social lead. ${currentLead?.name ?? 'The current lead'} will no longer approve posts on the Posting Calendar.`}
              </p>
            </div>
            <div className="modal-foot">
              <span className="spacer" />
              <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
              <button
                className={`btn-primary sm ${confirm.what === 'remove' ? 'danger' : ''}`}
                onClick={() => {
                  const c = confirm
                  setConfirm(null)
                  act(() => (c.what === 'remove' ? store.remove(c.email) : c.what === 'signout' ? store.signOutEverywhere(c.email) : store.update(c.email, { socialLead: true })))
                }}
              >
                {confirm.what === 'remove' ? 'Remove' : confirm.what === 'signout' ? 'Sign Out Everywhere' : 'Make Social Lead'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function AddPerson({ onClose, onAdd, hasLead }: { onClose: () => void; onAdd: (m: TeamMember) => Promise<void>; hasLead: boolean }) {
  const [m, setM] = useState<TeamMember>({ name: '', email: '', assignable: false, pm: false, socialLead: false, admin: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const message = `You’re on Constellation! Install it from ${INSTALL} (open the download and drag Constellation into Applications). Then open it and sign in with ${m.email || 'your church email'}; the code comes to you here in Slack.`

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const email = m.email.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return setError('That email doesn’t look right.')
    setBusy(true)
    try {
      await onAdd({ ...m, name: m.name.trim(), email })
      setDone(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal tm-add" onSubmit={save} role="dialog" aria-label="Add a person">
        <div className="modal-head">
          <h2>{done ? `${m.name.split(' ')[0]} Is On The Team` : 'Add A Person'}</h2>
          <button type="button" className="round-btn" onClick={onClose} aria-label="Close"><IconClose size={20} /></button>
        </div>
        <div className="modal-body">
          {done ? (
            <>
              <p style={{ margin: 0 }}>They can sign in now. Send them this so they can install the app:</p>
              <div className="tm-msg">{message}</div>
              <div>
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    navigator.clipboard.writeText(message).then(() => {
                      setCopied(true)
                      setTimeout(() => setCopied(false), 1800)
                    })
                  }
                >
                  {copied ? 'Copied ✓' : 'Copy Message'}
                </button>
              </div>
            </>
          ) : (
            <>
              <label className="field">
                <span>Name</span>
                <input autoFocus required value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} placeholder="e.g. Ryan Hoffer" />
              </label>
              <label className="field">
                <span>Church email (the one they use in Slack)</span>
                <input required type="email" value={m.email} onChange={(e) => setM({ ...m, email: e.target.value })} placeholder="first.last@northstarchurch.org" />
              </label>
              <div className="tm-pick">
                {ROLES.map((r) => (
                  <label key={r.key} className="check">
                    <input type="checkbox" className="cbox" checked={!!m[r.key]} onChange={(e) => setM({ ...m, [r.key]: e.target.checked })} />
                    <span>
                      <b>{r.label}</b>
                      <small>{r.key === 'socialLead' && hasLead ? 'Replaces the current social lead' : r.hint}</small>
                    </span>
                  </label>
                ))}
              </div>
              {error && <div className="error">{error}</div>}
            </>
          )}
        </div>
        <div className="modal-foot">
          <span className="spacer" />
          {done ? (
            <button type="button" className="btn-primary sm" onClick={onClose}>Done</button>
          ) : (
            <>
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button className="btn-primary sm" disabled={busy}>{busy ? 'Adding…' : 'Add To Team'}</button>
            </>
          )}
        </div>
      </form>
    </div>
  )
}
