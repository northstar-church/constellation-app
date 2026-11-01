import { formatDistanceToNow, parseISO } from 'date-fns'
import { useEffect, useMemo, useRef, useState } from 'react'
import { IconClose, IconCopy, IconPlus } from '../components/Icons'
import { hostOf, letterOf, masked, VENDOR_CATEGORIES, type Vendor, type VendorCategory, type VendorContact } from '../data/blackbook'
import { newId } from '../data/constants'
import { fileSize } from '../data/requests'
import type { BookStore, Secret } from './bookStore'

interface Props {
  store: BookStore
  query: string
}

const CAT_HUES: Record<VendorCategory, number> = {
  Printing: 200,
  'Signs & Banners': 30,
  'Apparel & Promo': 330,
  'AV & Production': 265,
  'Photo & Video': 160,
  'Software & Subscriptions': 220,
  'Stock Media & Fonts': 290,
  'Web & Hosting': 180,
  Freelancers: 45,
  'Shipping & Supplies': 100,
  Other: 0
}
const initials = (n: string) =>
  n
    .replace(/[^A-Za-z0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || '?'

function Monogram({ v, size = 40 }: { v: Pick<Vendor, 'name' | 'category'>; size?: number }) {
  const h = CAT_HUES[v.category]
  return (
    <span className="bb-mono" style={{ width: size, height: size, fontSize: size * 0.38, background: v.category === 'Other' ? 'var(--surface-3)' : `light-dark(hsl(${h} 70% 92%), hsl(${h} 35% 24%))`, color: v.category === 'Other' ? 'var(--muted)' : `light-dark(hsl(${h} 55% 32%), hsl(${h} 70% 82%))` }}>
      {initials(v.name)}
    </span>
  )
}

/** Copies, then clears the clipboard after 30 seconds (like a password manager). */
async function copySecret(value: string) {
  await navigator.clipboard.writeText(value)
  setTimeout(() => {
    navigator.clipboard
      .readText()
      .then((now) => {
        if (now === value) void navigator.clipboard.writeText('')
      })
      .catch(() => {})
  }, 30_000)
}

/** A secret shown as dots; Show reveals it for 20 seconds, Copy copies it. Both are logged. */
function SecretValue({ label, vendor, secret, store, onError }: { label: string; vendor: Vendor; secret: Secret; store: BookStore; onError: (m: string) => void }) {
  const [shown, setShown] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (shown == null) return
    const t = setTimeout(() => setShown(null), 20_000)
    return () => clearTimeout(t)
  }, [shown])
  return (
    <span className="bb-secret">
      <code>{shown ?? label}</code>
      <button className="rc-mini" onClick={() => (shown != null ? setShown(null) : store.reveal(vendor.id, secret, 'view').then(setShown).catch((e) => onError((e as Error).message)))}>
        {shown != null ? 'Hide' : 'Show'}
      </button>
      <button
        className="rc-mini"
        onClick={() =>
          store
            .reveal(vendor.id, secret, 'copy')
            .then(copySecret)
            .then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1600)
            })
            .catch((e) => onError((e as Error).message))
        }
        title="Copies it; the clipboard clears after 30 seconds"
      >
        <IconCopy size={13} /> {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  )
}

function Field({ label, value, onSave, placeholder, multiline, link }: { label: string; value: string; onSave: (v: string) => void; placeholder?: string; multiline?: boolean; link?: string }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const save = () => v.trim() !== value && onSave(v.trim())
  return (
    <label className="bb-field">
      <span>
        {label}
        {link && value && (
          <a href={link} target="_blank" rel="noreferrer" className="bb-open" onClick={(e) => e.stopPropagation()}>
            Open ↗
          </a>
        )}
      </span>
      {multiline ? (
        <textarea rows={3} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={save} />
      ) : (
        <input value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      )}
    </label>
  )
}

