import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { clock, frameOf, timecode, type ReviewVersion } from '../data/review'

export type TimeFormat = 'timecode' | 'frames' | 'clock'
export const formatTime = (t: number, fps: number, f: TimeFormat) => (f === 'timecode' ? timecode(t, fps) : f === 'frames' ? `${frameOf(t, fps)}` : clock(t))

export interface Marker {
  id: string
  t: number
  tEnd: number | null
  initials: string
  color: string
  active: boolean
  resolved: boolean
  title: string
}

export interface PlayerHandle {
  seek(t: number): void
  pause(): void
  play(): void
  toggle(): void
  step(frames: number): void
  nudge(seconds: number): void
  faster(): void
  readonly time: number
  readonly playing: boolean
}

interface Side {
  version: ReviewVersion
  src: string
  /** Drawn over the picture (left side only) */
  overlay?: ReactNode
  label?: ReactNode
}

interface Props {
  main: Side
  compare?: Side | null
  markers: Marker[]
  /** In/out points for a range comment */
  range: [number, number] | null
  timeFormat: TimeFormat
  onTimeFormat: (f: TimeFormat) => void
  zoom: 'fit' | 1 | 2
  onZoom: (z: 'fit' | 1 | 2) => void
  onTime: (t: number) => void
  onPlaying: (p: boolean) => void
  onMarker: (id: string) => void
  thumbAt: (t: number) => string | null
}

const RATES = [0.5, 1, 1.5, 2]

/** Plays a file or an HLS stream (Cloudflare Stream) in a <video>. Chromium needs hls.js for HLS. */
function useSource(el: React.RefObject<HTMLVideoElement>, src: string | null) {
  useEffect(() => {
    const v = el.current
    if (!v || !src) return
    if (!/\.m3u8(\?|$)/.test(src) || v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = src
      return
    }
    let dead = false
    let hls: { destroy(): void } | null = null
    void import('./vendor/hls.light.mjs').then(({ default: Hls }) => {
      if (dead) return
      const h = new Hls({ maxBufferLength: 30, startLevel: -1 })
      h.loadSource(src)
      h.attachMedia(v)
      hls = h
    })
    return () => {
      dead = true
      hls?.destroy()
      v.removeAttribute('src')
    }
  }, [el, src])
}

/** Keeps a picture box at the media's shape, as large as the stage allows (or at a zoom). */
function useBox(stage: React.RefObject<HTMLDivElement>, aspect: number, zoom: 'fit' | 1 | 2, natural: number, panes: number) {
  const [size, setSize] = useState({ w: 640, h: 360 })
  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const fit = () => {
      const W = (el.clientWidth - 24 * panes) / panes
      const H = el.clientHeight - 24
      if (zoom !== 'fit' && natural) {
        const w = natural * zoom
        setSize({ w, h: w / aspect })
        return
      }
      const w = Math.max(80, Math.min(W, H * aspect))
      setSize({ w, h: w / aspect })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [stage, aspect, zoom, natural, panes])
  return size
}

