import { useCallback, useEffect, useRef, useState } from 'react'
import { IconClose, IconLink, IconPencil } from '../components/Icons'
import { bid, emptyBlock, type BrandBlock, type BrandDoc, type Chapter } from '../data/brand'
import { AddBlockPicker, BlockEditor, ChapterEditor } from './BlockEditor'
import { BrandGuide, type EditApi } from './BrandGuide'
import { BrandConflict, type BrandStore } from './brandStore'

type Dialog =
  | { kind: 'block'; chapterId: string; block: BrandBlock; isNew: boolean; index: number }
  | { kind: 'pick'; chapterId: string; index: number }
  | { kind: 'chapter'; chapter: Chapter; isNew: boolean }
  | { kind: 'share' }
  | null

export function BrandPage({ store, me, query }: { store: BrandStore; me: string; query: string }) {
  const [doc, setDoc] = useState<BrandDoc | null>(null)
  const [editing, setEditing] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const docRef = useRef<BrandDoc | null>(null)
  docRef.current = doc

  const reload = useCallback(() => {
    store
      .load()
      .then((d) => setDoc(d))
      .catch((e: Error) => setError(e.message))
  }, [store])
  useEffect(() => {
    reload()
    return store.subscribe(reload)
  }, [store, reload])

  /** Changes one chapter (stamping who changed it) and saves the whole guide */
  const apply = async (fn: (d: BrandDoc) => BrandDoc) => {
    const cur = docRef.current
    if (!cur) return
    const next = fn(structuredClone(cur))
    setDoc(next)
    setSaving(true)
    setError('')
    try {
      setDoc(await store.save(next))
    } catch (e) {
      if (e instanceof BrandConflict) setError('Someone else changed the guidelines at the same time. You’re now seeing their version; make your change again.')
      else setError((e as Error).message)
      reload()
    } finally {
      setSaving(false)
    }
  }
  const touch = (c: Chapter): Chapter => ({ ...c, updatedAt: new Date().toISOString(), updatedBy: me })
  const onChapter = (chapterId: string, fn: (c: Chapter) => Chapter) => apply((d) => ({ ...d, chapters: d.chapters.map((c) => (c.id === chapterId ? touch(fn(c)) : c)) }))
  const onBlock = (chapterId: string, blockId: string, fn: (b: BrandBlock) => BrandBlock) => onChapter(chapterId, (c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === blockId ? fn(b) : b)) }))

  const edit: EditApi = {
    editBlock: (chapterId, block) => setDialog({ kind: 'block', chapterId, block, isNew: false, index: 0 }),
    addBlock: (chapterId, index) => setDialog({ kind: 'pick', chapterId, index }),
    moveBlock: (chapterId, blockId, dir) =>
      onChapter(chapterId, (c) => {
        const i = c.blocks.findIndex((b) => b.id === blockId)
        const j = i + dir
        if (i < 0 || j < 0 || j >= c.blocks.length) return c
        const blocks = [...c.blocks]
        ;[blocks[i], blocks[j]] = [blocks[j], blocks[i]]
        return { ...c, blocks }
      }),
    removeBlock: (chapterId, blockId) => {
      if (window.confirm('Remove this from the guidelines?')) onChapter(chapterId, (c) => ({ ...c, blocks: c.blocks.filter((b) => b.id !== blockId) }))
    },
    editChapter: (chapter) => setDialog({ kind: 'chapter', chapter, isNew: false }),
    addChapter: () => setDialog({ kind: 'chapter', isNew: true, chapter: { id: bid(), title: '', intro: '', draft: true, blocks: [], updatedAt: new Date().toISOString(), updatedBy: me } }),
    async upload(chapterId, blockId, target, files) {
      setError('')
      try {
        const up = await Promise.all(files.map((f) => store.upload(f)))
        await onBlock(chapterId, blockId, (b) => {
          if (b.type === 'logos') return { ...b, slots: b.slots.map((s) => (s.id === target ? { ...s, files: [...s.files, ...up] } : s)) }
          if (b.type === 'examples') return { ...b, items: b.items.map((x) => (x.id === target ? { ...x, file: up[0] } : x)) }
          if (b.type === 'files') return { ...b, files: [...b.files, ...up] }
          return b
        })
      } catch (e) {
        setError((e as Error).message)
      }
    },
    removeFile: (chapterId, blockId, target, fileId) =>
      onBlock(chapterId, blockId, (b) => {
        if (b.type === 'logos') return { ...b, slots: b.slots.map((s) => (s.id === target ? { ...s, files: s.files.filter((f) => f.id !== fileId) } : s)) }
        if (b.type === 'files') return { ...b, files: b.files.filter((f) => f.id !== fileId) }
        return b
      })
  }

  const drafts = doc?.chapters.filter((c) => c.draft).length ?? 0

  return (
    <main className="main bl-main">
      <div className="page-head">
        <h1>Brand Library</h1>
        <span className="bl-sub">{saving ? 'Saving…' : drafts ? `${drafts} chapter${drafts === 1 ? '' : 's'} in progress` : 'All chapters live'}</span>
        <span className="spacer" style={{ flex: 1 }} />
        <button className={`pill ${editing ? 'on' : ''}`} onClick={() => setEditing((v) => !v)} aria-pressed={editing}>
          <IconPencil size={20} /> {editing ? 'Done Editing' : 'Edit Guidelines'}
        </button>
        <button className="pill" onClick={() => window.print()} title="Print, or choose “Save as PDF” in the print dialog">
          Print / PDF
        </button>
        {store.link && (
          <button className="pill" onClick={() => setDialog({ kind: 'share' })}>
            <IconLink size={20} /> Share
          </button>
        )}
      </div>
      {store.mode === 'demo' && <div className="banner">Preview: started from your Illustrator draft. Changes and uploaded files are saved only in this browser.</div>}
      {error && <div className="banner warn">{error}</div>}

      <div className="bl-scroll">
        {!doc ? <div className="empty">Loading…</div> : <BrandGuide doc={doc} fileUrl={store.fileUrl} edit={editing ? edit : undefined} query={query} />}
      </div>

      {dialog?.kind === 'pick' && (
        <AddBlockPicker
          onClose={() => setDialog(null)}
          onPick={(t) => setDialog({ kind: 'block', chapterId: dialog.chapterId, block: emptyBlock(t), isNew: true, index: dialog.index })}
        />
      )}
      {dialog?.kind === 'block' && (
        <BlockEditor
          block={dialog.block}
          onClose={() => setDialog(null)}
          onSave={(b) => {
            const d = dialog
            setDialog(null)
            if (d.isNew) onChapter(d.chapterId, (c) => ({ ...c, blocks: [...c.blocks.slice(0, d.index), b, ...c.blocks.slice(d.index)] }))
            else onBlock(d.chapterId, b.id, () => b)
          }}
        />
      )}
      {dialog?.kind === 'chapter' && (
        <ChapterEditor
          chapter={dialog.chapter}
          isNew={dialog.isNew}
          onClose={() => setDialog(null)}
          onSave={(c) => {
            const isNew = dialog.isNew
            setDialog(null)
            if (isNew) apply((d) => ({ ...d, chapters: [...d.chapters, touch(c)] }))
            else onChapter(c.id, (old) => ({ ...old, title: c.title, intro: c.intro, draft: c.draft }))
          }}
          onDelete={() => {
            const id = dialog.chapter.id
            setDialog(null)
            apply((d) => ({ ...d, chapters: d.chapters.filter((c) => c.id !== id) }))
          }}
          onMove={(dir) =>
            apply((d) => {
              const i = d.chapters.findIndex((c) => c.id === dialog.chapter.id)
              const j = i + dir
              if (i < 0 || j < 0 || j >= d.chapters.length) return d
              const chapters = [...d.chapters]
              ;[chapters[i], chapters[j]] = [chapters[j], chapters[i]]
              return { ...d, chapters }
            })
          }
        />
      )}
      {dialog?.kind === 'share' && store.link && <ShareBrand store={store} onClose={() => setDialog(null)} />}
    </main>
  )
}

