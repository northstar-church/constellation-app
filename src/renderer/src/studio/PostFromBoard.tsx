import { useEffect, useMemo, useState } from 'react'
import { IconClose } from '../components/Icons'
import type { SocialPost } from '../data/social'
import type { StudioBoard, StudioCard, StudioMedia, StudioSnapshot } from '../data/studio'
import type { SocialStore } from '../social/socialStore'
import type { StudioStore } from './studioStore'

interface Props {
  board: StudioBoard
  snap: StudioSnapshot
  studio: StudioStore
  social: SocialStore
  onClose: () => void
  onError: (msg: string) => void
  /** Opens the post composer with these values */
  onContinue: (seed: Partial<SocialPost>) => void
}

function Thumb({ media, store }: { media: StudioMedia; store: StudioStore }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    store.mediaUrl(media).then(setSrc).catch(() => {})
  }, [media, store])
  return src ? <img src={src} alt={media.name} /> : <span className="pfb-loading" />
}

const num = (c: StudioCard) => Number.parseFloat(c.data.number ?? '') || 0

/** The images on a board, in a sensible order: slides and shots by number, then loose images top-left to bottom-right. */
function imagesOn(cards: StudioCard[]): StudioCard[] {
  const withMedia = cards.filter((c) => (c.type === 'slide' || c.type === 'shot' || c.type === 'image') && c.data.media)
  const rank = (c: StudioCard) => (c.type === 'slide' ? 0 : c.type === 'shot' ? 1 : 2)
  return withMedia.sort((a, b) => rank(a) - rank(b) || num(a) - num(b) || a.y - b.y || a.x - b.x)
}

/** A carousel board's "Post caption:" note becomes the caption. */
function captionFrom(cards: StudioCard[]): string {
  const note = cards.find((c) => c.type === 'note' && /^\s*post caption:/i.test(c.data.text ?? ''))
  if (!note) return ''
  return (note.data.text ?? '')
    .replace(/(^|\n)\s*platform:.*$/is, '')
    .replace(/^\s*post caption:\s*/i, '')
    .trim()
}

/** Pick images from a board (in posting order) and a caption, then hand off to the post composer. */
export function PostFromBoard({ board, snap, studio, social, onClose, onError, onContinue }: Props) {
  const cards = useMemo(() => snap.cards.filter((c) => c.boardId === board.id), [snap, board.id])
  const images = useMemo(() => imagesOn(cards), [cards])
  // Slides start picked (a carousel); otherwise everything up to Instagram's 20
  const [picked, setPicked] = useState<string[]>(() => {
    const slides = images.filter((c) => c.type === 'slide')
    return (slides.length ? slides : images).slice(0, 20).map((c) => c.id)
  })
  const [caption, setCaption] = useState(() => captionFrom(cards))
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  async function go() {
    setBusy(true)
    try {
      const media = await social.mediaFromStudio(picked.map((id) => images.find((c) => c.id === id)!.data.media!))
      onContinue({ caption, media, boardId: board.id })
    } catch (e) {
      onError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal pfb" role="dialog" aria-label="Create post from board">
        <div className="modal-head">
          <h2>Create Post From “{board.title}”</h2>
          <button type="button" className="round-btn" onClick={onClose} aria-label="Close">
            <IconClose size={20} />
          </button>
        </div>
        <div className="modal-body">
          <div className="field">
            <span>
              Images <small className="muted-sm">Click to pick them in the order they should post. {picked.length} picked.</small>
            </span>
            {images.length ? (
              <div className="pfb-grid">
                {images.map((c) => {
                  const i = picked.indexOf(c.id)
                  return (
                    <button key={c.id} type="button" className={`pfb-img ${i >= 0 ? 'on' : ''}`} aria-pressed={i >= 0} onClick={() => toggle(c.id)} title={c.data.caption || c.data.action || c.data.media!.name}>
                      <Thumb media={c.data.media!} store={studio} />
                      {i >= 0 && <span className="pfb-n">{i + 1}</span>}
                      {c.type !== 'image' && <span className="pfb-tag">{c.type === 'slide' ? 'Slide' : 'Shot'} {c.data.number}</span>}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="empty sm">No images on this board yet. You can still start a text post, or add media in the post.</div>
            )}
          </div>
          <label className="field">
            <span>Caption</span>
            <textarea id="pfb-caption" rows={4} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Write the caption, or add it in the next step" />
          </label>
          <small className="muted-sm">Next you’ll pick the platforms, account and time. The post stays linked to this board.</small>
        </div>
        <div className="modal-foot">
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary sm" disabled={busy} onClick={go}>
            {busy ? 'Copying images…' : 'Continue To Post'}
          </button>
        </div>
      </div>
    </div>
  )
}
