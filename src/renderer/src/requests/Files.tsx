import { useEffect, useRef, useState } from 'react'
import { IconClose, IconPlus } from '../components/Icons'
import { MAX_UPLOAD_BYTES, PROOF_TYPES, fileSize, isImage, type FileKind, type RequestFile } from '../data/requests'
import type { RequestStore } from './requestStore'

// Object URLs for files already fetched, so thumbnails don't reload on every render.
const urlCache = new Map<string, string>()

export async function blobUrl(store: RequestStore, f: RequestFile): Promise<string> {
  const hit = urlCache.get(f.id)
  if (hit) return hit
  const url = URL.createObjectURL(await store.fileBlob(f))
  urlCache.set(f.id, url)
  return url
}

export async function dataUrl(store: RequestStore, f: RequestFile): Promise<string> {
  const blob = await store.fileBlob(f)
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

const ext = (name: string) => (name.includes('.') ? name.split('.').pop()!.slice(0, 4).toUpperCase() : 'FILE')

function FileTile({ f, store, onRemove, onError }: { f: RequestFile; store: RequestStore; onRemove?: () => void; onError: (e: unknown) => void }) {
  const [src, setSrc] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)

  useEffect(() => {
    let live = true
    if (isImage(f)) blobUrl(store, f).then((u) => live && setSrc(u)).catch(() => {})
    return () => {
      live = false
    }
  }, [f, store])

  const save = async () => {
    try {
      const a = document.createElement('a')
      a.href = await blobUrl(store, f)
      a.download = f.name
      a.click()
    } catch (e) {
      onError(e)
    }
  }

  return (
    <div className="file-tile">
      <button className="file-preview" onClick={save} title={`Download ${f.name}`}>
        {src ? <img src={src} alt={f.name} /> : <span className="file-ext">{ext(f.name)}</span>}
      </button>
      <div className="file-meta">
        <span className="file-name" title={f.name}>
          {f.name}
        </span>
        <span className="muted-sm">
          {fileSize(f.size)} · {f.uploadedBy.split(' ')[0]}
        </span>
      </div>
      {!onRemove ? null : confirm ? (
        <button className="x" onClick={onRemove} title="Click again to delete" aria-label={`Confirm delete ${f.name}`} style={{ color: 'var(--danger)' }}>
          <IconClose size={16} />
        </button>
      ) : (
        <button className="x" onClick={() => setConfirm(true)} aria-label={`Delete ${f.name}`}>
          <IconClose size={16} />
        </button>
      )}
    </div>
  )
}

interface DropProps {
  requestId: string
  kind: FileKind
  files: RequestFile[]
  store: RequestStore
  onError: (e: unknown) => void
  hint: string
  /** List only: no upload zone, no delete */
  readOnly?: boolean
}

/** A file list plus a drop zone. Proofs accept images and PDFs; final artwork accepts anything. */
export function FileDrop({ requestId, kind, files, store, onError, hint, readOnly }: DropProps) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState<string[]>([])

  const send = async (list: FileList | File[]) => {
    for (const file of Array.from(list)) {
      if (file.size > MAX_UPLOAD_BYTES) {
        onError(new Error(`${file.name} is over ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB. Share a link to it instead.`))
        continue
      }
      if (kind === 'proof' && !PROOF_TYPES.includes(file.type)) {
        onError(new Error(`${file.name}: proofs can be JPG, PNG, GIF, WebP or PDF. Put other files under Final Artwork.`))
        continue
      }
      setBusy((b) => [...b, file.name])
      try {
        await store.upload(requestId, kind, file)
      } catch (e) {
        onError(e)
      }
      setBusy((b) => b.filter((n) => n !== file.name))
    }
  }

  const sorted = [...files].sort((a, b) => b.at.localeCompare(a.at))

  return (
    <div className="file-drop-wrap">
      {sorted.length > 0 && (
        <div className="file-grid">
          {sorted.map((f) => (
            <FileTile key={f.id} f={f} store={store} onError={onError} onRemove={readOnly ? undefined : () => store.removeFile(requestId, f.id).catch(onError)} />
          ))}
        </div>
      )}
      {!readOnly && <div
        className={`file-drop ${over ? 'over' : ''}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          if (e.dataTransfer.files.length) void send(e.dataTransfer.files)
        }}
      >
        <button type="button" className="btn" onClick={() => input.current?.click()}>
          <IconPlus size={16} /> Upload
        </button>
        <span className="muted-sm">{busy.length ? `Uploading ${busy.join(', ')}…` : hint}</span>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept={kind === 'proof' ? PROOF_TYPES.join(',') : undefined}
          onChange={(e) => {
            if (e.target.files?.length) void send(e.target.files)
            e.target.value = ''
          }}
        />
      </div>}
    </div>
  )
}