/** Video/image player with frame stepping, a comment-marker timeline, hover previews and side-by-side compare. */
export const Player = forwardRef<PlayerHandle, Props>(function Player({ main, compare, markers, range, timeFormat, onTimeFormat, zoom, onZoom, onTime, onPlaying, onMarker, thumbAt }, ref) {
  const v = main.version
  const isVideo = v.kind === 'video'
  const fps = v.fps || 30
  const aspect = v.width && v.height ? v.width / v.height : 16 / 9
  const stage = useRef<HTMLDivElement>(null)
  const a = useRef<HTMLVideoElement>(null)
  const b = useRef<HTMLVideoElement>(null)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(v.duration || 0)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [loop, setLoop] = useState(false)
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null)
  const [hoverImg, setHoverImg] = useState('')
  const box = useBox(stage, aspect, zoom, v.width, compare ? 2 : 1)
  const tRef = useRef(0)
  const playingRef = useRef(false)
  const dragging = useRef(false)

  useSource(a, isVideo ? main.src : null)
  useSource(b, compare && compare.version.kind === 'video' ? compare.src : null)
  // The hover preview only needs its own copy of the video when Stream's thumbnails aren't available
  const ghostSrc = isVideo && !thumbAt(0) ? main.src : null
  const ghost = useRef<HTMLVideoElement>(null)
  useSource(ghost, ghostSrc)

  const report = useCallback(
    (x: number) => {
      tRef.current = x
      setT(x)
      onTime(x)
    },
    [onTime]
  )

  // Precise time while playing: once per painted frame
  useEffect(() => {
    const el = a.current
    if (!el || !isVideo) return
    let id = 0
    const vfc = (el as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, m: { mediaTime: number }) => void) => number }).requestVideoFrameCallback
    if (!vfc) return
    const tick = (_: number, m: { mediaTime: number }) => {
      report(m.mediaTime)
      id = vfc.call(el, tick)
    }
    id = vfc.call(el, tick)
    return () => (el as HTMLVideoElement & { cancelVideoFrameCallback?: (id: number) => void }).cancelVideoFrameCallback?.(id)
  }, [main.src, isVideo, report])

  const both = (fn: (el: HTMLVideoElement) => void) => {
    if (a.current) fn(a.current)
    if (b.current) fn(b.current)
  }
  const seek = (x: number) => {
    const clamped = Math.max(0, Math.min(dur || x, x))
    both((el) => (el.currentTime = clamped))
    report(clamped)
  }
  const play = () => {
    if (!isVideo) return
    // At the end, start over
    if (a.current && dur && a.current.currentTime >= dur - 0.05) seek(range ? range[0] : 0)
    both((el) => void el.play().catch(() => {}))
  }
  const pause = () => both((el) => el.pause())

  useImperativeHandle(ref, () => ({
    seek,
    pause,
    play,
    toggle: () => (playingRef.current ? pause() : play()),
    step: (n: number) => {
      pause()
      const f = frameOf(tRef.current, fps) + n
      seek(f / fps + 0.0001)
    },
    nudge: (s: number) => seek(tRef.current + s),
    faster: () => {
      if (!playingRef.current) return play()
      const next = RATES[Math.min(RATES.length - 1, RATES.indexOf(rate) + 1)]
      setRate(next)
    },
    get time() {
      return tRef.current
    },
    get playing() {
      return playingRef.current
    }
  }))

  useEffect(() => both((el) => (el.playbackRate = rate)), [rate])
  useEffect(() => both((el) => ((el.muted = muted), (el.volume = volume))), [muted, volume])
  // The compare side only plays the sound of the main side
  useEffect(() => {
    if (b.current) b.current.muted = true
  })

  // Keep the compare side in step
  useEffect(() => {
    if (!compare || !a.current || !b.current) return
    const id = setInterval(() => {
      if (a.current && b.current && Math.abs(a.current.currentTime - b.current.currentTime) > 1.5 / fps) b.current.currentTime = a.current.currentTime
    }, 500)
    return () => clearInterval(id)
  }, [compare, fps])

  // Loop the in/out range (or the whole video)
  useEffect(() => {
    if (!playing) return
    if (range && loop && t >= range[1]) seek(range[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t])

  const scrubAt = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (dur || 0)
  }

  // Timeline hover preview: Stream's thumbnails when available, else a hidden copy of the video
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!hover || !isVideo) return
    const url = thumbAt(hover.t)
    if (url) return setHoverImg(url)
    const g = ghost.current
    if (!g) return
    const id = setTimeout(() => (g.currentTime = hover.t), 30)
    return () => clearTimeout(id)
  }, [hover?.t, isVideo, thumbAt])
  const drawGhost = () => {
    const g = ghost.current
    const c = canvas.current
    if (!g || !c) return
    c.width = 192
    c.height = Math.round(192 / aspect)
    c.getContext('2d')?.drawImage(g, 0, 0, c.width, c.height)
    try {
      setHoverImg(c.toDataURL('image/jpeg', 0.6))
    } catch {
      setHoverImg('')
    }
  }

  const pane = (side: Side, el: React.RefObject<HTMLVideoElement>, primary: boolean) => (
    <div className="rv-box" style={{ width: box.w, height: box.h }}>
      {side.version.kind === 'video' ? (
        <video
          ref={el}
          playsInline
          preload="auto"
          onLoadedMetadata={(e) => primary && setDur(e.currentTarget.duration || v.duration)}
          onPlay={() => primary && ((playingRef.current = true), setPlaying(true), onPlaying(true))}
          onPause={() => primary && ((playingRef.current = false), setPlaying(false), onPlaying(false))}
          onEnded={() => primary && loop && !range && play()}
          onSeeked={(e) => primary && report(e.currentTarget.currentTime)}
          onTimeUpdate={(e) => primary && !playingRef.current && report(e.currentTarget.currentTime)}
          onClick={() => primary && (playingRef.current ? pause() : play())}
        />
      ) : (
        <img src={side.src} alt={side.version.name} draggable={false} />
      )}
      {primary && side.overlay}
      {side.label && <span className="rv-side-label">{side.label}</span>}
    </div>
  )

  const pct = (x: number) => `${dur ? (x / dur) * 100 : 0}%`

  return (
    <div className="rv-player">
      <div ref={stage} className={`rv-stage ${zoom !== 'fit' ? 'zoomed' : ''}`}>
        <div className="rv-panes">
          {pane(main, a, true)}
          {compare && pane(compare, b, false)}
        </div>
      </div>

      {isVideo && (
        <div
          className="rv-timeline"
          onPointerDown={(e) => {
            dragging.current = true
            e.currentTarget.setPointerCapture(e.pointerId)
            seek(scrubAt(e.clientX, e.currentTarget))
          }}
          onPointerMove={(e) => {
            const tt = scrubAt(e.clientX, e.currentTarget)
            const r = e.currentTarget.getBoundingClientRect()
            setHover({ x: e.clientX - r.left, t: tt })
            if (dragging.current) seek(tt)
          }}
          onPointerUp={() => (dragging.current = false)}
          onPointerLeave={() => setHover(null)}
        >
          <div className="rv-track">
            <div className="rv-fill" style={{ width: pct(t) }} />
            {range && <div className="rv-range" style={{ left: pct(range[0]), width: `calc(${pct(range[1])} - ${pct(range[0])})` }} />}
            {markers
              .filter((m) => m.tEnd != null)
              .map((m) => (
                <div key={`r${m.id}`} className={`rv-mrange ${m.active ? 'active' : ''}`} style={{ left: pct(m.t), width: `calc(${pct(m.tEnd!)} - ${pct(m.t)})`, background: m.color }} />
              ))}
          </div>
          <div className="rv-head" style={{ left: pct(t) }} />
          {markers.map((m) => (
            <button
              key={m.id}
              className={`rv-marker ${m.active ? 'active' : ''} ${m.resolved ? 'resolved' : ''}`}
              style={{ left: pct(m.t), background: m.color }}
              title={m.title}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                onMarker(m.id)
              }}
            >
              {m.initials}
            </button>
          ))}
          {hover && (
            <div className="rv-hover" style={{ left: Math.max(60, Math.min(hover.x, (stage.current?.clientWidth ?? 600) - 60)) }}>
              {hoverImg && <img src={hoverImg} alt="" />}
              <span>{formatTime(hover.t, fps, timeFormat)}</span>
            </div>
          )}
          <video ref={ghost} muted preload="auto" className="rv-ghost" onSeeked={drawGhost} />
          <canvas ref={canvas} hidden />
        </div>
      )}

      <div className="rv-controls">
        {isVideo ? (
          <>
            <button className="rv-ctl" onClick={() => (playing ? pause() : play())} aria-label={playing ? 'Pause' : 'Play'} title="Play/Pause (Space)">
              {playing ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.8v14.4a1 1 0 0 0 1.5.86l11.6-7.2a1 1 0 0 0 0-1.72L8.5 3.94A1 1 0 0 0 7 4.8Z" /></svg>
              )}
            </button>
            <button className="rv-ctl" onClick={() => (pause(), seek((frameOf(tRef.current, fps) - 1) / fps + 0.0001))} title="Back one frame (←)" aria-label="Back one frame">
              ‹
            </button>
            <button className="rv-ctl" onClick={() => (pause(), seek((frameOf(tRef.current, fps) + 1) / fps + 0.0001))} title="Forward one frame (→)" aria-label="Forward one frame">
              ›
            </button>
            <button
              className="rv-tc"
              onClick={() => onTimeFormat(timeFormat === 'timecode' ? 'frames' : timeFormat === 'frames' ? 'clock' : 'timecode')}
              title="Switch between timecode, frames and minutes"
            >
              {formatTime(t, fps, timeFormat)} <span>/ {formatTime(dur, fps, timeFormat)}</span>
            </button>
            <span className="grow" />
            <button className={`rv-chip ${loop ? 'on' : ''}`} onClick={() => setLoop((l) => !l)} title={range ? 'Loop the in/out range' : 'Loop'}>
              Loop
            </button>
            <select className="rv-rate" value={rate} onChange={(e) => setRate(Number(e.target.value))} aria-label="Speed">
              {RATES.map((r) => (
                <option key={r} value={r}>
                  {r}×
                </option>
              ))}
            </select>
            <button className="rv-ctl" onClick={() => setMuted((m) => !m)} aria-label={muted ? 'Unmute' : 'Mute'} title="Mute">
              {muted || volume === 0 ? '🔇' : '🔊'}
            </button>
            <input className="rv-vol" type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={(e) => (setVolume(Number(e.target.value)), setMuted(false))} aria-label="Volume" />
          </>
        ) : (
          <span className="grow" />
        )}
        <select className="rv-rate" value={String(zoom)} onChange={(e) => onZoom(e.target.value === 'fit' ? 'fit' : (Number(e.target.value) as 1 | 2))} aria-label="Zoom">
          <option value="fit">Fit</option>
          <option value="1">100%</option>
          <option value="2">200%</option>
        </select>
        <button className="rv-ctl" onClick={() => void stage.current?.parentElement?.requestFullscreen?.()} aria-label="Full screen" title="Full screen (F)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
        </button>
      </div>
    </div>
  )
})
