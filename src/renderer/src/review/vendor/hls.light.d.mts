// hls.js 1.5.20 (light build, Apache-2.0, see HLS-LICENSE.txt): plays Cloudflare Stream's HLS in Chromium.
declare class Hls {
  static isSupported(): boolean
  static Events: { ERROR: string; MANIFEST_PARSED: string }
  constructor(config?: Record<string, unknown>)
  loadSource(src: string): void
  attachMedia(el: HTMLMediaElement): void
  destroy(): void
  on(event: string, cb: (event: string, data: { fatal?: boolean; type?: string; details?: string }) => void): void
}
export default Hls
