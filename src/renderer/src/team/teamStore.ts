import { call, subscribeLive } from '../data/cloudStore'
import { DEFAULT_TEAM, type TeamMember } from '../data/requests'

export interface TeamEntry extends TeamMember {
  /** Last time they used Constellation (null = hasn't signed in yet) */
  lastActive: string | null
  /** Devices they're signed in on */
  devices: number
}

export type RolePatch = Partial<Pick<TeamMember, 'name' | 'pm' | 'assignable' | 'socialLead' | 'admin'>>

export interface TeamStore {
  mode: 'demo' | 'cloud'
  list(): Promise<TeamEntry[]>
  subscribe(onChange: () => void): () => void
  add(m: TeamMember): Promise<void>
  update(email: string, patch: RolePatch): Promise<void>
  /** Removes them and signs them out everywhere */
  remove(email: string): Promise<void>
  /** Signs them out on every device, but keeps them on the team */
  signOutEverywhere(email: string): Promise<void>
}

export function createCloudTeamStore(): TeamStore {
  const enc = encodeURIComponent
  return {
    mode: 'cloud',
    list: () => call<TeamEntry[]>('/api/team'),
    subscribe: (onChange) => subscribeLive(['team'], onChange),
    add: (m) => call('/api/team', 'POST', m).then(() => undefined),
    update: (email, patch) => call(`/api/team/${enc(email)}`, 'PATCH', patch).then(() => undefined),
    remove: (email) => call(`/api/team/${enc(email)}`, 'DELETE').then(() => undefined),
    signOutEverywhere: (email) => call(`/api/team/${enc(email)}/sessions`, 'DELETE').then(() => undefined)
  }
}

/** Preview: the current team, changes kept in memory */
export function createDemoTeamStore(): TeamStore {
  const day = 86400_000
  const ago = (d: number) => new Date(Date.now() - d * day).toISOString()
  const active: Record<string, [string | null, number]> = {
    'jeremy.thompson@northstarchurch.org': [ago(0), 2],
    'sarah.vanderheyden@northstarchurch.org': [ago(0.2), 1],
    'ca.phillips@northstarchurch.org': [ago(1), 1],
    'kendrick.banks@northstarchurch.org': [ago(3), 1],
    'stephanie.ford@northstarchurch.org': [ago(6), 1]
  }
  let team: TeamEntry[] = DEFAULT_TEAM.map((m) => ({ ...m, assignable: m.assignable !== false, lastActive: active[m.email]?.[0] ?? null, devices: active[m.email]?.[1] ?? 0 }))
  const listeners = new Set<() => void>()
  const changed = () => listeners.forEach((l) => l())
  const admins = () => team.filter((m) => m.admin).length
  return {
    mode: 'demo',
    list: async () => structuredClone(team),
    subscribe(onChange) {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    async add(m) {
      const email = m.email.trim().toLowerCase()
      if (team.some((t) => t.email === email)) throw new Error(`${email} is already on the team.`)
      if (m.socialLead) team = team.map((t) => ({ ...t, socialLead: false }))
      team = [...team, { ...m, email, lastActive: null, devices: 0 }]
      changed()
    },
    async update(email, patch) {
      const cur = team.find((t) => t.email === email)
      if (!cur) throw new Error('They’re no longer on the team.')
      if (patch.admin === false && cur.admin && admins() === 1) throw new Error('Someone has to be able to manage the team. Make another person a team admin first.')
      if (patch.socialLead) team = team.map((t) => ({ ...t, socialLead: false }))
      team = team.map((t) => (t.email === email ? { ...t, ...patch } : t))
      changed()
    },
    async remove(email) {
      const cur = team.find((t) => t.email === email)
      if (cur?.admin && admins() === 1) throw new Error('Someone has to be able to manage the team. Make another person a team admin first.')
      team = team.filter((t) => t.email !== email)
      changed()
    },
    async signOutEverywhere(email) {
      team = team.map((t) => (t.email === email ? { ...t, devices: 0 } : t))
      changed()
    }
  }
}
