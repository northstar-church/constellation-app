import { useEffect, useRef, useState } from 'react'
import { CalendarPage } from './calendar/CalendarPage'
import { Avatar } from './components/Avatar'
import { ThemeSwitch } from './components/ThemeSwitch'
import { BlackBookPage } from './blackbook/BlackBookPage'
import { createCloudBookStore, createLocalBookStore, type BookStore } from './blackbook/bookStore'
import { BrandPage } from './brand/BrandPage'
import { ReportsPage } from './reports/ReportsPage'
import { TeamPage } from './team/TeamPage'
import { createCloudTeamStore, createDemoTeamStore, type TeamStore } from './team/teamStore'
import { createCloudReportStore, createDemoReportStore, type ReportStore } from './reports/reportStore'
import { createCloudBrandStore, createLocalBrandStore, type BrandStore } from './brand/brandStore'
import { ComingSoon } from './components/ComingSoon'
import { IconBoard, IconBrand, IconCalendar, IconChart, IconPeople, IconClose, IconContacts, IconFilm, IconInbox, IconMegaphone, IconSearch, LogoMark } from './components/Icons'
import { connect, createCloudStore, type Connection, type Me } from './data/cloudStore'
import { createLocalStore } from './data/localStore'
import type { CalendarStore } from './data/store'
import { Gate } from './components/Gate'
import { NotificationBell } from './components/NotificationBell'
import { RequestsPage } from './requests/RequestsPage'
import { createCloudRequestStore, createLocalRequestStore, type RequestStore } from './requests/requestStore'
import { DEFAULT_TEAM, type TeamMember } from './data/requests'
import { PostingPage } from './social/PostingPage'
import { createCloudReviewStore, createLocalReviewStore, type ReviewStore } from './review/reviewStore'
import { ReviewPage } from './review/ReviewPage'
import { boardForPost } from './studio/postLinks'
import { StudioPage } from './studio/StudioPage'
import { createCloudStudioStore, createLocalStudioStore, type StudioStore } from './studio/studioStore'
import { createCloudSocialStore, createLocalSocialStore, type SocialStore } from './social/socialStore'
import type { SocialPost } from './data/social'

type Section = 'requests' | 'calendar' | 'posts' | 'studio' | 'review' | 'reports' | 'brand' | 'rolodex' | 'team'

/** Team lives at the bottom of the sidebar, apart from the work sections */
const TEAM_NAV = { id: 'team' as const, label: 'Team', icon: <IconPeople />, blurb: '' }

const NAV: { id: Section; label: string; icon: React.ReactNode; blurb: string }[] = [
  { id: 'requests', label: 'Media Requests', icon: <IconInbox />, blurb: '' },
  { id: 'calendar', label: 'Event Calendar', icon: <IconCalendar />, blurb: '' },
  {
    id: 'posts',
    label: 'Posting Calendar',
    icon: <IconMegaphone />,
    blurb: ''
  },
  {
    id: 'studio',
    label: 'Creative Studio',
    icon: <IconBoard />,
    blurb: 'Creative briefs and storyboards your team edits together in real time, with live cursors and comments.'
  },
  {
    id: 'review',
    label: 'Video Review',
    icon: <IconFilm />,
    blurb: 'Upload cuts and review them together: frame-accurate comments, drawing on frames, version stacks with side-by-side compare, and approvals.'
  },
  {
    id: 'rolodex',
    label: 'Little Black Book',
    icon: <IconContacts />,
    blurb: 'Every vendor the team works with: contacts, account numbers, logins, pricing and files.'
  },
  {
    id: 'brand',
    label: 'Brand Library',
    icon: <IconBrand />,
    blurb: 'NorthStar’s brand guidelines, with every logo, color, font and template ready to grab.'
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: <IconChart />,
    blurb: 'How the team is doing: requests, turnaround, posts, video reviews and events, with a summary for leadership.'
  }
]

const isDesktop = Boolean(window.hub?.isDesktop)
const isMac = /Mac/.test(navigator.platform)