function ShareBrand({ store, onClose }: { store: BrandStore; onClose: () => void }) {
  const [link, setLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    store.link?.().then(setLink).catch((e: Error) => setError(e.message))
  }, [store])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Share the Brand Library">
        <div className="modal-head">
          <h2>Share The Brand Library</h2>
          <button className="round-btn" onClick={onClose} aria-label="Close"><IconClose size={20} /></button>
        </div>
        <div className="modal-body">
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            A read-only web page of the guidelines for the rest of staff (and vendors, if you like), with every logo and file ready to download. No sign-in needed.
            Chapters marked “In progress” stay hidden. Anyone with the link can see it.
          </p>
          <div className="feed">
            <div className="feed-top">
              <b>Staff link</b>
              <span className="spacer" />
              <button
                className="btn"
                disabled={!link}
                onClick={() =>
                  navigator.clipboard.writeText(link).then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1800)
                  })
                }
              >
                {copied ? 'Copied ✓' : 'Copy Link'}
              </button>
              <a className="btn" href={link || undefined} target="_blank" rel="noreferrer">Open</a>
              {confirm ? (
                <button className="btn danger" onClick={() => store.newLink?.().then((l) => (setLink(l), setConfirm(false))).catch((e: Error) => setError(e.message))}>Confirm New Link</button>
              ) : (
                <button className="btn" onClick={() => setConfirm(true)}>New Link</button>
              )}
            </div>
            {confirm && <div className="feed-meta">The current link stops working right away, so update anything that points to it.</div>}
            <input className="feed-url" readOnly value={link || 'Loading…'} onFocus={(e) => e.target.select()} />
          </div>
          {error && <div className="error">{error}</div>}
        </div>
      </div>
    </div>
  )
}
