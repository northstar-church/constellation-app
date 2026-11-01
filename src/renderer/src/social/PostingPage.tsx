import { addDays, addMonths, addWeeks, endOfMonth, endOfWeek, format, isSameMonth, isWeekend, parseISO, startOfMonth, startOfWeek } from 'date-fns'
import { tint } from '../data/tint'
import { useEffect, useMemo, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { IconChevron, IconEye, IconFilter, IconPlus } from '../components/Icons'
import type { TeamMember } from '../data/requests'
import type { StudioBoard } from '../data/studio'
import type { StudioStore } from '../studio/studioStore'
import { campaignColor, PLATFORMS, platformById, POST_CATEGORIES, POST_STATUSES, postCategory, postStatus, type PlatformId, type PostCategoryId, type PostStatus, type SocialAccount, type SocialPost } from '../data/social'
import { PlatformIcon } from './PlatformIcon'
import { PostComposer } from './PostComposer'
import { MediaContext, MediaView } from './PostPreview'
import type { SocialStore } from './socialStore'

type View = 'month' | 'week' | 'list'

interface Props {
  store: SocialStore
  team: TeamMember[]
  /** The signed-in person's name */
  me: string
  query: string
  /** Open this post (from a notification) */
  focus?: { id: string; n: number } | null
  /** Start a new post with these values (from a Studio board) */
  seed?: { post: Partial<SocialPost>; n: number } | null
  /** For showing which board a post was planned on */
  studio?: StudioStore | null
  onPlanInStudio?: (post: SocialPost) => Promise<void> | void
  /** Preview only: who the page is shown as (shared with Studio) */
  viewingAs?: string
  onViewingAs?: (name: string) => void
}

const ymd = (d: Date) => format(d, 'yyyy-MM-dd')
const timeLabel = (t: string) => (t ? format(parseISO(`2000-01-01T${t}`), 'h:mma').replace(':00', '').toLowerCase() : '')
const byTime = (a: SocialPost, b: SocialPost) => (a.time || '99').localeCompare(b.time || '99') || a.platform.localeCompare(b.platform)
const MAX = 4

export function PostingPage({ store, team, me: signedIn, query, focus, seed, studio, onPlanInStudio, viewingAs = signedIn, onViewingAs }: Props) {
  const [posts, setPosts] = useState<SocialPost[] | null>(null)
  const [view, setView] = useState<View>('month')
  const [cursor, setCursor] = useState(() => new Date())
  const [hidden, setHidden] = useState<PlatformId[]>([])
  const [hiddenCats, setHiddenCats] = useState<(PostCategoryId | '')[]>([])
  const [status, setStatus] = useState<PostStatus | 'all'>('all')
  const [campaign, setCampaign] = useState('all')
  const [reviewOnly, setReviewOnly] = useState(false)
  const [open, setOpen] = useState<{ post: SocialPost | null; date?: string; seed?: Partial<SocialPost> } | null>(null)
  const [accounts, setAccounts] = useState<SocialAccount[]>([])
  const [boards, setBoards] = useState<StudioBoard[] | null>(null)
  const [error, setError] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [overDay, setOverDay] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const me = store.mode === 'demo' ? viewingAs : signedIn
  const lead = team.find((m) => m.socialLead)

  useEffect(() => {
    const load = () =>
      store
        .load()
        .then(setPosts)
        .catch((e) => setError((e as Error).message))
    void load()
    return store.subscribe(load)
  }, [store])
  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(''), 6000)
    return () => clearTimeout(t)
  }, [error])

  useEffect(() => {
    store.accounts().then(setAccounts).catch(() => setAccounts([]))
  }, [store])
  useEffect(() => {
    if (!studio) return
    const load = () => studio.load().then((s) => setBoards(s.boards)).catch(() => {})
    void load()
    return studio.subscribe(load)
  }, [studio])
  // A post started from a Studio board
  useEffect(() => {
    if (!seed) return
    setOpen({ post: null, seed: seed.post, date: seed.post.date })
  }, [seed?.n])

  // A notification opens its post, and shows the week it's in.
  useEffect(() => {
    if (!focus || !posts) return
    const p = posts.find((x) => x.id === focus.id)
    if (!p) return setError('That post no longer exists.')
    if (p.date) setCursor(parseISO(p.date))
    setOpen({ post: p })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n, !!posts])

  /** undefined: no board (or Studio isn't loaded); null: a board this person can't see */
  const boardTitleOf = (id: string) => (!id || !boards ? undefined : (boards.find((b) => b.id === id)?.title ?? null))

  const campaigns = useMemo(() => [...new Set((posts ?? []).map((p) => p.campaign).filter(Boolean))].sort(), [posts])
  const needsReview = (posts ?? []).filter((p) => p.status === 'review').length
  const iAmLead = lead?.name === me
  /** Only the social media director adds, moves and posts; everyone else can look. */
  const canEdit = !lead || iAmLead

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (posts ?? []).filter((p) => {
      if (hidden.includes(p.platform)) return false
      if (hiddenCats.includes(p.category)) return false
      if (status !== 'all' && p.status !== status) return false
      if (reviewOnly && p.status !== 'review') return false
      if (campaign !== 'all' && p.campaign !== campaign) return false
      if (q && ![p.caption, p.title, p.campaign, p.poster, platformById(p.platform).label, postCategory(p.category).label].some((f) => f.toLowerCase().includes(q))) return false
      return true
    })
  }, [posts, hidden, hiddenCats, status, reviewOnly, campaign, query])

  const onDay = (key: string) => visible.filter((p) => p.date === key).sort(byTime)

  async function move(id: string, date: string) {
    const p = posts?.find((x) => x.id === id)
    if (!p || p.date === date || p.status === 'posted') return
    // Rescheduling someone else's approved post sends it back to review, like any other change.
    const back = p.status === 'scheduled' && !!lead && lead.name !== me
    try {
      await store.update(id, { date, ...(back ? { status: 'review' as const } : {}) }, `moved to ${format(parseISO(date), 'MMM d')}${back ? ' (back to review)' : ''}`)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const dropProps = (key: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragId || !canEdit) return
      e.preventDefault()
      setOverDay(key)
    },
    onDragLeave: () => setOverDay((d) => (d === key ? null : d)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      setOverDay(null)
      if (dragId) void move(dragId, key)
      setDragId(null)
    }
  })

  /** Category color: tinted background with a solid stripe; uncategorized posts keep the neutral look. */
  const catStyle = (p: SocialPost): React.CSSProperties | undefined => {
    const c = postCategory(p.category)
    return p.category ? ({ '--cat': c.color, '--cat-soft': c.soft, '--cat-ink': c.ink } as React.CSSProperties) : undefined
  }

  const chip = (p: SocialPost, big = false) => {
    const st = postStatus(p.status)
    const m = p.media[0]
    return (
      <button
        key={p.id}
        className={`post-chip st-${p.status} ${big ? 'big' : ''} ${p.category ? 'has-cat' : ''} ${p.publishState === 'failed' ? 'pub-failed' : ''}`}
        style={catStyle(p)}
        draggable={canEdit && p.status !== 'posted'}
        onDragStart={(e) => {
          setDragId(p.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDragEnd={() => {
          setDragId(null)
          setOverDay(null)
        }}
        onClick={() => setOpen({ post: p })}
        title={`${platformById(p.platform).label} · ${st.label}${p.time ? ` · ${timeLabel(p.time)}` : ''}${p.publishState === 'failed' ? ' · Didn’t publish' : ''}\n${p.title || p.caption}`}
      >
        <span className="pc-top">
          <PlatformIcon id={p.platform} size={big ? 22 : 18} />
          {p.time && <span className="pc-time">{timeLabel(p.time)}</span>}
          <span className="pc-dot" style={{ background: st.dot }} aria-label={st.label} />
          {p.status === 'posted' && <span className="pc-posted">✓</span>}
          {p.publishState === 'failed' && <span className="pc-failed" title="Didn’t publish">!</span>}
        </span>
        {big && m && (
          <span className="pc-media" style={{ aspectRatio: platformById(p.platform).aspect === '9/16' ? '4 / 5' : '16 / 10' }}>
            <MediaView m={m} cover />
          </span>
        )}
        <span className="pc-text">{p.title || p.caption || 'Untitled post'}</span>
        {!big && m && (
          <span className="pc-thumb">
            <MediaView m={m} cover />
          </span>
        )}
        {big && (
          <span className="pc-foot">
            {p.campaign && (
              <span className="rq-tag" style={tint(campaignColor(p.campaign).soft, campaignColor(p.campaign).ink)}>
                {p.campaign}
              </span>
            )}
            <span className="pc-status" style={tint(st.soft, st.ink)}>
              {st.label}
            </span>
            <Avatar name={p.poster} size={24} />
          </span>
        )}
      </button>
    )
  }

  const monthView = () => {
    const start = startOfWeek(startOfMonth(cursor))
    const end = endOfWeek(endOfMonth(cursor))
    const days: Date[] = []
    for (let d = start; d <= end; d = addDays(d, 1)) days.push(d)
    const today = ymd(new Date())
    return (
      <div className="month-wrap">
        <div className="month social-month">
          <div className="month-head">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d} className="dow">
                {d}
              </div>
            ))}
          </div>
          <div className="month-grid">
            {days.map((d) => {
              const key = ymd(d)
              const list = onDay(key)
              const isOpen = expanded === key
              const limit = isOpen ? Infinity : list.length > MAX ? MAX - 1 : MAX
              return (
                <div
                  key={key}
                  className={`cell ${isSameMonth(d, cursor) ? '' : 'other'} ${key === today ? 'today' : ''} ${isWeekend(d) ? 'weekend' : ''} ${overDay === key ? 'drop' : ''}`}
                  {...dropProps(key)}
                  onDoubleClick={(e) => canEdit && e.target === e.currentTarget && setOpen({ post: null, date: key })}
                >
                  <div className="cell-top">
                    <span className="daynum">{format(d, 'd')}</span>
                    {canEdit && (
                      <button className="add-here" aria-label={`New post on ${format(d, 'MMMM d')}`} onClick={() => setOpen({ post: null, date: key })}>
                        <IconPlus size={15} />
                      </button>
                    )}
                  </div>
                  {list.slice(0, limit).map((p) => chip(p))}
                  {list.length > limit && (
                    <button className="more" onClick={() => setExpanded(key)}>
                      +{list.length - limit} more
                    </button>
                  )}
                  {isOpen && list.length > MAX && (
                    <button className="more" onClick={() => setExpanded(null)}>
                      show less
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  const weekView = () => {
    const start = startOfWeek(cursor)
    const today = ymd(new Date())
    return (
      <div className="week-wrap">
        <div className="week-grid">
          {Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((d) => {
            const key = ymd(d)
            const list = onDay(key)
            return (
              <section key={key} className={`week-col ${key === today ? 'today' : ''} ${overDay === key ? 'drop' : ''}`} {...dropProps(key)}>
                <header>
                  <span className="dow">{format(d, 'EEE')}</span>
                  <b>{format(d, 'd')}</b>
                  {canEdit && (
                    <button className="add-here" aria-label={`New post on ${format(d, 'MMMM d')}`} onClick={() => setOpen({ post: null, date: key })}>
                      <IconPlus size={15} />
                    </button>
                  )}
                </header>
                {list.map((p) => chip(p, true))}
                {!list.length && <span className="week-empty">No posts</span>}
              </section>
            )
          })}
        </div>
      </div>
    )
  }

  const listView = () => {
    const from = ymd(new Date())
    const upcoming = visible.filter((p) => p.date >= from || p.status !== 'posted').sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b))
    const groups = new Map<string, SocialPost[]>()
    for (const p of upcoming) groups.set(p.date, [...(groups.get(p.date) ?? []), p])
    if (!upcoming.length) return <div className="empty">No upcoming posts match these filters.</div>
    return (
      <div className="post-list">
        {[...groups].map(([day, list]) => (
          <section key={day} className="post-day">
            <h3>
              {format(parseISO(day), 'EEEE, MMMM d')}
              {day < from && <span className="overdue"> · past, not posted</span>}
            </h3>
            {list.map((p) => {
              const st = postStatus(p.status)
              return (
                <button key={p.id} className={`post-row ${p.category ? 'has-cat' : ''}`} style={catStyle(p)} onClick={() => setOpen({ post: p })}>
                  <PlatformIcon id={p.platform} size={30} title />
                  <span className="pr-time">{timeLabel(p.time) || 'No time'}</span>
                  <span className="pr-text">
                    <b>{p.title || p.caption.split('\n')[0] || 'Untitled post'}</b>
                    {p.campaign && <span className="muted-sm">{p.campaign}</span>}
                  </span>
                  {p.media[0] && (
                    <span className="pr-thumb">
                      <MediaView m={p.media[0]} cover />
                    </span>
                  )}
                  {p.publishState === 'failed' ? (
                    <span className="pc-status failed">Didn’t Publish</span>
                  ) : (
                    <span className="pc-status" style={tint(st.soft, st.ink)}>
                      {st.label}
                    </span>
                  )}
                  <Avatar name={p.poster} size={30} />
                </button>
              )
            })}
          </section>
        ))}
      </div>
    )
  }

  const step = (n: number) => setCursor((c) => (view === 'week' ? addWeeks(c, n) : addMonths(c, n)))
  const rangeLabel = view === 'week' ? `${format(startOfWeek(cursor), 'MMM d')} – ${format(endOfWeek(cursor), 'MMM d, yyyy')}` : format(cursor, 'MMMM yyyy')

  return (
    <MediaContext.Provider value={store.mediaUrl}>
      <main className="main posting">
        <div className="page-head">
          <h1>Posting Calendar</h1>
          {canEdit ? (
            <button className="btn-primary" onClick={() => setOpen({ post: null })}>
              New Post <IconPlus size={18} />
            </button>
          ) : (
            <span className="view-only-note">
              <IconEye size={18} /> View only · {lead!.name.split(' ')[0]} manages the Posting Calendar
            </span>
          )}
          {iAmLead && needsReview > 0 && (
            <button className={`pill review-pill ${reviewOnly ? 'on' : ''}`} onClick={() => setReviewOnly((v) => !v)} aria-pressed={reviewOnly}>
              <span className="dot" style={{ background: postStatus('review').dot }} />
              {iAmLead ? `${needsReview} Need${needsReview === 1 ? 's' : ''} Your Review` : `${needsReview} Pending Review`}
            </button>
          )}
          <div className="pill-group" role="tablist" aria-label="View" style={{ marginLeft: 'auto' }}>
            {(['month', 'week', 'list'] as View[]).map((v) => (
              <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)} role="tab" aria-selected={view === v}>
                {v === 'month' ? 'Month' : v === 'week' ? 'Week' : 'Upcoming'}
              </button>
            ))}
          </div>
        </div>

        <div className="pills">
          {view !== 'list' && (
            <div className="month-nav">
              <button onClick={() => step(-1)} aria-label={view === 'week' ? 'Previous week' : 'Previous month'}>
                <IconChevron dir="left" size={18} />
              </button>
              <button className="label" onClick={() => setCursor(new Date())} title="Back to today">
                {rangeLabel}
              </button>
              <button onClick={() => step(1)} aria-label={view === 'week' ? 'Next week' : 'Next month'}>
                <IconChevron dir="right" size={18} />
              </button>
            </div>
          )}
          <div className="pf-filter" role="group" aria-label="Platforms">
            {PLATFORMS.map((p) => {
              const off = hidden.includes(p.id)
              return (
                <button
                  key={p.id}
                  className={`pf-filter-btn ${off ? 'off' : ''}`}
                  onClick={() => setHidden((h) => (off ? h.filter((x) => x !== p.id) : [...h, p.id]))}
                  aria-pressed={!off}
                  title={off ? `Show ${p.label}` : `Hide ${p.label}`}
                >
                  <PlatformIcon id={p.id} size={24} />
                </button>
              )
            })}
          </div>
          <label className={`pill ${status !== 'all' ? 'on' : ''}`}>
            <IconFilter size={20} />
            <select value={status} onChange={(e) => setStatus(e.target.value as PostStatus | 'all')} aria-label="Status">
              <option value="all">All Statuses</option>
              {POST_STATUSES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          {campaigns.length > 0 && (
            <label className={`pill ${campaign !== 'all' ? 'on' : ''}`}>
              <select value={campaign} onChange={(e) => setCampaign(e.target.value)} aria-label="Campaign">
                <option value="all">All Campaigns</option>
                {campaigns.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="pills cat-pills" role="group" aria-label="Categories">
          {POST_CATEGORIES.map((c) => {
            const off = hiddenCats.includes(c.id)
            return (
              <button
                key={c.id}
                className={`tag pill-h ${off ? 'off' : ''}`}
                style={tint(c.soft, c.ink)}
                onClick={() => setHiddenCats((h) => (off ? h.filter((x) => x !== c.id) : [...h, c.id]))}
                aria-pressed={!off}
                title={off ? `Show ${c.label}` : `Hide ${c.label}`}
              >
                <span className="dot" style={{ background: c.color }} /> {c.label}
              </button>
            )
          })}
        </div>

        {store.mode === 'demo' && (
          <div className="banner demo-as">
            <span>Preview with sample posts, saved only in this browser.</span>
            <label>
              Viewing as{' '}
              <select value={viewingAs} onChange={(e) => onViewingAs?.(e.target.value)} aria-label="Viewing as">
                {team.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {error && <div className="banner warn">{error}</div>}
        {query && <div className="banner">Showing posts matching “{query}” · {visible.length}</div>}

        <div className="content" key={view}>
          {!posts ? <div className="empty">Loading…</div> : view === 'month' ? monthView() : view === 'week' ? weekView() : listView()}
        </div>
      </main>

      {open && (
        <PostComposer
          key={open.post?.id ?? `new-${open.date}-${seed?.n ?? 0}`}
          post={open.post}
          seed={open.seed}
          accounts={accounts}
          boardTitle={boardTitleOf(open.post?.boardId ?? open.seed?.boardId ?? '')}
          onPlanInStudio={
            studio && onPlanInStudio
              ? (p) => {
                  setOpen(null)
                  Promise.resolve(onPlanInStudio(p)).catch((e) => setError((e as Error).message))
                }
              : undefined
          }
          initialDate={open.date}
          campaigns={campaigns}
          team={team}
          me={me}
          lead={lead}
          store={store}
          readOnly={!canEdit}
          onClose={() => setOpen(null)}
          onError={setError}
        />
      )}
    </MediaContext.Provider>
  )
}
