// Editors for the Brand Library: one block, a chapter's settings, and the "add content" picker.
import { useEffect, useState, type ReactNode } from 'react'
import { IconClose } from '../components/Icons'
import { BLOCK_TYPES, bid, cleanHex, inkOn, rgbOf, validHex, type BlockType, type BrandBlock, type Chapter, type FontSpec, type Swatch } from '../data/brand'

function Modal({ title, onClose, children, foot, wide }: { title: string; onClose: () => void; children: ReactNode; foot?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { width: 'min(980px, 100%)' } : undefined} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="round-btn" onClick={onClose} aria-label="Close"><IconClose size={20} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  )
}

const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <label className="field">
    <span>{label}{hint && <i className="bl-hint"> {hint}</i>}</span>
    {children}
  </label>
)

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)

export function AddBlockPicker({ onPick, onClose }: { onPick: (t: BlockType) => void; onClose: () => void }) {
  return (
    <Modal title="Add Content" onClose={onClose}>
      <div className="bl-picker">
        {BLOCK_TYPES.map((t) => (
          <button key={t.type} onClick={() => onPick(t.type)}>
            <b>{t.label}</b>
            <span>{t.hint}</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}

export function ChapterEditor({ chapter, isNew, onSave, onDelete, onMove, onClose }: { chapter: Chapter; isNew: boolean; onSave: (c: Chapter) => void; onDelete: () => void; onMove: (dir: -1 | 1) => void; onClose: () => void }) {
  const [c, setC] = useState(chapter)
  const [confirm, setConfirm] = useState(false)
  return (
    <Modal
      title={isNew ? 'New Chapter' : 'Chapter Settings'}
      onClose={onClose}
      foot={
        <>
          {!isNew &&
            (confirm ? (
              <button className="btn danger" onClick={onDelete}>Delete “{chapter.title}” and everything in it</button>
            ) : (
              <button className="btn danger" onClick={() => setConfirm(true)}>Delete Chapter</button>
            ))}
          {!isNew && (
            <>
              <button className="btn" onClick={() => onMove(-1)} title="Move earlier">↑ Move Up</button>
              <button className="btn" onClick={() => onMove(1)} title="Move later">↓ Move Down</button>
            </>
          )}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-primary sm" disabled={!c.title.trim()} onClick={() => onSave({ ...c, title: c.title.trim() })}>Save</button>
        </>
      }
    >
      <Field label="Title">
        <input autoFocus value={c.title} onChange={(e) => setC({ ...c, title: e.target.value })} placeholder="e.g. Templates" />
      </Field>
      <Field label="Intro" hint="(one line under the title)">
        <input value={c.intro} onChange={(e) => setC({ ...c, intro: e.target.value })} />
      </Field>
      <label className="check" style={{ color: 'var(--text)' }}>
        <input type="checkbox" className="cbox" checked={c.draft} onChange={(e) => setC({ ...c, draft: e.target.checked })} /> In progress: hide this chapter from staff until it’s ready
      </label>
    </Modal>
  )
}

export function BlockEditor({ block, onSave, onClose }: { block: BrandBlock; onSave: (b: BrandBlock) => void; onClose: () => void }) {
  const [b, setB] = useState<BrandBlock>(structuredClone(block))
  const label = BLOCK_TYPES.find((t) => t.type === b.type)?.label ?? 'Content'
  // Lists are edited as text (one per line) and turned back into arrays on save
  const [dos, setDos] = useState(b.type === 'rules' ? b.dos.join('\n') : '')
  const [donts, setDonts] = useState(b.type === 'rules' ? b.donts.join('\n') : '')
  const [cols, setCols] = useState(b.type === 'table' ? b.columns.join(' | ') : '')
  const [rows, setRows] = useState(b.type === 'table' ? b.rows.map((r) => r.join(' | ')).join('\n') : '')

  const save = () => {
    let out = b
    if (b.type === 'rules') out = { ...b, dos: lines(dos), donts: lines(donts) }
    if (b.type === 'table') {
      const columns = cols.split('|').map((x) => x.trim())
      out = { ...b, columns, rows: lines(rows).map((r) => r.split('|').map((x) => x.trim())) }
    }
    if (b.type === 'colors') out = { ...b, swatches: b.swatches.map((s) => ({ ...s, hex: cleanHex(s.hex) })) }
    onSave(out)
  }

  const heading = 'heading' in b && (
    <Field label="Heading">
      <input value={b.heading} onChange={(e) => setB({ ...b, heading: e.target.value } as BrandBlock)} />
    </Field>
  )
  const note = 'note' in b && (
    <Field label="Note" hint="(optional, shown under the heading)">
      <input value={b.note} onChange={(e) => setB({ ...b, note: e.target.value } as BrandBlock)} />
    </Field>
  )

  return (
    <Modal
      title={`Edit ${label}`}
      onClose={onClose}
      wide={b.type === 'colors' || b.type === 'fonts' || b.type === 'table'}
      foot={
        <>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-primary sm" onClick={save}>Save</button>
        </>
      }
    >
      {heading}
      {note}
      {b.type === 'text' && (
        <Field label="Text" hint="Blank line = new paragraph · “- ” at the start of lines = bullet list · **bold**">
          <textarea rows={10} value={b.body} onChange={(e) => setB({ ...b, body: e.target.value })} />
        </Field>
      )}

      {b.type === 'columns' && (
        <>
          {b.items.map((x, i) => (
            <div key={i} className="bl-ed-row">
              <input placeholder="Title" value={x.title} onChange={(e) => setB({ ...b, items: b.items.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)) })} />
              <textarea rows={2} placeholder="Text" value={x.body} onChange={(e) => setB({ ...b, items: b.items.map((y, j) => (j === i ? { ...y, body: e.target.value } : y)) })} />
              <button className="btn danger" onClick={() => setB({ ...b, items: b.items.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
          {b.items.length < 3 && <button className="btn" onClick={() => setB({ ...b, items: [...b.items, { title: '', body: '' }] })}>+ Add Column</button>}
        </>
      )}

      {b.type === 'rules' && (
        <div className="bl-ed-2">
          <Field label="Do" hint="(one per line)">
            <textarea rows={12} value={dos} onChange={(e) => setDos(e.target.value)} />
          </Field>
          <Field label="Don’t" hint="(one per line)">
            <textarea rows={12} value={donts} onChange={(e) => setDonts(e.target.value)} />
          </Field>
        </div>
      )}

      {b.type === 'colors' && (
        <>
          <div className="bl-ed-swatches">
            <span>Name</span>
            <span>HEX</span>
            <span>RGB <i className="bl-hint">(auto)</i></span>
            <span>CMYK</span>
            <span>PMS</span>
            <span />
            {b.swatches.map((s, i) => {
              const set = (patch: Partial<Swatch>) => setB({ ...b, swatches: b.swatches.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
              const ok = validHex(s.hex)
              return (
                <div key={s.id} className="row">
                  <input value={s.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Blue" />
                  <span className="hex">
                    <i style={{ background: ok ? `#${cleanHex(s.hex)}` : 'transparent', color: inkOn(s.hex) }} />
                    <input value={s.hex} onChange={(e) => set({ hex: e.target.value })} placeholder="00B7E2" aria-invalid={!ok} />
                  </span>
                  <input value={s.rgb} onChange={(e) => set({ rgb: e.target.value })} placeholder={rgbOf(s.hex) || '0, 183, 226'} />
                  <input value={s.cmyk} onChange={(e) => set({ cmyk: e.target.value })} placeholder="71, 5, 5, 0" />
                  <input value={s.pms} onChange={(e) => set({ pms: e.target.value })} placeholder="e.g. 306 C" />
                  <button className="btn danger" onClick={() => setB({ ...b, swatches: b.swatches.filter((_, j) => j !== i) })}>Remove</button>
                </div>
              )
            })}
          </div>
          <button className="btn" onClick={() => setB({ ...b, swatches: [...b.swatches, { id: bid(), name: '', hex: '', rgb: '', cmyk: '', pms: '' }] })}>+ Add Color</button>
        </>
      )}

      {b.type === 'fonts' && (
        <>
          {b.fonts.map((f, i) => {
            const set = (patch: Partial<FontSpec>) => setB({ ...b, fonts: b.fonts.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
            return (
              <div key={f.id} className="bl-ed-font">
                <input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Typeface name" />
                <select value={f.style} onChange={(e) => set({ style: e.target.value as FontSpec['style'] })} aria-label="Sample style">
                  <option value="heading">Sample: Helvetica Neue Bold</option>
                  <option value="mono">Sample: IBM Plex Mono</option>
                  <option value="body">Sample: Helvetica Neue Regular</option>
                </select>
                <input value={f.role} onChange={(e) => set({ role: e.target.value })} placeholder="Used for…" />
                <input value={f.caseRule} onChange={(e) => set({ caseRule: e.target.value })} placeholder="Case (Title Case…)" />
                <input value={f.sample} onChange={(e) => set({ sample: e.target.value })} placeholder="Sample text" />
                <input value={f.link} onChange={(e) => set({ link: e.target.value })} placeholder="Where to get it (link, optional)" />
                <button className="btn danger" onClick={() => setB({ ...b, fonts: b.fonts.filter((_, j) => j !== i) })}>Remove</button>
              </div>
            )
          })}
          <button className="btn" onClick={() => setB({ ...b, fonts: [...b.fonts, { id: bid(), name: '', style: 'body', role: '', caseRule: '', sample: 'Love God, Love People, Live Sent', link: '' }] })}>+ Add Typeface</button>
        </>
      )}

      {b.type === 'table' && (
        <>
          <Field label="Column headings" hint="(separate with |)">
            <input value={cols} onChange={(e) => setCols(e.target.value)} />
          </Field>
          <Field label="Rows" hint="(one row per line, cells separated with |)">
            <textarea rows={8} value={rows} onChange={(e) => setRows(e.target.value)} style={{ fontFamily: 'var(--mono)', fontSize: 13 }} />
          </Field>
        </>
      )}

      {b.type === 'logos' && (
        <>
          <p className="bl-hint" style={{ margin: 0 }}>Name each logo and pick the background it’s shown on. Add the files (SVG, PNG, PDF…) from the guide itself.</p>
          {b.slots.map((s, i) => (
            <div key={s.id} className="bl-ed-row">
              <input value={s.name} onChange={(e) => setB({ ...b, slots: b.slots.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} placeholder="e.g. Primary Logo" />
              <select value={s.bg} onChange={(e) => setB({ ...b, slots: b.slots.map((x, j) => (j === i ? { ...x, bg: e.target.value as 'light' | 'dark' } : x)) })}>
                <option value="light">On light</option>
                <option value="dark">On dark</option>
              </select>
              <button className="btn danger" onClick={() => setB({ ...b, slots: b.slots.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
          <button className="btn" onClick={() => setB({ ...b, slots: [...b.slots, { id: bid(), name: '', bg: 'light', files: [] }] })}>+ Add Logo</button>
        </>
      )}

      {b.type === 'examples' && (
        <>
          {b.items.map((x, i) => (
            <div key={x.id} className="bl-ed-row">
              <input value={x.label} onChange={(e) => setB({ ...b, items: b.items.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)) })} placeholder="e.g. Spacing" />
              <select value={x.good ? 'good' : 'bad'} onChange={(e) => setB({ ...b, items: b.items.map((y, j) => (j === i ? { ...y, good: e.target.value === 'good' } : y)) })}>
                <option value="good">✓ Proper</option>
                <option value="bad">✕ Improper</option>
              </select>
              <input value={x.caption} onChange={(e) => setB({ ...b, items: b.items.map((y, j) => (j === i ? { ...y, caption: e.target.value } : y)) })} placeholder="Caption (optional)" />
              <button className="btn danger" onClick={() => setB({ ...b, items: b.items.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
          <button className="btn" onClick={() => setB({ ...b, items: [...b.items, { id: bid(), label: '', good: true, caption: '', file: null }] })}>+ Add Example</button>
        </>
      )}

      {b.type === 'files' && <p className="bl-hint" style={{ margin: 0 }}>Add and remove files from the guide itself.</p>}
    </Modal>
  )
}