export default function App() {
  const [section, setSection] = useState<Section>('requests')
  const [conn, setConn] = useState<Connection | null>(null)
  const [ctx, setCtx] = useState<{ store: CalendarStore; requests: RequestStore; social: SocialStore | null; studio: StudioStore | null; review: ReviewStore | null; book: BookStore | null; brand: BrandStore | null; reports: ReportStore | null; team: TeamStore | null; me: Me | null } | null>(null)
  const [postFocus, setPostFocus] = useState<{ id: string; n: number } | null>(null)
  const [postSeed, setPostSeed] = useState<{ post: Partial<SocialPost>; n: number } | null>(null)
  const [studioFocus, setStudioFocus] = useState<{ boardId: string; n: number } | null>(null)
  /** Jumps between Posting Calendar and Studio carry one thing to open; the others are cleared so they don't reopen later. */
  const jump = (to: { postFocus?: string; postSeed?: Partial<SocialPost>; studioFocus?: string }) => {
    const n = Date.now()
    setPostFocus(to.postFocus ? { id: to.postFocus, n } : null)
    setPostSeed(to.postSeed ? { post: to.postSeed, n } : null)
    setStudioFocus(to.studioFocus ? { boardId: to.studioFocus, n } : null)
  }
  const [team, setTeam] = useState<TeamMember[]>(DEFAULT_TEAM)
  // Preview only: look at Posting Calendar and Studio as another teammate
  const [demoAs, setDemoAs] = useState('Jeremy Thompson')
  const demoAsRef = useRef(demoAs)
  const guestAsRef = useRef<string | null>(null)
  const [reviewFocus, setReviewFocus] = useState<{ reviewId: string; n: number } | null>(null)
  const [reviewStart, setReviewStart] = useState<{ requestId: string; n: number } | null>(null)
  demoAsRef.current = demoAs
  const [query, setQuery] = useState('')
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null)
  const [eventFocus, setEventFocus] = useState<{ id: string; date: string | null; n: number } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [update, setUpdate] = useState<string | null>(() => window.hub?.updateReady?.() ?? null)
  useEffect(() => window.hub?.onUpdateReady?.(setUpdate), [])

  const start = async () => {
    const c = await connect()
    setConn(c)
    if (c.state === 'signedIn') setCtx({ store: createCloudStore(), requests: createCloudRequestStore(), social: createCloudSocialStore(), studio: createCloudStudioStore(), review: createCloudReviewStore(), book: createCloudBookStore(), brand: createCloudBrandStore(), reports: createCloudReportStore(), team: createCloudTeamStore(), me: c.me })
    else if (c.state === 'demo') setCtx({ store: createLocalStore(), requests: createLocalRequestStore('Jeremy Thompson'), social: createLocalSocialStore(() => 'Jeremy Thompson'), studio: createLocalStudioStore(() => demoAsRef.current), review: createLocalReviewStore(() => (guestAsRef.current ? { name: guestAsRef.current, guest: true } : { name: demoAsRef.current, guest: false })), book: createLocalBookStore(() => demoAsRef.current), brand: createLocalBrandStore(() => demoAsRef.current), reports: createDemoReportStore(), team: createDemoTeamStore(), me: null })
    else setCtx(null)
  }
  useEffect(() => {
    void start()
  }, [])
  useEffect(() => {
    ctx?.requests.team().then(setTeam).catch(() => {})
  }, [ctx])

  // Preview only: Sign Out shows the sign-in screen with a pretend code
  const [demoGate, setDemoGate] = useState(false)
  const signOut = async () => {
    if (!ctx?.me) return setDemoGate(true)
    if (window.hub?.hubUrl) await window.hub.signOut()
    else await fetch('/api/auth/signout', { method: 'POST', credentials: 'same-origin' }).catch(() => {})
    setCtx(null)
    setConn({ state: 'signedOut' })
  }

  // ⌘/ focuses search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault()
        setSection((s) => (s === 'requests' || s === 'calendar' || s === 'posts' || s === 'studio' ? s : 'requests'))
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!conn) return null
  if (demoGate) return <Gate state="signedOut" demo onRetry={() => setDemoGate(false)} />
  if (conn.state === 'signedOut' || conn.state === 'offline' || !ctx) {
    return <Gate state={conn.state === 'offline' ? 'offline' : 'signedOut'} onRetry={start} />
  }
  const { store, requests, social, studio, review, book, brand, reports, team: teamStore, me } = ctx
  const expired = () => {
    setCtx(null)
    setConn({ state: 'signedOut' })
  }
  const myName = me?.name ?? 'JT'
  const meId = { name: me?.name ?? 'Jeremy Thompson', email: me?.email ?? 'jeremy.thompson@northstarchurch.org' }
  const current = NAV.find((n) => n.id === section) ?? TEAM_NAV

  return (
    <div className="app">
      <header className={`topbar ${isDesktop && isMac ? 'desktop' : ''}`}>
        <div className="logo">
          <LogoMark size={50} /> Constellation
        </div>
        <nav className="crumbs" aria-label="Breadcrumb">
          <span className="dim">NorthStar Creative</span>
          <span className="sep" />
          <span>{current.label}</span>
        </nav>
        <label className="search">
          <IconSearch size={20} />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSection((s) => (s === 'requests' || s === 'calendar' || s === 'posts' || s === 'studio' ? s : 'requests'))
            }}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            placeholder={section === 'calendar' ? 'Search events, people, places' : section === 'posts' ? 'Search posts, captions, campaigns' : section === 'studio' ? 'Search boards and cards' : section === 'review' ? 'Search reviews and comments' : section === 'rolodex' ? 'Search vendors, contacts, notes' : section === 'brand' ? 'Search the brand guidelines' : section === 'team' ? 'Search people' : 'Search requests, people, ministries'}
            aria-label="Search"
          />
          {query ? (
            <button className="clear" onClick={() => setQuery('')} aria-label="Clear search">
              <IconClose size={18} />
            </button>
          ) : (
            <kbd>{isMac ? '⌘/' : 'Ctrl /'}</kbd>
          )}
        </label>
        {update && (
          <button className="update-btn" onClick={() => window.hub?.installUpdate()} title={`Version ${update} is ready`}>
            Restart To Update
          </button>
        )}
        <NotificationBell
          store={requests.notifications}
          onOpen={(n) => {
            if (n.kind.startsWith('review-')) {
              setSection('review')
              setReviewFocus({ reviewId: n.requestId, n: Date.now() })
              return
            }
            if (n.kind.startsWith('post-')) {
              setSection('posts')
              jump({ postFocus: n.requestId })
              return
            }
            setSection('requests')
            setFocus((f) => ({ id: n.requestId, n: (f?.n ?? 0) + 1 }))
          }}
        />
        <span className="me" title={me ? `${me.name} · ${me.email}` : 'Demo mode'}>
          <Avatar name={myName} size={46} />
        </span>
        <ThemeSwitch />
      </header>

      <nav className="rail" aria-label="Sections">
        {NAV.map((n) => (
          <button
            key={n.id}
            className={`rail-btn ${section === n.id ? 'active' : ''}`}
            onClick={() => {
              setSection(n.id)
              jump({})
              setReviewFocus(null)
              setReviewStart(null)
            }}
            aria-label={n.label}
            aria-current={section === n.id ? 'page' : undefined}
          >
            {n.icon}
            <span className="tip">{n.label}{n.blurb && !(n.id === 'posts' && social) && !(n.id === 'studio' && studio) && !(n.id === 'review' && review) && !(n.id === 'rolodex' && book) && !(n.id === 'brand' && brand) && !(n.id === 'reports' && reports) ? ' · Coming Soon' : ''}</span>
          </button>
        ))}
        <button
          className={`rail-btn rail-team ${section === 'team' ? 'active' : ''}`}
          onClick={() => {
            setSection('team')
            jump({})
          }}
          aria-label="Team"
          aria-current={section === 'team' ? 'page' : undefined}
        >
          <IconPeople />
          <span className="tip">Team</span>
        </button>
        <div className="rail-foot">
          <span className="sync-dot" style={{ background: store.mode === 'cloud' ? '#5cc46c' : '#f2cf62' }} />
          {store.mode === 'cloud' ? 'Synced' : 'Demo'}
          {(me || store.mode === 'demo') && (
            <button className="signout" onClick={signOut}>
              Sign Out
            </button>
          )}
        </div>
      </nav>

      {section === 'requests' ? (
        <RequestsPage
          store={requests}
          me={meId}
          query={query}
          onSignInExpired={expired}
          focus={focus}
          calendar={store}
          onOpenEvent={(id, date) => {
            setSection('calendar')
            setEventFocus((f) => ({ id, date, n: (f?.n ?? 0) + 1 }))
          }}
          reviews={
            review
              ? {
                  store: review,
                  open: (reviewId) => {
                    setSection('review')
                    setReviewFocus({ reviewId, n: Date.now() })
                  },
                  start: (requestId) => {
                    setSection('review')
                    setReviewStart({ requestId, n: Date.now() })
                  }
                }
              : undefined
          }
        />
      ) : section === 'calendar' ? (
        <CalendarPage
          store={store}
          me={myName}
          query={query}
          onSignInExpired={expired}
          focus={eventFocus}
          requests={requests}
          team={teamStore ?? undefined}
          onOpenRequest={(id) => {
            setSection('requests')
            setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }))
          }}
        />
      ) : section === 'team' && teamStore ? (
        <TeamPage store={teamStore} me={store.mode === 'demo' ? demoAs : myName} query={query} />
      ) : section === 'reports' && reports ? (
        <ReportsPage store={reports} />
      ) : section === 'brand' && brand ? (
        <BrandPage store={brand} me={store.mode === 'demo' ? demoAs : myName} query={query} />
      ) : section === 'rolodex' && book ? (
        <BlackBookPage store={book} query={query} />
      ) : section === 'review' && review ? (
        <ReviewPage
          store={review}
          requests={requests}
          query={query}
          me={store.mode === 'demo' ? demoAs : meId.name}
          team={team.map((m) => m.name)}
          focus={reviewFocus}
          startFor={reviewStart}
          onOpenRequest={(id) => {
            setSection('requests')
            setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }))
          }}
          onActAsGuest={(name) => (guestAsRef.current = name)}
        />
      ) : section === 'studio' && studio ? (
        <StudioPage
          store={studio}
          query={query}
          me={store.mode === 'demo' ? demoAs : meId.name}
          social={social}
          canPost={(store.mode === 'demo' ? demoAs : meId.name) === (team.find((m) => m.socialLead)?.name ?? (store.mode === 'demo' ? demoAs : meId.name))}
          viewingAs={store.mode === 'demo' ? { name: demoAs, team, set: setDemoAs } : undefined}
          focus={studioFocus}
          onCreatePost={(post) => {
            setSection('posts')
            jump({ postSeed: post })
          }}
          onOpenPost={(id) => {
            setSection('posts')
            jump({ postFocus: id })
          }}
        />
      ) : section === 'posts' && social ? (
        <PostingPage
          store={social}
          team={team}
          me={meId.name}
          query={query}
          focus={postFocus}
          seed={postSeed}
          studio={studio}
          viewingAs={demoAs}
          onViewingAs={setDemoAs}
          onPlanInStudio={async (post) => {
            if (!studio) return
            const boardId = await boardForPost(post, studio, social)
            setSection('studio')
            jump({ studioFocus: boardId })
          }}
        />
      ) : (
        <main className="main">
          <ComingSoon title={current.label} icon={current.icon}>
            {current.blurb}
          </ComingSoon>
        </main>
      )}
    </div>
  )
}
