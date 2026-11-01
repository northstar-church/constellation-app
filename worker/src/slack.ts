import { STAGES, stageById, stageIndex, type MediaRequest } from '../../src/renderer/src/data/requests'

/**
 * Slack updates from the Constellation bot.
 *
 * Requester: the first message is a DM ("We got your request"), and every later update is
 * a reply in that message's thread, also shown in the DM itself so it notifies them. The
 * first message is edited to always show the current stage.
 * Team: new requests, approvals and change requests post to the creative channel.
 */

export interface SlackEnv {
  SLACK_BOT_TOKEN?: string
  SLACK_TEAM_CHANNEL?: string
  /** Verifies that replies posted to /hooks/slack really come from Slack. */
  SLACK_SIGNING_SECRET?: string
  /** Testing only: point at a fake Slack API. */
  SLACK_API_BASE?: string
}

interface SlackResult {
  ok: boolean
  error?: string
  channel?: string | { id: string }
  ts?: string
  user?: { id: string }
}

export async function slack(env: SlackEnv, method: string, body: Record<string, unknown>): Promise<SlackResult> {
  const base = env.SLACK_API_BASE || 'https://slack.com/api'
  const res = await fetch(`${base}/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  })
  const data = (await res.json().catch(() => ({ ok: false, error: `http_${res.status}` }))) as SlackResult
  if (!data.ok) console.warn(`Slack ${method} failed: ${data.error}`)
  return data
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const firstName = (name: string) => name.trim().split(/\s+/)[0] || 'there'

export function progressBar(r: MediaRequest): string {
  const i = stageIndex(r.stage)
  return STAGES.map((_, n) => (n <= i ? '🟦' : '⬜')).join('') + `  ${stageById(r.stage).label} (${i + 1} of ${STAGES.length})`
}

function blocks(text: string, r: MediaRequest, trackerUrl: string) {
  return [
    { type: 'section', text: { type: 'mrkdwn', text } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: progressBar(r) }] },
    {
      type: 'actions',
      elements: [{ type: 'button', text: { type: 'plain_text', text: 'Track your request' }, url: trackerUrl, style: 'primary' }]
    }
  ]
}

export interface Delivered {
  channel: string
  ts: string
}

/** Opens (or reuses) a DM with the requester. Returns null when they can't be found in Slack. */
async function dmChannel(env: SlackEnv, email: string): Promise<string | null> {
  if (!email) return null
  const base = env.SLACK_API_BASE || 'https://slack.com/api'
  const res = await fetch(`${base}/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
    headers: { authorization: `Bearer ${env.SLACK_BOT_TOKEN}` }
  })
  const found = (await res.json().catch(() => ({ ok: false }))) as SlackResult
  if (!found.ok || !found.user) return null
  const open = await slack(env, 'conversations.open', { users: found.user.id })
  const ch = open.channel
  return open.ok && ch ? (typeof ch === 'string' ? ch : ch.id) : null
}

/** First message to the requester. */
export async function notifyReceived(env: SlackEnv, r: MediaRequest, trackerUrl: string): Promise<Delivered | 'not_found' | null> {
  if (!env.SLACK_BOT_TOKEN) return null
  const channel = await dmChannel(env, r.requesterEmail)
  if (!channel) return 'not_found'
  const text = `Hi ${esc(firstName(r.requesterName))}, the Creative team got your media request: *${esc(r.title)}*.\nWe’ll message you here as it moves along.`
  const res = await slack(env, 'chat.postMessage', { channel, text: `We got your request: ${r.title}`, blocks: blocks(text, r, trackerUrl), unfurl_links: false })
  return res.ok && res.ts ? { channel, ts: res.ts } : null
}

/** Every later update: threaded under the first message and shown in the DM. */
export async function notifyUpdate(env: SlackEnv, r: MediaRequest, thread: Delivered, headline: string, note: string, trackerUrl: string): Promise<void> {
  if (!env.SLACK_BOT_TOKEN) return
  const s = stageById(r.stage)
  let text = `${s.emoji} ${headline}\n${s.blurb}`
  if (r.stage === 'proof') text += r.proofUrl ? `\n<${r.proofUrl}|View the proof>, then approve it or request changes on your tracker.` : '\nOpen your tracker to see the proof, then approve it or request changes.'
  if (r.stage === 'delivered') text += '\nYour finished files are ready to download from your tracker.'
  if (note) text += `\n>${esc(note).replace(/\n/g, '\n>')}`
  await slack(env, 'chat.postMessage', {
    channel: thread.channel,
    thread_ts: thread.ts,
    reply_broadcast: true,
    text: `${r.title}: ${s.label}`,
    blocks: blocks(text, r, trackerUrl),
    unfurl_links: false
  })
  // Keep the first message showing where things stand.
  const intro = `Hi ${esc(firstName(r.requesterName))}, the Creative team got your media request: *${esc(r.title)}*.\nUpdates are in the thread below.`
  await slack(env, 'chat.update', { channel: thread.channel, ts: thread.ts, text: `${r.title}: ${s.label}`, blocks: blocks(intro, r, trackerUrl) })
}

/** Posts to the creative team's channel. */
export async function notifyTeam(env: SlackEnv, text: string): Promise<void> {
  if (!env.SLACK_BOT_TOKEN || !env.SLACK_TEAM_CHANNEL) return
  await slack(env, 'chat.postMessage', { channel: env.SLACK_TEAM_CHANNEL, text, unfurl_links: false })
}

/** A direct message to a team member (comment and assignment notifications). */
export async function notifyPerson(env: SlackEnv, email: string, text: string): Promise<boolean> {
  if (!env.SLACK_BOT_TOKEN || !email) return false
  const channel = await dmChannel(env, email)
  if (!channel) return false
  const res = await slack(env, 'chat.postMessage', { channel, text, unfurl_links: false })
  return res.ok
}
