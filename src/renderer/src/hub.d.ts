/** Provided by the Mac app (src/preload). Absent in a browser or the demo preview. */
interface HubBridge {
  isDesktop: true
  platform: string
  /** The team hub's address, or '' for a demo build */
  hubUrl: string
  api(method: string, path: string, body?: unknown): Promise<{ status: number; data?: unknown }>
  upload(path: string, bytes: ArrayBuffer, contentType: string): Promise<{ status: number; data?: unknown }>
  download(path: string): Promise<{ status: number; contentType?: string; bytes?: ArrayBuffer }>
  signIn(): Promise<boolean>
  signOut(): Promise<boolean>
  live(on: boolean): void
  onLive(cb: (message: string) => void): () => void
  onLiveStatus(cb: (connected: boolean) => void): () => void
  /** This app's version, e.g. 0.1.1 */
  version: string
  /** The downloaded version waiting to install, if any */
  updateReady(): string | null
  onUpdateReady(cb: (version: string) => void): () => void
  installUpdate(): Promise<void>
  /** Unread count on the Dock icon (0 clears it). Missing in app versions before 0.1.16. */
  setBadge?(count: number): void
  /** Brings the app to the front (clicking a Mac notification banner) */
  focus?(): void
}

interface Window {
  hub?: HubBridge
}