function VendorPanel({ v, store, onError, onDeleted }: { v: Vendor; store: BookStore; onError: (m: string) => void; onDeleted: () => void }) {
  const [name, setName] = useState(v.name)
  const [editingAcct, setEditingAcct] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [drop, setDrop] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => setName(v.name), [v.name])
  const save = (patch: Parameters<BookStore['update']>[1]) => void store.update(v.id, patch).catch((e) => onError((e as Error).message))
  const setContact = (c: VendorContact, patch: Partial<VendorContact>) => save({ contacts: v.contacts.map((x) => (x.id === c.id ? { ...x, ...patch } : x)) })
  const addFiles = (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) void store.addFile(v.id, f).catch((e) => onError((e as Error).message))
  }

  return (
    <section className="bb-panel" aria-label={v.name}>
      <div className="bb-head">
        <Monogram v={v} size={58} />
        <div className="bb-title">
          <input
            className="bb-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name !== v.name && save({ name: name.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            aria-label="Vendor name"
          />
          <select value={v.category} onChange={(e) => save({ category: e.target.value as VendorCategory })} aria-label="Category">
            {VENDOR_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <button className={`bb-star ${v.favorite ? 'on' : ''}`} onClick={() => save({ favorite: !v.favorite })} aria-pressed={v.favorite} title={v.favorite ? 'Remove from favorites' : 'Favorite'}>
          {v.favorite ? '★' : '☆'}
        </button>
      </div>

      <div className="bb-grid">
        <Field label="Website" value={v.website} onSave={(website) => save({ website })} placeholder="https://" link={v.website && (/^https?:/.test(v.website) ? v.website : `https://${v.website}`)} />
        <Field label="Phone" value={v.phone} onSave={(phone) => save({ phone })} placeholder="(770) 555-0100" link={v.phone && `tel:${v.phone.replace(/[^\d+]/g, '')}`} />
        <Field label="Email" value={v.email} onSave={(email) => save({ email })} placeholder="orders@…" link={v.email && `mailto:${v.email}`} />
        <Field label="Address" value={v.address} onSave={(address) => save({ address })} placeholder="Street, city" />
      </div>

      <div className="bb-block">
        <div className="bb-block-head">
          <b>Account Number</b>
        </div>
        {editingAcct != null ? (
          <form
            className="bb-inline"
            onSubmit={(e) => {
              e.preventDefault()
              void store
                .setAccount(v.id, editingAcct)
                .then(() => setEditingAcct(null))
                .catch((x) => onError((x as Error).message))
            }}
          >
            <input autoFocus value={editingAcct} onChange={(e) => setEditingAcct(e.target.value)} placeholder="Account or customer number" autoComplete="off" />
            <button className="btn-primary sm">Save</button>
            <button type="button" className="btn sm" onClick={() => setEditingAcct(null)}>
              Cancel
            </button>
          </form>
        ) : v.hasAccount ? (
          <div className="bb-row">
            <SecretValue label={masked(v.accountLast4)} vendor={v} secret={{ kind: 'account' }} store={store} onError={onError} />
            <button className="rc-mini" onClick={() => setEditingAcct('')}>
              Change
            </button>
          </div>
        ) : (
          <button className="rc-mini" onClick={() => setEditingAcct('')}>
            + Add account number
          </button>
        )}
      </div>

      <div className="bb-block">
        <div className="bb-block-head">
          <b>Contacts</b>
          <button className="rc-mini" onClick={() => save({ contacts: [...v.contacts, { id: newId(), name: '', role: '', phone: '', email: '' }] })}>
            + Add Contact
          </button>
        </div>
        {v.contacts.map((c) => (
          <div key={c.id} className="bb-contact">
            {(['name', 'role', 'phone', 'email'] as const).map((k) => (
              <input
                key={k}
                defaultValue={c[k]}
                placeholder={k === 'name' ? 'Name' : k === 'role' ? 'Role' : k === 'phone' ? 'Phone' : 'Email'}
                onBlur={(e) => e.target.value.trim() !== c[k] && setContact(c, { [k]: e.target.value.trim() })}
                aria-label={k}
              />
            ))}
            <button className="rc-mini danger" onClick={() => save({ contacts: v.contacts.filter((x) => x.id !== c.id) })} aria-label="Remove contact">
              ✕
            </button>
          </div>
        ))}
        {!v.contacts.length && <span className="muted-sm">No contacts yet.</span>}
      </div>

      <div className="bb-grid two">
        <Field label="Pricing" value={v.pricing} onSave={(pricing) => save({ pricing })} placeholder="Rates, minimums, quantity breaks…" multiline />
        <Field label="Turnaround" value={v.turnaround} onSave={(turnaround) => save({ turnaround })} placeholder="e.g. 3 business days; rush +40%" multiline />
      </div>
      <Field label="Notes" value={v.notes} onSave={(notes) => save({ notes })} placeholder="Who to ask for, file specs, quirks…" multiline />

      <div
        className={`bb-block bb-files ${drop ? 'over' : ''}`}
        onDragOver={(e) => (e.preventDefault(), setDrop(true))}
        onDragLeave={() => setDrop(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrop(false)
          addFiles(e.dataTransfer.files)
        }}
      >
        <div className="bb-block-head">
          <b>Files</b>
          <button className="rc-mini" onClick={() => fileRef.current?.click()}>
            + Add Files
          </button>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ''))} />
        </div>
        {v.files.map((f) => (
          <div key={f.id} className="bb-file">
            <button
              className="bb-file-name"
              onClick={() =>
                void store
                  .fileUrl(v.id, f)
                  .then((u) => {
                    const a = document.createElement('a')
                    a.href = u
                    a.download = f.name
                    a.click()
                  })
                  .catch((e) => onError((e as Error).message))
              }
            >
              {f.name}
            </button>
            <span className="muted-sm">
              {fileSize(f.size)} · {f.uploadedBy.split(' ')[0]}
            </span>
            <button className="rc-mini danger" onClick={() => void store.removeFile(v.id, f.id)}>
              Remove
            </button>
          </div>
        ))}
        {!v.files.length && <span className="muted-sm">Drop W-9s, price sheets and quotes here.</span>}
      </div>

      <div className="bb-block bb-activity">
        <div className="bb-block-head">
          <b>Activity</b>
          <span className="muted-sm">Every time someone views or copies the account number shows here.</span>
        </div>
        {v.activity.slice(0, 8).map((a, i) => (
          <div key={i} className="bb-act">
            <b>{a.by.split(' ')[0]}</b> {a.what}
            <span className="muted-sm"> · {formatDistanceToNow(parseISO(a.at), { addSuffix: true })}</span>
          </div>
        ))}
      </div>

      <div className="bb-foot">
        {confirmDelete ? (
          <>
            <span className="muted-sm">Delete {v.name} and its files?</span>
            <button className="btn danger sm" onClick={() => void store.remove(v.id).then(onDeleted)}>
              Delete
            </button>
            <button className="btn sm" onClick={() => setConfirmDelete(false)}>
              Keep
            </button>
          </>
        ) : (
          <button className="btn danger sm" onClick={() => setConfirmDelete(true)}>
            Delete Vendor
          </button>
        )}
      </div>
    </section>
  )
}

