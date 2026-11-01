/**
 * Turns a Typeform submission into a media request.
 *
 * Typeform signs every webhook with the secret you set on the webhook; we check that
 * signature before trusting anything. Answers are matched to request fields by the
 * field refs in TYPEFORM_FIELDS when set, otherwise by question wording. Any answer that
 * isn't matched is kept in the request's details, so nothing a leader typed is lost.
 */

export interface IntakeRequest {
  sourceId: string
  title: string
  details: string
  deliverables: string[]
  ministry: string
  requesterName: string
  requesterEmail: string
  dueDate: string | null
  eventDate: string | null
  /** Files the requester uploaded on the form (Typeform-hosted; fetched with an API token) */
  attachments: string[]
}

type FieldKey =
  | 'title'
  | 'details'
  | 'deliverables'
  | 'ministry'
  | 'requesterName'
  | 'requesterEmail'
  | 'dueDate'
  | 'eventDate'
  | 'assetsLink'
  | 'attachments'

interface TfField {
  id: string
  ref?: string
  title?: string
  type?: string
}
interface TfAnswer {
  type: string
  field: { id: string; ref?: string; type?: string }
  text?: string
  email?: string
  date?: string
  url?: string
  file_url?: string
  number?: number
  boolean?: boolean
  phone_number?: string
  choice?: { label?: string; other?: string }
  choices?: { labels?: string[]; other?: string }
}
interface TfPayload {
  event_type?: string
  form_response?: {
    token: string
    submitted_at?: string
    definition?: { fields?: TfField[] }
    answers?: TfAnswer[]
    hidden?: Record<string, string>
  }
}

const enc = new TextEncoder()

/** Checks the `Typeform-Signature: sha256=<base64 hmac>` header against the raw body. */
export async function verifyTypeform(rawBody: string, header: string | null, secret: string): Promise<boolean> {
  if (!header?.startsWith('sha256=') || !secret) return false
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(rawBody)))
  const expected = 'sha256=' + btoa(String.fromCharCode(...mac))
  if (expected.length !== header.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i)
  return diff === 0
}

function answerValue(a: TfAnswer): string | string[] {
  if (a.choices) return [...(a.choices.labels ?? []), ...(a.choices.other ? [a.choices.other] : [])]
  if (a.choice) return a.choice.label ?? a.choice.other ?? ''
  if (a.email) return a.email
  if (a.date) return a.date.slice(0, 10)
  if (a.file_url) return a.file_url
  if (a.url) return a.url
  if (a.phone_number) return a.phone_number
  if (typeof a.number === 'number') return String(a.number)
  if (typeof a.boolean === 'boolean') return a.boolean ? 'Yes' : 'No'
  return a.text ?? ''
}

/** Best guess at which request field a question feeds, from its wording and type. */
function guess(title: string, type: string): FieldKey | null {
  const t = title.toLowerCase()
  if (type === 'file_upload') return 'attachments'
  if (type === 'email' || /e-?mail/.test(t)) return 'requesterEmail'
  if (type === 'date' && /\b(used|event|happen)/.test(t)) return 'eventDate'
  if (type === 'date' || /\b(due|deadline|needed by|need (it|this) by|date needed)\b/.test(t)) return 'dueDate'
  if (/ministry|department|team/.test(t)) return 'ministry'
  if (/request type|media type|(what|which).*(need|deliverable|type|kind)|deliverable|type of (media|request)|services?/.test(t)) return 'deliverables'
  if (/(event|project|request).*(name|title)|^title|name of (the )?(event|project)/.test(t)) return 'title'
  if (/your name|^name|first.*last|full name|requester|who is (making|submitting)/.test(t)) return 'requesterName'
  if (/link|mood ?board|assets?/.test(t)) return 'assetsLink'
  return null
}


export function mapTypeform(payload: unknown, refMap: Partial<Record<FieldKey, string>> = {}): IntakeRequest | null {
  const fr = (payload as TfPayload)?.form_response
  if (!fr?.token) return null
  const fields = new Map((fr.definition?.fields ?? []).map((f) => [f.id, f]))
  const byRef = new Map(Object.entries(refMap).map(([k, ref]) => [ref, k as FieldKey]))

  const out: IntakeRequest = {
    sourceId: fr.token,
    title: '',
    details: '',
    deliverables: [],
    ministry: '',
    requesterName: '',
    requesterEmail: '',
    dueDate: null,
    eventDate: null,
    attachments: []
  }
  let eventDate = ''
  let assets = ''
  const extra: string[] = []
  const detailParts: string[] = []

  for (const a of fr.answers ?? []) {
    const def = fields.get(a.field.id)
    const qTitle = (def?.title ?? a.field.ref ?? 'Answer').replace(/\s+/g, ' ').trim()
    const value = answerValue(a)
    const text = Array.isArray(value) ? value.join(', ') : value
    if (!text) continue
    const ref = a.field.ref ?? def?.ref
    const key = (ref && byRef.get(ref)) || guess(qTitle, a.type === 'file_url' ? 'file_upload' : a.type || def?.type || '')

    switch (key) {
      case 'deliverables':
        if (!out.deliverables.length) out.deliverables = Array.isArray(value) ? value : value.split(/\s*,\s*/)
        else extra.push(`${qTitle}: ${text}`)
        break
      case 'dueDate':
        if (!out.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(text)) out.dueDate = text
        else extra.push(`${qTitle}: ${text}`)
        break
      case 'eventDate':
        if (/^\d{4}-\d{2}-\d{2}$/.test(text)) out.eventDate = text
        else eventDate = text // not a date: keep their wording in the details
        break
      case 'assetsLink':
        if (!/^(n\/?a|none|no|-)$/i.test(text.trim())) assets = text
        break
      case 'attachments':
        if (a.file_url) out.attachments.push(a.file_url)
        break
      case 'details':
        detailParts.push(text)
        break
      case 'title':
      case 'ministry':
      case 'requesterName':
      case 'requesterEmail':
        if (!out[key]) out[key] = text.slice(0, 300)
        else extra.push(`${qTitle}: ${text}`)
        break
      default:
        if (a.type === 'text' && def?.type === 'long_text') detailParts.push(text)
        else extra.push(`${qTitle}: ${text}`)
    }
  }

  // Hidden fields (e.g. ?email=…&name=… on the form link) fill gaps.
  const hidden = fr.hidden ?? {}
  out.requesterEmail ||= hidden.email ?? ''
  out.requesterName ||= hidden.name ?? ''

  out.requesterEmail = out.requesterEmail.trim().toLowerCase()
  const head = [eventDate && `Used on / event date: ${eventDate}`, assets && `Assets / mood board: ${assets}`].filter(Boolean) as string[]
  out.details = [...head, ...(head.length && detailParts.length ? [''] : []), ...detailParts, ...(extra.length ? ['', ...extra] : [])]
    .join('\n')
    .trim()
    .slice(0, 8000)
  if (!out.title) out.title = out.ministry ? `${out.ministry} request` : 'New media request'
  return out
}
