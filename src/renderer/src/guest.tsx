// The page behind a Video Review link: watch, comment and approve without signing in.
import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Review, ReviewComment, ReviewSnapshot } from './data/review'
import { ReviewView } from './review/ReviewView'
import { streamThumb, type ReviewStore, type Viewer } from './review/reviewStore'
import './styles.css'
import { startTheme } from './data/theme'

startTheme()

const token = location.pathname.split('/')[3] ?? ''
const api = `/track/review/${token}`
const NAME_KEY = 'constellation.reviewer'

type LinkInfo = { label: string; allowComments: boolean; allowDownload: boolean; allVersions: boolean }
type Data = ReviewSnapshot & { link: LinkInfo; team: string[] }

let myName = ''
try {
  myName = localStorage.getItem(NAME_KEY) ?? ''
} catch {
  /* private window */
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(api + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, name: myName }) })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? 'That didn’t save. Try again.')
  return data
}

const listeners = new Set<() => void>()
const changed = () => listeners.forEach((l) => l())
const nope = () => Promise.reject(new Error('Only the creative team can do that.'))

const store: ReviewStore = {
  mode: 'cloud',
  async load() {
    const res = await fetch(`${api}/data`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'This review isn’t available.')
    return data
  },
  subscribe(onChange) {
    listeners.add(onChange)
    const id = setInterval(onChange, 15_000)
    return () => {
      listeners.delete(onChange)
      clearInterval(id)
    }
  },
  async addComment(c) {
    const out = await post<ReviewComment>('/comments', c)
    changed()
    return out
  },
  async react(id, emoji) {
    await post('/react', { id, emoji })
    changed()
  },
  async decide(_reviewId, versionId, decision, note) {
    await post('/decide', { versionId, decision, note })
    changed()
  },
  mediaUrl: async (v) => v.src,
  thumbAt: streamThumb,
  thumbUrl: async (v) => v.thumb,
  downloadUrl: async (v) => `${api}/download/${v.id}`,
  linkUrl: () => location.href,
  createReview: nope,
  addVersion: nope,
  updateReview: nope,
  restoreVersion: nope,
  deleteReview: nope,
  deleteVersion: nope,
  setFps: nope,
  updateComment: nope,
  deleteComment: nope,
  createLink: nope,
  updateLink: nope
}

function Guest() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState('')
  const [name, setName] = useState(myName)

  useEffect(() => {
    let first = true
    const load = () =>
      fetch(`${api}/data${first ? '?view=1' : ''}`)
        .then(async (res) => {
          first = false
          const d = await res.json()
          if (!res.ok) throw new Error(d.error ?? 'This review isn’t available.')
          setData(d)
          setError('')
        })
        .catch((e) => setError((e as Error).message))
    void load()
    return store.subscribe(load)
  }, [])
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(''), 6000)
    return () => clearTimeout(t)
  }, [flash])

  const review: Review | undefined = data?.reviews[0]
  const viewer: Viewer | null = data
    ? { name: name || 'Guest', guest: true, canComment: data.link.allowComments, canDownload: data.link.allowDownload, canDecide: data.link.allowComments && !!name, canManage: false }
    : null

  return (
    <div className="guest-page">
      <header className="guest-top">
        <img src="/brand/logo.png" alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />
        <b>NorthStar Creative</b>
        <span className="muted-sm">Review</span>
      </header>
      {flash && <div className="banner warn">{flash}</div>}
      {error && !data ? (
        <div className="guest-msg">{error}</div>
      ) : !data || !review || !viewer ? (
        <div className="guest-msg">Loading…</div>
      ) : (
        <main className="main review guest">
          <ReviewView
            review={review}
            comments={data.comments}
            decisions={data.decisions}
            links={[]}
            store={store}
            viewer={viewer}
            team={data.team}
            onError={setFlash}
            guestName={name}
            onGuestName={(n) => {
              myName = n
              setName(n)
              try {
                localStorage.setItem(NAME_KEY, n)
              } catch {
                /* private window */
              }
            }}
          />
        </main>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Guest />
  </React.StrictMode>
)
