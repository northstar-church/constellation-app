// Renders the brand guidelines: chapter list on the left, the guide on the right.
// Used by the app (with editing) and by the staff page (read only, drafts hidden).
import { format, parseISO } from 'date-fns'
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { inkOn, rgbOf, type BrandBlock, type BrandDoc, type BrandFile, type Chapter, type Example, type LogoSlot } from '../data/brand'
import './brand.css'

/** Present only when the viewer can edit */
export interface EditApi {
  editBlock(chapterId: string, block: BrandBlock): void
  addBlock(chapterId: string, index: number): void
  moveBlock(chapterId: string, blockId: string, dir: -1 | 1): void
  removeBlock(chapterId: string, blockId: string): void
  editChapter(ch: Chapter): void
  addChapter(): void
  /** Adds files to a logo slot / example / downloads block */
  upload(chapterId: string, blockId: string, target: string | null, files: File[]): void
  removeFile(chapterId: string, blockId: string, target: string | null, fileId: string): void
}

const isImage = (f: BrandFile) => /^image\/(png|jpe?g|gif|webp|svg\+xml)$/.test(f.contentType) || /\.(png|jpe?g|gif|webp|svg)$/i.test(f.name)
const extOf = (f: BrandFile) => (f.name.split('.').pop() ?? 'file').toUpperCase()
const sizeOf = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`)

/** **bold** inside a line */
function inline(s: string): ReactNode {
  return s.split(/(\*\*[^*]+\*\*)/).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <b key={i}>{part.slice(2, -2)}</b> : <Fragment key={i}>{part}</Fragment>))
}
/** Paragraphs separated by blank lines; lines starting with "- " become a list */
export function Prose({ text }: { text: string }) {
  const paras = text.trim().split(/\n\s*\n/)
  return (
    <div className="bl-prose">
      {paras.map((p, i) => {
        const lines = p.split('\n')
        if (lines.every((l) => /^\s*[-•]\s+/.test(l))) return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-•]\s+/, ''))}</li>)}</ul>
        return <p key={i}>{lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>)}</p>
      })}
    </div>
  )
}

function blockText(b: BrandBlock): string {
  switch (b.type) {
    case 'text':
      return `${b.heading} ${b.body}`
    case 'columns':
      return b.items.map((x) => `${x.title} ${x.body}`).join(' ')
    case 'rules':
      return `${b.heading} ${b.dos.join(' ')} ${b.donts.join(' ')}`
    case 'colors':
      return `${b.heading} ${b.note} ${b.swatches.map((s) => `${s.name} ${s.hex} ${s.cmyk} ${s.pms}`).join(' ')}`
    case 'fonts':
      return `${b.heading} ${b.fonts.map((f) => `${f.name} ${f.role} ${f.caseRule}`).join(' ')}`
    case 'table':
      return `${b.heading} ${b.note} ${b.columns.join(' ')} ${b.rows.flat().join(' ')}`
    case 'logos':
      return `${b.heading} ${b.note} ${b.slots.map((s) => s.name).join(' ')}`
    case 'examples':
      return `${b.heading} ${b.note} ${b.items.map((x) => `${x.label} ${x.caption}`).join(' ')}`
    case 'files':
      return `${b.heading} ${b.note} ${b.files.map((f) => f.name).join(' ')}`
  }
}

export function BrandGuide({
  doc,
  fileUrl,
  edit,
  query = '',
  staff = false,
  showDrafts = false,
  head
}: {
  doc: BrandDoc
  fileUrl: (f: BrandFile) => Promise<string>
  edit?: EditApi
  query?: string
  /** Staff view: drafts hidden */
  staff?: boolean
  /** Preview only: show in-progress chapters on the staff view anyway, labeled */
  showDrafts?: boolean
  /** Shown above the chapters on the right */
  head?: ReactNode
}) {
  const q = query.trim().toLowerCase()
  const chapters = useMemo(() => {
    const visible = doc.chapters.filter((c) => !(staff && c.draft && !showDrafts))
    if (!q) return visible
    return visible
      .map((c) => ({ ...c, blocks: c.title.toLowerCase().includes(q) ? c.blocks : c.blocks.filter((b) => blockText(b).toLowerCase().includes(q)) }))
      .filter((c) => c.blocks.length || c.title.toLowerCase().includes(q))
  }, [doc, staff, showDrafts, q])

  const [active, setActive] = useState(chapters[0]?.id ?? '')
  const scroller = useRef<HTMLDivElement>(null)
  const [toast, setToast] = useState('')
  const copy = (label: string, value: string) => {
    navigator.clipboard?.writeText(value).then(
      () => {
        setToast(`Copied ${label}`)
        setTimeout(() => setToast(''), 1600)
      },
      () => window.prompt('Copy this:', value)
    )
  }

  // Highlight the chapter in view
  useEffect(() => {
    const root = scroller.current
    if (!root) return
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (top) setActive(top.target.id.replace(/^ch-/, ''))
      },
      { root: root.closest('.bl-scroll') ?? null, rootMargin: '0px 0px -70% 0px' }
    )
    root.querySelectorAll('.bl-chapter').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [chapters])

  const go = (id: string) => {
    setActive(id)
    document.getElementById(`ch-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="bl">
      <nav className="bl-toc" aria-label="Chapters">
        <span className="bl-toc-h">Chapters</span>
        {chapters.map((c, i) => (
          <button key={c.id} className={active === c.id ? 'on' : ''} onClick={() => go(c.id)}>
            <span className="num">{String(i + 1).padStart(2, '0')}</span>
            <span className="t">{c.title}</span>
            {c.draft && !staff && <span className="bl-draft-dot" title="In progress: hidden from staff" />}
          </button>
        ))}
        {edit && !q && <button className="bl-add-ch" onClick={edit.addChapter}>+ Add Chapter</button>}
      </nav>

      <div className="bl-doc" ref={scroller}>
        {head}
        {q && !chapters.length && <div className="bl-empty">Nothing in the guidelines matches “{query}”.</div>}
        {chapters.map((c, i) => (
          <section key={c.id} id={`ch-${c.id}`} className={`bl-chapter ${c.draft ? 'draft' : ''}`}>
            <header className="bl-ch-head">
              <span className="bl-kicker">{String(i + 1).padStart(2, '0')} · {c.title}</span>
              <div className="bl-ch-title">
                <h2>{c.title}</h2>
                {c.draft && !staff && <span className="bl-pill draft">In progress · hidden from staff</span>}
                {c.draft && staff && showDrafts && <span className="bl-pill draft">Preview only · hidden on the real link until it’s ready</span>}
                {edit && <button className="bl-mini" onClick={() => edit.editChapter(c)}>Chapter Settings</button>}
              </div>
              {c.intro && <p className="bl-intro">{c.intro}</p>}
            </header>

            {!c.blocks.length && !q && (
              <div className="bl-empty">
                {edit ? 'Nothing here yet.' : 'This chapter is still being written.'}
                {edit && <button className="bl-mini" onClick={() => edit.addBlock(c.id, 0)}>+ Add Content</button>}
              </div>
            )}

            {c.blocks.map((b, bi) => (
              <div key={b.id} className={`bl-block bk-${b.type}`}>
                {edit && !q && (
                  <div className="bl-tools">
                    <button onClick={() => edit.editBlock(c.id, b)}>Edit</button>
                    <button onClick={() => edit.moveBlock(c.id, b.id, -1)} disabled={bi === 0} aria-label="Move up">↑</button>
                    <button onClick={() => edit.moveBlock(c.id, b.id, 1)} disabled={bi === c.blocks.length - 1} aria-label="Move down">↓</button>
                    <button onClick={() => edit.removeBlock(c.id, b.id)} aria-label="Remove">Remove</button>
                  </div>
                )}
                <Block b={b} chapterId={c.id} edit={edit} fileUrl={fileUrl} copy={copy} />
                {edit && !q && (
                  <button className="bl-insert" onClick={() => edit.addBlock(c.id, bi + 1)} title="Add content here">
                    <span>
                      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                    </span>
                  </button>
                )}
              </div>
            ))}

            <footer className="bl-ch-foot">Updated {format(parseISO(c.updatedAt), 'MMM d, yyyy')}{staff ? '' : ` by ${c.updatedBy}`}</footer>
          </section>
        ))}
      </div>
      {toast && <div className="bl-toast">{toast}</div>}
    </div>
  )
}

