import { call, download, subscribeLive, upload } from '../data/cloudStore'
import { newId } from '../data/constants'
import type { Vendor, VendorCategory, VendorFile, VendorPatch } from '../data/blackbook'

export type Secret = { kind: 'account' }

export interface BookStore {
  mode: 'demo' | 'cloud'
  load(): Promise<Vendor[]>
  subscribe(onChange: () => void): () => void
  create(name: string, category: VendorCategory): Promise<Vendor>
  update(id: string, patch: VendorPatch): Promise<void>
  remove(id: string): Promise<void>
  /** '' clears it */
  setAccount(id: string, value: string): Promise<void>
  /** The full value of a secret. Every reveal is written to the vendor's activity. */
  reveal(id: string, s: Secret, why: 'view' | 'copy'): Promise<string>
  addFile(id: string, file: File): Promise<void>
  removeFile(id: string, fileId: string): Promise<void>
  fileUrl(id: string, f: VendorFile): Promise<string>
}

// ---------- demo: sample vendors, saved only in this browser (all made up) ----------

const KEY = 'constellation.blackbook.v2'
type Secrets = Record<string, string> // "<vendorId>:account"
type State = { vendors: Vendor[]; secrets: Secrets }

function demo(): State {
  const at = new Date(Date.now() - 6 * 86400_000).toISOString()
  const secrets: Secrets = {}
  const v = (name: string, category: VendorCategory, extra: Partial<Vendor>, account = ''): Vendor => {
    const id = newId()
    if (account) secrets[`${id}:account`] = account
    return {
      id,
      name,
      category,
      website: '',
      phone: '',
      email: '',
      address: '',
      accountLast4: account.slice(-4),
      hasAccount: !!account,
      pricing: '',
      turnaround: '',
      notes: '',
      favorite: false,
      contacts: [],
      files: [],
      activity: [{ at, by: 'Jeremy Thompson', what: 'added this vendor' }],
      updatedAt: at,
      updatedBy: 'Jeremy Thompson',
      ...extra
    }
  }
  const c = (name: string, role: string, phone: string, email: string) => ({ id: newId(), name, role, phone, email })
  return {
    secrets,
    vendors: [
      v(
        'Peach State Printing',
        'Printing',
        {
          website: 'https://peachstateprinting.example',
          phone: '(770) 555-0142',
          email: 'orders@peachstateprinting.example',
          address: '1200 Industrial Pkwy, Marietta, GA',
          pricing: 'Postcards 4×6, 16pt: $0.09 ea @ 2,500\nBusiness cards: $38 / 500\nFree delivery over $250',
          turnaround: '3 business days; rush next-day +40%',
          notes: 'Ask for Dana for anything with spot UV. Send files as press-ready PDF with 0.125" bleed.',
          favorite: true,
          contacts: [c('Dana Whitfield', 'Account rep', '(770) 555-0143', 'dana@peachstateprinting.example'), c('Front desk', 'Orders', '(770) 555-0142', '')]
        },
        '0048213'
      ),
      v(
        'Kennesaw Banner Co.',
        'Signs & Banners',
        {
          phone: '(678) 555-0199',
          pricing: '13oz vinyl banner: $6.50/sq ft, hems + grommets included\nMesh: $8/sq ft',
          turnaround: '5 business days',
          notes: 'They store our balcony banner frames. Give a week’s notice for install.',
          contacts: [c('Marcus Lee', 'Owner', '(678) 555-0199', 'marcus@kennesawbanner.example')]
        },
        'NSC-2231'
      ),
      v('Allatoona AV Rentals', 'AV & Production', {
        website: 'https://allatoona-av.example',
        phone: '(770) 555-0177',
        pricing: 'LED wall panel: $85/day each\nHazer: $45/day',
        turnaround: 'Book 2 weeks out for Christmas/Easter',
        contacts: [c('Rob Castillo', 'Rentals', '(770) 555-0178', 'rob@allatoona-av.example')]
      }),
      v(
        'Adobe Creative Cloud',
        'Software & Subscriptions',
        { website: 'https://adobe.com', pricing: 'Teams: 5 seats, renews every July', notes: 'Billing contact is the finance office.' }
      ),
      v('Envato Elements', 'Stock Media & Fonts', { website: 'https://elements.envato.com', pricing: 'Annual team plan' }),
      v('Summit Screen Printing', 'Apparel & Promo', {
        phone: '(404) 555-0110',
        pricing: '2-color front print on Bella+Canvas 3001: $11.40 @ 100',
        turnaround: '10 business days',
        contacts: [c('Alyssa Moore', 'Sales', '(404) 555-0111', 'alyssa@summitscreen.example')]
      }),
      v('Jane Rivera Photography', 'Freelancers', {
        phone: '(470) 555-0123',
        email: 'jane@riveraphoto.example',
        pricing: '$150/hr, 2-hr minimum; edited gallery in 5 days',
        notes: 'Great with kids ministry events. Needs a W-9 on file each January.'
      }),
      v('Uline', 'Shipping & Supplies', { website: 'https://uline.com', phone: '1-800-555-0150' }, '81144392')
    ]
  }
}

