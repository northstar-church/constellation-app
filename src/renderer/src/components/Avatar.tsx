const PALETTE = [
  ['#dff6fc', '#00799a'],
  ['#fde5ef', '#cf3f7a'],
  ['#e3f6e5', '#3b934b'],
  ['#fdf3d2', '#9a7410'],
  ['#e3eefb', '#3a74b5'],
  ['#ffe9e0', '#c95a30']
]

function hash(s: string): number {
  let h = 0
  for (const ch of s.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Initials in a pastel circle. The color is stable per name. */
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const [bg, fg] = PALETTE[hash(name || '?') % PALETTE.length]
  return (
    <span className="avatar" title={name} style={{ width: size, height: size, background: bg, color: fg, fontSize: size * 0.38 }}>
      {initials(name)}
    </span>
  )
}

export function AvatarStack({ names, max = 3, size = 32 }: { names: string[]; max?: number; size?: number }) {
  const shown = names.slice(0, max)
  const extra = names.length - shown.length
  return (
    <span className="avatar-stack">
      {shown.map((n) => (
        <Avatar key={n} name={n} size={size} />
      ))}
      {extra > 0 && (
        <span className="avatar more-count" style={{ width: size, height: size, fontSize: size * 0.36 }}>
          +{extra}
        </span>
      )}
    </span>
  )
}
