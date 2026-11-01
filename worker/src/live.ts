import { DurableObject } from 'cloudflare:workers'

/**
 * One instance holds every open app window's WebSocket. After any change the API
 * calls broadcast(), and each window reloads the calendar. Uses hibernation, so idle
 * connections cost nothing.
 */
export class LiveHub extends DurableObject {
  async fetch(_req: Request): Promise<Response> {
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  async broadcast(message: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(message)
      } catch {
        /* socket already closed */
      }
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === 'ping') ws.send('pong')
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code)
    } catch {
      /* ignore */
    }
  }
}