export function createLocalBookStore(me: () => string): BookStore {
  let state: State
  try {
    state = JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? demo()
  } catch {
    state = demo()
  }
  const blobs = new Map<string, string>()
  const listeners = new Set<() => void>()
  const commit = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      /* storage full */
    }
    listeners.forEach((l) => l())
  }
  const now = () => new Date().toISOString()
  const edit = (id: string, fn: (v: Vendor) => Vendor, what?: string) => {
    state = {
      ...state,
      vendors: state.vendors.map((v) =>
        v.id === id ? { ...fn(v), updatedAt: now(), updatedBy: me(), activity: what ? [{ at: now(), by: me(), what }, ...v.activity].slice(0, 50) : v.activity } : v
      )
    }
  }
  const blank = (name: string, category: VendorCategory): Vendor => ({
    id: newId(),
    name: name.trim() || 'New Vendor',
    category,
    website: '',
    phone: '',
    email: '',
    address: '',
    accountLast4: '',
    hasAccount: false,
    pricing: '',
    turnaround: '',
    notes: '',
    favorite: false,
    contacts: [],
    files: [],
    activity: [{ at: now(), by: me(), what: 'added this vendor' }],
    updatedAt: now(),
    updatedBy: me()
  })

  return {
    mode: 'demo',
    load: async () => structuredClone(state.vendors),
    subscribe(onChange) {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    async create(name, category) {
      const v = blank(name, category)
      state = { ...state, vendors: [...state.vendors, v] }
      commit()
      return v
    },
    async update(id, patch) {
      const fields = Object.keys(patch).filter((k) => k !== 'favorite')
      edit(id, (v) => ({ ...v, ...patch }), fields.length ? `updated ${fields.map((f) => (f === 'contacts' ? 'contacts' : f)).join(', ')}` : undefined)
      commit()
    },
    async remove(id) {
      state = { ...state, vendors: state.vendors.filter((v) => v.id !== id) }
      for (const k of Object.keys(state.secrets)) if (k.startsWith(`${id}:`)) delete state.secrets[k]
      commit()
    },
    async setAccount(id, value) {
      const val = value.trim()
      if (val) state.secrets[`${id}:account`] = val
      else delete state.secrets[`${id}:account`]
      edit(id, (v) => ({ ...v, hasAccount: !!val, accountLast4: val.slice(-4) }), val ? 'changed the account number' : 'removed the account number')
      commit()
    },
    async reveal(id, s, why) {
      const v = state.vendors.find((x) => x.id === id)
      if (!v) throw new Error('That vendor was removed.')
      void s
      const value = state.secrets[`${id}:account`]
      if (value == null) throw new Error('Nothing stored there.')
      edit(id, (x) => x, `${why === 'copy' ? 'copied' : 'viewed'} the account number`)
      commit()
      return value
    },
    async addFile(id, file) {
      const f: VendorFile = { id: newId(), name: file.name, contentType: file.type || 'application/octet-stream', size: file.size, uploadedBy: me(), at: now() }
      blobs.set(f.id, URL.createObjectURL(file))
      edit(id, (v) => ({ ...v, files: [...v.files, f] }), `added ${file.name}`)
      commit()
    },
    async removeFile(id, fileId) {
      edit(id, (v) => ({ ...v, files: v.files.filter((f) => f.id !== fileId) }), 'removed a file')
      commit()
    },
    fileUrl: async (_id, f) => {
      const u = blobs.get(f.id)
      if (!u) throw new Error('Files added in the preview only last until the page reloads.')
      return u
    },
  }
}

// ---------- team: shared on Cloudflare ----------

export function createCloudBookStore(): BookStore {
  const blobs = new Map<string, Promise<string>>()
  return {
    mode: 'cloud',
    load: async () => (await call<{ vendors: Vendor[] }>('/api/vendors')).vendors,
    subscribe: (onChange) => subscribeLive(['vendors'], onChange),
    create: (name, category) => call<Vendor>('/api/vendors', 'POST', { name, category }),
    update: (id, patch) => call(`/api/vendors/${id}`, 'PATCH', patch).then(() => undefined),
    remove: (id) => call(`/api/vendors/${id}`, 'DELETE').then(() => undefined),
    setAccount: (id, value) => call(`/api/vendors/${id}/account`, 'PUT', { value }).then(() => undefined),
    reveal: async (id, _s, why) => (await call<{ value: string }>(`/api/vendors/${id}/reveal`, 'POST', { why })).value,
    addFile: (id, file) => upload(`/api/vendors/${id}/files?name=${encodeURIComponent(file.name)}`, file).then(() => undefined),
    removeFile: (id, fileId) => call(`/api/vendors/${id}/files/${fileId}`, 'DELETE').then(() => undefined),
    fileUrl(id, f) {
      const path = `/api/vendors/${id}/files/${f.id}`
      let p = blobs.get(path)
      if (!p) {
        p = download(path).then((b) => URL.createObjectURL(b))
        p.catch(() => blobs.delete(path))
        blobs.set(path, p)
      }
      return p
    }
  }
}
