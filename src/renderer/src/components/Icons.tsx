// Rounded line icons, drawn for this app (24px grid, 1.8 stroke).
type P = { size?: number }

const Svg = ({ size = 22, children }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
)

export const IconCalendar = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="4" />
    <path d="M8 3v4M16 3v4M3.5 10h17" />
    <circle cx="12" cy="15" r="1.6" />
  </Svg>
)
export const IconMegaphone = (p: P) => (
  <Svg {...p}>
    <path d="M4 10.5v3a1.5 1.5 0 0 0 1.5 1.5H7l7 4V5L7 9H5.5A1.5 1.5 0 0 0 4 10.5Z" />
    <path d="M17.5 9a4 4 0 0 1 0 6M8 15l1 4.5" />
  </Svg>
)
export const IconBoard = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4" width="7" height="7" rx="2" />
    <rect x="13.5" y="4" width="7" height="7" rx="2" />
    <rect x="3.5" y="13" width="7" height="7" rx="2" />
    <path d="M13.5 15h7M13.5 18.5h4.5" />
  </Svg>
)
export const IconFilm = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="14" rx="3.5" />
    <path d="m10.5 9.5 4 2.5-4 2.5v-5Z" />
  </Svg>
)
export const IconContacts = (p: P) => (
  <Svg {...p}>
    <rect x="4.5" y="3.5" width="15" height="17" rx="3.5" />
    <circle cx="12" cy="10" r="2.5" />
    <path d="M8 16.5c.8-1.6 2.2-2.4 4-2.4s3.2.8 4 2.4M2.5 8h2M2.5 12h2M2.5 16h2" />
  </Svg>
)
/** Reports: a small bar chart */
export const IconChart = (p: P) => (
  <Svg {...p}>
    <path d="M4 4v14.5A1.5 1.5 0 0 0 5.5 20H20" />
    <path d="M8.5 16v-4M12.5 16V8M16.5 16v-6" />
  </Svg>
)
/** Brand Library: the NorthStar star in a rounded square */
export const IconBrand = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
    <path d="M12 7.5l1.3 2.8 3 .3-2.3 2 .7 3-2.7-1.6-2.7 1.6.7-3-2.3-2 3-.3Z" />
  </Svg>
)
export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Svg>
)
export const IconFilter = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Svg>
)
export const IconPeople = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="8.5" r="2.8" />
    <circle cx="5.8" cy="10" r="2" />
    <circle cx="18.2" cy="10" r="2" />
    <path d="M7.5 18.5c.7-2.4 2.4-3.7 4.5-3.7s3.8 1.3 4.5 3.7M2.5 17c.4-1.6 1.6-2.6 3.3-2.6M21.5 17c-.4-1.6-1.6-2.6-3.3-2.6" />
  </Svg>
)
export const IconLayers = (p: P) => (
  <Svg {...p}>
    <path d="m12 4 8.5 4.5L12 13 3.5 8.5 12 4Z" />
    <path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5" />
  </Svg>
)
export const IconLink = (p: P) => (
  <Svg {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Svg>
)
export const IconChevron = ({ dir = 'left', ...p }: P & { dir?: 'left' | 'right' | 'down' }) => (
  <Svg {...p}>
    <path d={dir === 'left' ? 'm14.5 6-6 6 6 6' : dir === 'right' ? 'm9.5 6 6 6-6 6' : 'm6 9.5 6 6 6-6'} />
  </Svg>
)
export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)
export const IconPencil = (p: P) => (
  <Svg {...p}>
    <path d="M15 5.5 18.5 9M5 19l1-4.2L16.3 4.5a1.8 1.8 0 0 1 2.5 0l.7.7a1.8 1.8 0 0 1 0 2.5L9.2 18 5 19Z" />
  </Svg>
)
export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
  </Svg>
)
export const IconPin = (p: P) => (
  <Svg {...p}>
    <path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 0 0-13 0c0 5.4 6.5 11 6.5 11Z" />
    <circle cx="12" cy="10" r="2.3" />
  </Svg>
)
export const IconClock = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
)

export const IconInbox = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 13.5 6 5.8A2 2 0 0 1 7.9 4.5h8.2a2 2 0 0 1 1.9 1.3l2.5 7.7v4.5a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2v-4.5Z" />
    <path d="M3.5 13.5h4.6l1.4 2.5h5l1.4-2.5h4.6" />
  </Svg>
)
export const IconCopy = (p: P) => (
  <Svg {...p}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="3" />
    <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
  </Svg>
)
export const IconSend = (p: P) => (
  <Svg {...p}>
    <path d="M20.5 3.5 10 14M20.5 3.5 14 20.5l-4-6.5-6.5-4 17-6.5Z" />
  </Svg>
)
export const IconEye = (p: P) => (
  <Svg {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
)

/** NorthStar emblem (six-point star in a circle), traced from the church's mark. 1932-unit grid. */
const EMBLEM =
  'M966 0a966 966 0 1 0 0 1932A966 966 0 1 0 966 0Z' +
  'M966 277 1135 660 966 700 796 660Z' +
  'M380 639 966 772 1551 639 1305 977 1551 1316 1135 1271 966 1654 796 1271 380 1316 627 977Z'

export const Emblem = ({ size = 34 }: P) => (
  <svg width={size} height={size} viewBox="0 0 1932 1932" aria-hidden>
    <path fill="currentColor" fillRule="evenodd" d={EMBLEM} />
  </svg>
)

/** Constellation mark: the NorthStar emblem joined to two smaller stars. */
export const LogoMark = ({ size = 34 }: P) => (
  <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
    <path d="M23.4 13.6 33.5 6.5M25.3 24.8l8.7 3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.55" fill="none" />
    <g transform="translate(3.5 9.5) scale(0.0119)">
      <path fill="currentColor" fillRule="evenodd" d={EMBLEM} />
    </g>
    <circle cx="33.5" cy="6.5" r="3" fill="var(--accent)" />
    <circle cx="34" cy="28" r="2.2" fill="currentColor" />
  </svg>
)
export const IconLock = (p: P) => (
  <Svg {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="3" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </Svg>
)