export function BlackBookPage({ store, query }: Props) {
  const [vendors, setVendors] = useState<Vendor[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [cat, setCat] = useState<VendorCategory | 'all'>('all')
  const [favOnly, setFavOnly] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = () => store.load().then(setVendors).catch((e) => setError((e as Error).message))
    void load()
    return store.subscribe(load)
  }, [store])
  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(''), 6000)
    return () => clearTimeout(t)
  }, [error])

  const q = query.trim().toLowerCase()
  const list = useMemo(
    () =>
      (vendors ?? [])
        .filter((v) => (cat === 'all' || v.category === cat) && (!favOnly || v.favorite))
        .filter(
          (v) =>
            !q ||
            [v.name, v.category, v.website, v.email, v.phone, v.notes, v.pricing, ...v.contacts.flatMap((c) => [c.name, c.email, c.phone])]
              .join(' ')
              .toLowerCase()
              .includes(q)
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [vendors, cat, favOnly, q]
  )
  const current = (vendors ?? []).find((v) => v.id === selected) ?? null
  useEffect(() => {
    if (!selected && list.length) setSelected(list[0].id)
  }, [list, selected])

  let lastLetter = ''
  return (
    <main className="main blackbook">
      <div className="page-head">
        <h1>Little Black Book</h1>
        <button
          className="btn-primary"
          onClick={() =>
            void store
              .create('New Vendor', cat === 'all' ? 'Other' : cat)
              .then((v) => setSelected(v.id))
              .catch((e) => setError((e as Error).message))
          }
        >
          Add Vendor <IconPlus size={18} />
        </button>
      </div>
      {store.mode === 'demo' && <div className="banner">Preview with made-up vendors, saved only in this browser. Account numbers are made up.</div>}
      {error && <div className="banner warn">{error}</div>}

      <div className="bb-body">
        <aside className="bb-list" aria-label="Vendors">
          <div className="bb-filters">
            <select value={cat} onChange={(e) => setCat(e.target.value as VendorCategory | 'all')} aria-label="Category">
              <option value="all">All categories</option>
              {VENDOR_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <button className={`rc-chip ${favOnly ? 'on' : ''}`} onClick={() => setFavOnly((f) => !f)}>
              ★ Favorites
            </button>
          </div>
          <div className="bb-scroll">
            {!vendors ? (
              <div className="empty sm">Loading…</div>
            ) : !list.length ? (
              <div className="empty sm">{vendors.length ? 'No vendors match.' : 'No vendors yet.'}</div>
            ) : (
              list.map((v) => {
                const letter = letterOf(v.name)
                const head = letter !== lastLetter
                lastLetter = letter
                return (
                  <div key={v.id}>
                    {head && <div className="bb-letter">{letter}</div>}
                    <button className={`bb-item ${v.id === selected ? 'on' : ''}`} onClick={() => setSelected(v.id)}>
                      <Monogram v={v} size={36} />
                      <span className="bb-item-text">
                        <b>{v.name}</b>
                        <small className="muted-sm">{v.category}{v.website ? ` · ${hostOf(v.website)}` : ''}</small>
                      </span>
                      {v.favorite && <span className="bb-fav">★</span>}
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </aside>
        {current ? <VendorPanel key={current.id} v={current} store={store} onError={setError} onDeleted={() => setSelected(null)} /> : <div className="bb-panel empty">Pick a vendor.</div>}
      </div>

    </main>
  )
}
