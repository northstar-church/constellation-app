import { createContext, useContext, useEffect, useState } from 'react'
import { platformById, type PostMedia, type SocialAccount, type SocialPost } from '../data/social'
import { PlatformIcon } from './PlatformIcon'

/** Turns a post's media into an address the screen can load (stored files come through the signed-in connection). */
export const MediaContext = createContext<(m: PostMedia) => Promise<string>>(async (m) => m.url)

export function useMediaUrl(m: PostMedia): string {
  const resolve = useContext(MediaContext)
  const [src, setSrc] = useState(m.url.startsWith('/api/') ? '' : m.url)
  useEffect(() => {
    let live = true
    resolve(m)
      .then((u) => live && setSrc(u))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [m, resolve])
  return src
}

/** An image, or the video itself. Sample "videos" in the preview are poster images. */
export function MediaView({ m, cover = false }: { m: PostMedia; cover?: boolean }) {
  const src = useMediaUrl(m)
  const playable = m.kind === 'video' && !m.url.startsWith('data:image')
  return (
    <span className={`media-view ${cover ? 'cover' : ''}`}>
      {!src ? null : playable ? <video src={src} muted playsInline preload="metadata" controls={!cover} /> : <img src={src} alt={m.name} loading="lazy" />}
      {m.kind === 'video' && cover && <span className="media-play" aria-hidden="true">▶</span>}
    </span>
  )
}

const DEFAULT_NAME = 'NorthStar Church'

function Caption({ text, lines = 3 }: { text: string; lines?: number }) {
  const [open, setOpen] = useState(false)
  if (!text.trim()) return <span className="pv-caption muted">No caption yet</span>
  return (
    <span className={`pv-caption ${open ? 'open' : ''}`} style={{ WebkitLineClamp: open ? 'unset' : lines }} onClick={() => setOpen((o) => !o)} title={open ? undefined : 'Show the full caption'}>
      {text}
    </span>
  )
}

/** A rough likeness of the post on its platform: shape of the media, where the caption sits, what gets cut off. */
export function PostPreview({ post, account }: { post: Pick<SocialPost, 'platform' | 'caption' | 'title' | 'media'>; account?: SocialAccount }) {
  const ACCOUNT = account?.name ?? DEFAULT_NAME
  const handle = account?.handle ?? 'northstarchurch'
  const initials = ACCOUNT.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  const p = platformById(post.platform)
  const m = post.media[0]
  const media = (
    <div className="pv-media" style={{ aspectRatio: p.aspect === 'auto' ? undefined : p.aspect.replace('/', ' / ') }}>
      {m ? <MediaView m={m} cover /> : <span className="pv-nomedia">{p.needsMedia === 'optional' ? 'Text-only post' : p.needsMedia === 'video' ? 'Add a video' : 'Add an image or video'}</span>}
      {post.media.length > 1 && <span className="pv-count">1/{post.media.length}</span>}
    </div>
  )
  const head = (
    <div className="pv-head">
      <span className="pv-avatar">{initials}</span>
      <b>{post.platform === 'instagram' ? handle : ACCOUNT}</b>
      <PlatformIcon id={post.platform} size={18} title />
    </div>
  )

  if (post.platform === 'tiktok') {
    return (
      <div className="pv pv-tiktok">
        {media}
        <div className="pv-overlay">
          <b>@{handle}</b>
          <Caption text={post.caption} lines={2} />
        </div>
        <span className="pv-pf"><PlatformIcon id="tiktok" size={18} title /></span>
      </div>
    )
  }
  if (post.platform === 'youtube') {
    return (
      <div className="pv pv-youtube">
        {media}
        <div className="pv-yt">
          <span className="pv-avatar">{initials}</span>
          <div>
            <b className="pv-title">{post.title || 'Video title'}</b>
            <span className="muted-sm">{ACCOUNT}</span>
          </div>
          <PlatformIcon id="youtube" size={18} title />
        </div>
        <Caption text={post.caption} lines={2} />
      </div>
    )
  }
  if (post.platform === 'facebook') {
    return (
      <div className="pv pv-facebook">
        {head}
        <Caption text={post.caption} lines={4} />
        {m && media}
      </div>
    )
  }
  return (
    <div className="pv pv-instagram">
      {head}
      {media}
      <div className="pv-ig-caption">
        <b>{handle}</b>
        <Caption text={post.caption} lines={2} />
      </div>
    </div>
  )
}
