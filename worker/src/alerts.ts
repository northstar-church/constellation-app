import { notifyPerson, type SlackEnv } from './slack'

/**
 * Health alerts by Slack DM, so problems don't go unnoticed:
 * server errors, failed background jobs, videos Stream couldn't process, rejected Typeform deliveries.
 * At most one DM per kind of problem per hour (repeats are counted into the next one), plus a short summary on Monday mornings.
 */

export interface AlertEnv extends SlackEnv {
  DB: D1Database
  /** Who gets the DMs */
  ALERT_EMAIL?: string
  PUBLIC_URL?: string
}

const HOUR = 3600_000
const LABEL: Record<string, string> = {
  'server-error': 'The server hit an error',
  cron: 'A background job failed',
  stream: 'A video couldn’t be processed',
  typeform: 'A Media Request from Typeform was turned away'
}

export async function alert(env: AlertEnv, key: string, detail: string): Promise<void> {
  try {
    const now = new Date().toISOString()
    const row = await env.DB.prepare(
      'INSERT INTO alerts (key, pending, week, last_text) VALUES (?, 1, 1, ?) ON CONFLICT(key) DO UPDATE SET pending = pending + 1, week = week + 1, last_text = excluded.last_text RETURNING last_sent, pending'
    )
      .bind(key, detail.slice(0, 500))
      .first<{ last_sent: string | null; pending: number }>()
    if (!row || (row.last_sent && Date.now() - Date.parse(row.last_sent) < HOUR)) return
    if (!env.ALERT_EMAIL || !env.SLACK_BOT_TOKEN) return
    const more = row.pending > 1 ? `\n_(${row.pending} times since the last alert)_` : ''
    const text = `:warning: *Constellation: ${LABEL[key] ?? key}*\n${detail.slice(0, 500)}${more}\n_Details are in Cloudflare → Workers & Pages → constellation → Logs. You’ll hear about this kind of problem at most once an hour._`
    if (await notifyPerson(env, env.ALERT_EMAIL, text)) await env.DB.prepare('UPDATE alerts SET last_sent = ?, pending = 0 WHERE key = ?').bind(now, key).run()
  } catch (e) {
    console.error('alert failed', e)
  }
}

/** Monday around 9am Eastern: a short "how things are" DM. Called from the 5-minute cron. */
export async function weeklySummary(env: AlertEnv, at: Date): Promise<void> {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hour12: false })
      .formatToParts(at)
      .map((p) => [p.type, p.value])
  )
  if (parts.weekday !== 'Mon' || Number(parts.hour) !== 9) return
  if (!env.ALERT_EMAIL || !env.SLACK_BOT_TOKEN) return
  const week = at.toISOString().slice(0, 10)
  const mark = await env.DB.prepare("SELECT last_sent FROM alerts WHERE key = '__summary'").first<{ last_sent: string | null }>()
  if (mark?.last_sent?.slice(0, 10) === week) return
  await env.DB.prepare("INSERT INTO alerts (key, last_sent) VALUES ('__summary', ?) ON CONFLICT(key) DO UPDATE SET last_sent = excluded.last_sent").bind(at.toISOString()).run()

  const since = new Date(at.getTime() - 7 * 86400_000).toISOString()
  const today = at.toISOString().slice(0, 10)
  const one = async (sql: string, ...b: unknown[]) => ((await env.DB.prepare(sql).bind(...b).first<{ n: number }>())?.n as number) ?? 0
  const received = await one('SELECT COUNT(*) AS n FROM requests WHERE created_at >= ?', since)
  const delivered = await one("SELECT COUNT(DISTINCT request_id) AS n FROM request_events WHERE kind = 'stage' AND stage = 'delivered' AND at >= ?", since)
  const pastDue = await one("SELECT COUNT(*) AS n FROM requests WHERE stage != 'delivered' AND due_date IS NOT NULL AND due_date < ?", today)
  const posted = await one("SELECT COUNT(*) AS n FROM social_posts WHERE status = 'posted' AND date >= ?", since.slice(0, 10))
  const { results } = await env.DB.prepare("SELECT key, week FROM alerts WHERE key != '__summary' AND week > 0").all<{ key: string; week: number }>()
  await env.DB.prepare("UPDATE alerts SET week = 0 WHERE key != '__summary'").run()
  const problems = (results ?? []).map((r) => `• ${LABEL[r.key] ?? r.key}: ${r.week}×`).join('\n')
  const text = [
    `:sunrise: *Constellation weekly check-in*`,
    problems ? `Problems this week:\n${problems}` : ':white_check_mark: No problems this week.',
    `Last 7 days: ${received} request${received === 1 ? '' : 's'} in, ${delivered} delivered, ${posted} post${posted === 1 ? '' : 's'} published.${pastDue ? ` ${pastDue} open request${pastDue === 1 ? ' is' : 's are'} past due.` : ''}`
  ].join('\n\n')
  await notifyPerson(env, env.ALERT_EMAIL, text)
}
