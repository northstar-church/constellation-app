import { siFacebook, siInstagram, siTiktok, siYoutube } from 'simple-icons'
import { platformById, type PlatformId } from '../data/social'

// Brand marks come from Simple Icons (CC0), the standard open icon set for this.
const ICONS = { facebook: siFacebook, instagram: siInstagram, tiktok: siTiktok, youtube: siYoutube }

/** The platform's mark in white on a brand-colored disc, so it reads on any card color. */
export function PlatformIcon({ id, size = 20, title }: { id: PlatformId; size?: number; title?: boolean }) {
  const p = platformById(id)
  return (
    <span
      className={`pf-badge pf-${id}`}
      style={{ width: size, height: size, background: p.color }}
      role={title ? 'img' : undefined}
      aria-label={title ? p.label : undefined}
      aria-hidden={title ? undefined : true}
      title={title ? p.label : undefined}
    >
      <svg viewBox="0 0 24 24" width={Math.round(size * 0.58)} height={Math.round(size * 0.58)} aria-hidden="true">
        <path d={ICONS[id].path} fill="#fff" />
      </svg>
    </span>
  )
}
