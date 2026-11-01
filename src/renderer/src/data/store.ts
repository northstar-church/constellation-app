import type { CalendarSnapshot, CategoryId, EspaceStatus, Feed, Milestone, TeamEvent } from './types'

/**
 * The team calendar talks to its data through this interface, so the same UI runs
 * on demo data (this computer only) or on the shared Cloudflare backend.
 */
export interface CalendarStore {
  mode: 'demo' | 'cloud'
  load(): Promise<CalendarSnapshot>
  /** Called whenever anyone on the team changes something. Returns an unsubscribe fn. */
  subscribe(onChange: () => void, onStatus?: (live: boolean) => void): () => void
  /** Saves the event and replaces its milestone list. */
  saveEvent(event: TeamEvent, milestones: Milestone[]): Promise<void>
  deleteEvent(id: string): Promise<void>
  setMilestoneDone(id: string, done: boolean): Promise<void>
  /** Subscribe links. Only available when connected to the team backend. */
  feeds?: FeedApi
  /** Events brought in from eSpace (read-only here except ministry, owner, notes and promo timeline) */
  espace?: EspaceApi
  /** The read-only staff page's private link */
  staffLink?: { get(): Promise<string>; rotate(): Promise<string> }
}

export interface EspaceApi {
  status(): Promise<EspaceStatus>
  /** What each eSpace category becomes in Constellation (null = don't bring in) */
  setMapping(categoryId: number, mapTo: CategoryId | null): Promise<void>
  syncNow(): Promise<void>
  /** Add or change who books for which ministry (null ministry = remove them from the list) */
  setBooker(email: string, name: string, ministry: string | null): Promise<void>
  /** Replace eSpace's ministry list (add or remove one) */
  setMinistries(list: string[]): Promise<void>
}

export interface FeedApi {
  list(): Promise<Feed[]>
  create(input: { name: string; categories: string[] | null; includeMilestones: boolean }): Promise<Feed>
  remove(id: string): Promise<void>
  url(feed: Feed): string
}
