import { call, download, subscribeLive, upload } from '../data/cloudStore'
import { seedDoc, type BrandDoc, type BrandFile } from '../data/brand'

export class BrandConflict extends Error {}

export interface BrandStore {
  mode: 'demo' | 'cloud'
  load(): Promise<BrandDoc>
  subscribe(onChange: () => void): () => void
  /** Saves the whole guide. Throws BrandConflict if someone else saved first. */
  save(doc: BrandDoc): Promise<BrandDoc>
  upload(file: File): Promise<BrandFile>
  /** A URL to show or download the file */
  fileUrl(f: BrandFile): Promise<string>
  /** The staff page's private link (team only) */
  link?(): Promise<string>
  newLink?(): Promise<string>
}

const newId = () => Math.random().toString(36).slice(2, 12)

/** Preview: starts from the Illustrator draft, kept in this browser only. Files last until reload. */
export function createLocalBrandStore(me: () => string): BrandStore {
  const KEY = 'constellation.brand.v1'
  let doc: BrandDoc
  try {
    doc = JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? seedDoc()
  } catch {
    doc = seedDoc()
  }
  const blobs = new Map<string, string>()
  const listeners = new Set<() => void>()
  let link = 'https://constellation.northstar-creative.workers.dev/track/brand/h8Lm2QwZr5Tn9Vx4'
  return {
    mode: 'demo',
    load: async () => structuredClone(doc),
    subscribe(onChange) {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    async save(next) {
      if (next.version !== doc.version) throw new BrandConflict('Someone else just changed the guidelines.')
      doc = { ...structuredClone(next), version: doc.version + 1 }
      try {
        localStorage.setItem(KEY, JSON.stringify(doc))
      } catch {
        /* storage full or blocked: keep it in memory */
      }
      listeners.forEach((l) => l())
      return structuredClone(doc)
    },
    async upload(file) {
      const f: BrandFile = { id: newId(), name: file.name, contentType: file.type || 'application/octet-stream', size: file.size, uploadedBy: me(), at: new Date().toISOString() }
      blobs.set(f.id, URL.createObjectURL(file))
      return f
    },
    async fileUrl(f) {
      const u = blobs.get(f.id)
      if (!u) throw new Error('Files added in the preview only last until the page reloads.')
      return u
    },
    link: async () => link,
    async newLink() {
      link = link.replace(/[^/]+$/, newId() + newId())
      return link
    }
  }
}

/** The team's guide on Cloudflare */
export function createCloudBrandStore(): BrandStore {
  const hubUrl = window.hub?.hubUrl || location.origin
  const urls = new Map<string, Promise<string>>()
  const staffUrl = (token: string) => `${hubUrl}/track/brand/${token}`
  return {
    mode: 'cloud',
    load: () => call<BrandDoc>('/api/brand'),
    subscribe: (onChange) => subscribeLive(['brand'], onChange),
    async save(doc) {
      try {
        return await call<BrandDoc>('/api/brand', 'PUT', doc)
      } catch (e) {
        if (/changed the guidelines/i.test((e as Error).message)) throw new BrandConflict((e as Error).message)
        throw e
      }
    },
    upload: (file) => upload<BrandFile>(`/api/brand/files?name=${encodeURIComponent(file.name)}`, file),
    fileUrl(f) {
      let p = urls.get(f.id)
      if (!p) {
        p = download(`/api/brand/files/${f.id}`).then((b) => URL.createObjectURL(b))
        p.catch(() => urls.delete(f.id))
        urls.set(f.id, p)
      }
      return p
    },
    link: async () => staffUrl((await call<{ token: string }>('/api/brand/staff-link')).token),
    newLink: async () => staffUrl((await call<{ token: string }>('/api/brand/staff-link', 'POST')).token)
  }
}
