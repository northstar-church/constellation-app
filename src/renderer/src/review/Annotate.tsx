import { useRef, useState } from 'react'
import type { Stroke } from '../data/review'

export type DrawTool = Stroke['tool']

interface Props {
  /** width / height of the picture */
  aspect: number
  /** Marks to show (a selected comment's, plus the one being drawn) */
  strokes: Stroke[]
  pins: { at: [number, number]; label: string; active?: boolean; onClick?: () => void }[]
  /** 'draw': drag to draw; 'pin': click to drop a pin; 'view': just shows marks */
  mode: 'view' | 'draw' | 'pin'
  tool: DrawTool
  color: string
  onStroke?: (s: Stroke) => void
  onPin?: (at: [number, number]) => void
}

const W = 1000

function Mark({ s, H }: { s: Stroke; H: number }) {
  const pts = s.points.map(([x, y]) => [x * W, y * H] as const)
  const sw = 5
  const common = { stroke: s.color, strokeWidth: sw, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (s.tool === 'pen') return <polyline points={pts.map((p) => p.join(',')).join(' ')} {...common} />
  if (pts.length < 2) return null
  const [[x1, y1], [x2, y2]] = [pts[0], pts[pts.length - 1]]
  if (s.tool === 'rect') return <rect x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)} rx={6} {...common} />
  if (s.tool === 'ellipse') return <ellipse cx={(x1 + x2) / 2} cy={(y1 + y2) / 2} rx={Math.abs(x2 - x1) / 2} ry={Math.abs(y2 - y1) / 2} {...common} />
  // arrow: line plus a head at the end
  const ang = Math.atan2(y2 - y1, x2 - x1)
  const len = 26
  const h1 = [x2 - len * Math.cos(ang - 0.45), y2 - len * Math.sin(ang - 0.45)]
  const h2 = [x2 - len * Math.cos(ang + 0.45), y2 - len * Math.sin(ang + 0.45)]
  return (
    <g {...common}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <polyline points={`${h1.join(',')} ${x2},${y2} ${h2.join(',')}`} />
    </g>
  )
}

/** The see-through layer over the video/image where marks are drawn and pins dropped. */
export function Annotate({ aspect, strokes, pins, mode, tool, color, onStroke, onPin }: Props) {
  const H = W / (aspect || 16 / 9)
  const ref = useRef<SVGSVGElement>(null)
  const [live, setLive] = useState<Stroke | null>(null)

  const at = (e: React.PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect()
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]
  }

  return (
    <svg
      ref={ref}
      className={`annotate mode-${mode}`}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      onPointerDown={(e) => {
        if (mode === 'pin') {
          onPin?.(at(e))
          return
        }
        if (mode !== 'draw') return
        e.currentTarget.setPointerCapture(e.pointerId)
        const p = at(e)
        setLive({ tool, color, points: [p, p] })
      }}
      onPointerMove={(e) => {
        if (!live) return
        const p = at(e)
        setLive((s) => (s ? { ...s, points: s.tool === 'pen' ? [...s.points, p] : [s.points[0], p] } : s))
      }}
      onPointerUp={() => {
        if (!live) return
        const [a, b] = [live.points[0], live.points[live.points.length - 1]]
        // A click without a drag isn't a mark
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.01 || (live.tool === 'pen' && live.points.length > 3)) onStroke?.(live)
        setLive(null)
      }}
    >
      {strokes.map((s, i) => (
        <Mark key={i} s={s} H={H} />
      ))}
      {live && <Mark s={live} H={H} />}
      {pins.map((p, i) => (
        <g
          key={i}
          className={`pin ${p.active ? 'active' : ''}`}
          transform={`translate(${p.at[0] * W} ${p.at[1] * H})`}
          onPointerDown={(e) => {
            if (!p.onClick) return
            e.stopPropagation()
            p.onClick()
          }}
        >
          <circle r={26} />
          <text textAnchor="middle" dy="8.5">
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  )
}
