import { formatDistanceToNow, parseISO } from 'date-fns'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Notification } from '../data/requests'
import type { NotificationStore } from '../requests/requestStore'
import { Avatar } from './Avatar'

const Bell = () => (
  <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15l1.5-2Z" />
    <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
  </svg>
)

/** Header bell: comments and assignments for the signed-in team member. */
const VERB: Record<string, string> = {
  comment: 'commented on',
  reply: 'replied about',
  partdone: 'finished their part of',
  assigned: 'assigned you to',
  'post-review': 'submitted a post for your review:',
  'post-approved': 'approved your post:',
  'post-sentback': 'sent back your post:',
  'review-comment': 'commented on',
  'review-decision': 'reviewed',
  'review-version': 'uploaded a new version of'
}

export function NotificationBell({ store, onOpen }: { store: NotificationStore; onOpen: (n: Notification) => void }) {
  const [items, setItems] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  // Mac banners for notifications that arrive while you're in another app (the bell already shows them otherwise)
  const seen = useRef<Set<string> | null>(null)
  const openRef = useRef(onOpen)
  openRef.current = onOpen
  const banner = (n: Notification) => {
    if (!window.hub?.isDesktop || typeof window.Notification === 'undefined') return
    const verb = VERB[n.kind]
    const b = new window.Notification(n.requestTitle || 'Constellation', {
      body: verb ? `${n.actor} ${verb.replace(/:$/, '')}${n.message ? `: ${n.message}` : ''}` : n.message || n.actor,
      silent: false
    })
    b.onclick = () => {
      window.hub?.focus?.()
      openRef.current(n)
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
      store.markRead([n.id]).catch(() => {})
    }
  }

  const reload = useCallback(() => {
    store
      .list()
      .then((list) => {
        setItems(list)
        if (seen.current) {
          const fresh = list.filter((n) => !n.read && !seen.current!.has(n.id))
          if (fresh.length && !document.hasFocus()) fresh.slice(0, 3).forEach(banner)
        }
        seen.current = new Set(list.map((n) => n.id))
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  useEffect(() => {
    reload()
    return store.subscribe(reload)
  }, [store, reload])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  const unread = items.filter((n) => !n.read)
  // Same number on the Mac's Dock icon; cleared when the bell goes away (signing out)
  useEffect(() => {
    window.hub?.setBadge?.(unread.length)
  }, [unread.length])
  useEffect(() => () => window.hub?.setBadge?.(0), [])

  const openOne = (n: Notification) => {
    setOpen(false)
    onOpen(n)
    if (!n.read) {
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
      store.markRead([n.id]).catch(() => {})
    }
  }

  return (
    <div className="bell-wrap" ref={wrap}>
      <button className="bell" onClick={() => setOpen((o) => !o)} aria-label={`Notifications${unread.length ? `, ${unread.length} unread` : ''}`} aria-expanded={open}>
        <Bell />
        {unread.length > 0 && <span className="bell-badge">{unread.length > 9 ? '9+' : unread.length}</span>}
      </button>
      {open && (
        <div className="bell-menu" role="dialog" aria-label="Notifications">
          <div className="bell-head">
            <b>Notifications</b>
            {unread.length > 0 && (
              <button
                className="link"
                onClick={() => {
                  setItems((list) => list.map((x) => ({ ...x, read: true })))
                  store.markRead(null).catch(() => {})
                }}
              >
                Mark All Read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="bell-empty">You’re all caught up. Team comments and new assignments show up here.</p>
          ) : (
            <ul>
              {items.map((n) => (
                <li key={n.id}>
                  <button className={n.read ? '' : 'unread'} onClick={() => openOne(n)}>
                    <Avatar name={n.actor} size={34} />
                    <span className="bell-text">
                      <span>
                        {n.kind === 'post-due' ? (
                          <>
                            Time to post: <b>{n.requestTitle}</b>
                          </>
                        ) : n.kind === 'review-expiring' ? (
                          <>
                            Leaving streaming soon: <b>{n.requestTitle}</b>
                          </>
                        ) : (
                          <>
                            <b>{n.actor.split(' ')[0]}</b> {VERB[n.kind] ?? 'updated'} <b>{n.requestTitle}</b>
                          </>
                        )}
                      </span>
                      {n.kind !== 'assigned' && n.kind !== 'post-approved' && <span className="bell-snippet">{n.message}</span>}
                      <span className="muted-sm">{formatDistanceToNow(parseISO(n.at), { addSuffix: true })}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