function Block({ b, chapterId, edit, fileUrl, copy }: { b: BrandBlock; chapterId: string; edit?: EditApi; fileUrl: (f: BrandFile) => Promise<string>; copy: (label: string, v: string) => void }) {
  switch (b.type) {
    case 'text':
      return (
        <>
          {b.heading && <h3>{b.heading}</h3>}
          <Prose text={b.body} />
        </>
      )
    case 'columns':
      return (
        <div className="bl-cols" style={{ gridTemplateColumns: `repeat(${Math.min(b.items.length, 3)}, minmax(0, 1fr))` }}>
          {b.items.map((x, i) => (
            <div key={i} className="bl-col">
              <span className="bl-mono">{x.title}</span>
              <Prose text={x.body} />
            </div>
          ))}
        </div>
      )
    case 'rules':
      return (
        <>
          {b.heading && <h3>{b.heading}</h3>}
          <div className="bl-rules">
            <div className="do">
              <span className="bl-mono">Do</span>
              <ul>{b.dos.map((x, i) => <li key={i}><i>✓</i>{inline(x)}</li>)}</ul>
            </div>
            <div className="dont">
              <span className="bl-mono">Don’t</span>
              <ul>{b.donts.map((x, i) => <li key={i}><i>✕</i>{inline(x)}</li>)}</ul>
            </div>
          </div>
        </>
      )
    case 'colors':
      return (
        <>
          {b.heading && <h3>{b.heading}</h3>}
          {b.note && <p className="bl-note">{b.note}</p>}
          <div className="bl-swatches">
            {b.swatches.map((s) => {
              const hex = `#${s.hex.replace('#', '').toUpperCase()}`
              const rows: [string, string][] = [
                ['HEX', hex],
                ['RGB', s.rgb || rgbOf(s.hex)],
                ['CMYK', s.cmyk],
                ['PMS', s.pms]
              ]
              return (
                <div key={s.id} className="bl-swatch">
                  <button className="chip" style={{ background: hex, color: inkOn(s.hex) }} onClick={() => copy(hex, hex)} title="Copy HEX">
                    <b>{s.name}</b>
                    <span>{hex}</span>
                  </button>
                  <dl>
                    {rows.map(([k, v]) => (
                      <Fragment key={k}>
                        <dt>{k}</dt>
                        <dd>{v ? <button onClick={() => copy(`${k} ${v}`, v)} title={`Copy ${k}`}>{v}</button> : <span className="tbd">Not set yet</span>}</dd>
                      </Fragment>
                    ))}
                  </dl>
                </div>
              )
            })}
          </div>
        </>
      )
    case 'fonts':
      return (
        <>
          {b.heading && <h3>{b.heading}</h3>}
          <div className="bl-fonts">
            {b.fonts.map((f) => (
              <div key={f.id} className="bl-font">
                <div className={`sample ${f.style}`}>{f.style === 'mono' ? f.sample.toUpperCase() : f.sample}</div>
                <div className="meta">
                  <b>{f.name}</b>
                  <span>{f.role}</span>
                  <span className="bl-pill">{f.caseRule}</span>
                  {f.link && (
                    <a href={f.link} target="_blank" rel="noreferrer">
                      Get the font ↗
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )
    case 'table':
      return (
        <>
          {b.heading && <h3>{b.heading}</h3>}
          {b.note && <p className="bl-note">{b.note}</p>}
          <div className="bl-table-wrap">
            <table className="bl-table">
              <thead>
                <tr>{b.columns.map((c, i) => <th key={i}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {b.rows.map((r, i) => (
                  <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )
    case 'logos':
      return (
        <>
          {b.heading && <h3>{b.heading}</h3>}
          {b.note && <p className="bl-note">{b.note}</p>}
          <div className="bl-logos">
            {b.slots.map((s) => <LogoCard key={s.id} s={s} chapterId={chapterId} blockId={b.id} edit={edit} fileUrl={fileUrl} />)}
          </div>
        </>
      )
    case 'examples':
      return (
        <>
          {b.heading && <h3>{b.heading}</h3>}
          {b.note && <p className="bl-note">{b.note}</p>}
          <div className="bl-examples">
            {b.items.map((x) => <ExampleCard key={x.id} x={x} chapterId={chapterId} blockId={b.id} edit={edit} fileUrl={fileUrl} />)}
          </div>
        </>
      )
    case 'files':
      return (
        <>
          {b.heading && <h3>{b.heading}</h3>}
          {b.note && <p className="bl-note">{b.note}</p>}
          <div className="bl-files">
            {b.files.map((f) => (
              <div key={f.id} className="bl-file">
                <span className="ext">{extOf(f)}</span>
                <span className="name">{f.name}<small>{sizeOf(f.size)}</small></span>
                <DownloadButton f={f} fileUrl={fileUrl} label="Download" />
                {edit && <button className="bl-mini" onClick={() => edit.removeFile(chapterId, b.id, null, f.id)}>Remove</button>}
              </div>
            ))}
            {!b.files.length && !edit && <div className="bl-note">No files yet.</div>}
            {edit && <UploadButton multiple label="+ Add Files" onFiles={(files) => edit.upload(chapterId, b.id, null, files)} />}
          </div>
        </>
      )
  }
}

function useFileUrl(f: BrandFile | null | undefined, fileUrl: (f: BrandFile) => Promise<string>) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    setUrl('')
    if (!f) return
    let live = true
    fileUrl(f).then((u) => live && setUrl(u)).catch(() => {})
    return () => {
      live = false
    }
  }, [f, fileUrl])
  return url
}

function DownloadButton({ f, fileUrl, label }: { f: BrandFile; fileUrl: (f: BrandFile) => Promise<string>; label: string }) {
  const save = async () => {
    try {
      const url = await fileUrl(f)
      const a = document.createElement('a')
      a.href = url
      a.download = f.name
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (e) {
      window.alert((e as Error).message)
    }
  }
  return (
    <button className="bl-dl" onClick={save} title={`Download ${f.name}`}>
      {label}
    </button>
  )
}

function UploadButton({ label, onFiles, multiple, accept }: { label: string; onFiles: (f: File[]) => void; multiple?: boolean; accept?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <button className="bl-mini" onClick={() => ref.current?.click()}>{label}</button>
      <input
        ref={ref}
        type="file"
        hidden
        multiple={multiple}
        accept={accept}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (files.length) onFiles(files)
        }}
      />
    </>
  )
}

function LogoCard({ s, chapterId, blockId, edit, fileUrl }: { s: LogoSlot; chapterId: string; blockId: string; edit?: EditApi; fileUrl: (f: BrandFile) => Promise<string> }) {
  const preview = s.files.find((f) => /svg/i.test(f.contentType) || /\.svg$/i.test(f.name)) ?? s.files.find(isImage)
  const url = useFileUrl(preview, fileUrl)
  return (
    <div className="bl-logo">
      <div className={`stage ${s.bg}`}>
        {url ? <img src={url} alt={s.name} /> : <span className="none">{edit ? 'Upload the logo files' : 'Coming soon'}</span>}
      </div>
      <div className="info">
        <b>{s.name}</b>
        <span className="bl-mono sm">{s.bg === 'dark' ? 'On dark' : 'On light'}</span>
      </div>
      <div className="dls">
        {s.files.map((f) => (
          <span key={f.id} className="dl">
            <DownloadButton f={f} fileUrl={fileUrl} label={extOf(f)} />
            {edit && <button className="x" onClick={() => edit.removeFile(chapterId, blockId, s.id, f.id)} aria-label={`Remove ${f.name}`}>×</button>}
          </span>
        ))}
        {edit && <UploadButton multiple label="+ Files" onFiles={(files) => edit.upload(chapterId, blockId, s.id, files)} />}
      </div>
    </div>
  )
}

function ExampleCard({ x, chapterId, blockId, edit, fileUrl }: { x: Example; chapterId: string; blockId: string; edit?: EditApi; fileUrl: (f: BrandFile) => Promise<string> }) {
  const url = useFileUrl(x.file, fileUrl)
  return (
    <figure className={`bl-example ${x.good ? 'good' : 'bad'}`}>
      <div className="img">
        {url ? <img src={url} alt={`${x.good ? 'Proper' : 'Improper'} ${x.label}`} /> : <span className="none">{edit ? 'Add an example image' : 'Example coming soon'}</span>}
        {edit && (
          <span className="up">
            <UploadButton accept="image/*" label={x.file ? 'Replace' : '+ Image'} onFiles={(files) => edit.upload(chapterId, blockId, x.id, files.slice(0, 1))} />
          </span>
        )}
      </div>
      <figcaption>
        <span className={`verdict ${x.good ? 'good' : 'bad'}`}>{x.good ? '✓ Proper' : '✕ Improper'}</span> <b>{x.label}</b>
        {x.caption && <small>{x.caption}</small>}
      </figcaption>
    </figure>
  )
}
