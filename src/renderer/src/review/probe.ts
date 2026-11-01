import type { VersionKind } from '../data/review'

export interface Probed {
  kind: VersionKind
  duration: number
  width: number
  height: number
  /** A small JPEG of an early frame (data URL), or '' when the app can't read the file */
  thumb: string
  /** false when this computer can't play it (e.g. ProRes) — it can still be uploaded */
  playable: boolean
}

const snap = (el: CanvasImageSource, w: number, h: number) => {
  const scale = Math.min(1, 480 / Math.max(w, h))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * scale))
  c.height = Math.max(1, Math.round(h * scale))
  c.getContext('2d')!.drawImage(el, 0, 0, c.width, c.height)
  try {
    return c.toDataURL('image/jpeg', 0.7)
  } catch {
    return ''
  }
}

/** Reads what the review needs from a file before it uploads: size, length and a poster frame. */
export function probeFile(file: File): Promise<Probed> {
  const url = URL.createObjectURL(file)
  if (file.type.startsWith('image/')) {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        resolve({ kind: 'image', duration: 0, width: img.naturalWidth, height: img.naturalHeight, thumb: snap(img, img.naturalWidth, img.naturalHeight), playable: true })
        URL.revokeObjectURL(url)
      }
      img.onerror = () => {
        resolve({ kind: 'image', duration: 0, width: 0, height: 0, thumb: '', playable: false })
        URL.revokeObjectURL(url)
      }
      img.src = url
    })
  }
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'auto'
    let done = false
    const finish = (p: Probed) => {
      if (done) return
      done = true
      clearTimeout(timer)
      URL.revokeObjectURL(url)
      resolve(p)
    }
    const timer = setTimeout(() => finish({ kind: 'video', duration: v.duration || 0, width: v.videoWidth, height: v.videoHeight, thumb: '', playable: false }), 8000)
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(1, (v.duration || 0) / 3)
    }
    v.onseeked = () => finish({ kind: 'video', duration: v.duration, width: v.videoWidth, height: v.videoHeight, thumb: snap(v, v.videoWidth, v.videoHeight), playable: true })
    v.onerror = () => finish({ kind: 'video', duration: 0, width: 0, height: 0, thumb: '', playable: false })
    v.src = url
  })
}
