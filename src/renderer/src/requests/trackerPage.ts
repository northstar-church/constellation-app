import { STAGES, fileSize, isImage, joinNames, stageById, stageIndex, type MediaRequest, type RequestEvent, type RequestFile } from '../data/requests'

/**
 * The requester's "pizza tracker": one self-contained page showing a single request.
 * Rendered by the backend at /track/<token>, and inside the app as a preview.
 * Only fields that are safe for the requester to see are used here.
 */

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const fmtDate = (ymd: string) =>
  new Date(`${ymd}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric' })
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })

const EMBLEM =
  'M966 0a966 966 0 1 0 0 1932A966 966 0 1 0 966 0ZM966 277 1135 660 966 700 796 660ZM380 639 966 772 1551 639 1305 977 1551 1316 1135 1271 966 1654 796 1271 380 1316 627 977Z'

const KIND_LABEL: Record<string, string> = {
  created: 'Request received',
  stage: 'Status update',
  note: 'Note from the Creative team',
  reply: 'You wrote',
  proof: 'Proof shared',
  final: 'Final files added',
  approved: 'You approved the proof',
  changes: 'You requested changes'
}

export interface TrackerOptions {
  /** false in the app's preview: buttons are shown but do nothing */
  interactive: boolean
  /** Shown after an approve / request-changes / message action */
  flash?: string
  /** Where file links point. Defaults to the tracker's own file route. */
  fileUrl?: (f: RequestFile, download?: boolean) => string
}

export function trackerPage(r: MediaRequest, history: RequestEvent[], opts: TrackerOptions, files: RequestFile[] = []): string {
  const fileUrl = opts.fileUrl ?? ((f: RequestFile, download?: boolean) => `${r.token}/files/${f.id}${download ? '?download=1' : ''}`)
  const proofs = files.filter((f) => f.kind === 'proof').sort((a, b) => b.at.localeCompare(a.at))
  const finals = files.filter((f) => f.kind === 'final')
  const fileList = (list: RequestFile[], download: boolean) =>
    list
      .map((f) =>
        isImage(f)
          ? `<a class="thumb" href="${esc(fileUrl(f, download))}" target="_blank" rel="noopener"><img src="${esc(fileUrl(f))}" alt="${esc(f.name)}" loading="lazy"><span>${esc(f.name)}</span></a>`
          : `<a class="file" href="${esc(fileUrl(f, download))}" target="_blank" rel="noopener"><span class="ext">${esc((f.name.split('.').pop() ?? 'file').slice(0, 4).toUpperCase())}</span><span>${esc(f.name)}<br><small>${fileSize(f.size)}</small></span></a>`
      )
      .join('')
  const i = stageIndex(r.stage)
  const s = stageById(r.stage)
  const people = r.assignees.map((a) => a.name)
  const teamMember = joinNames(people)
  const events = history
    .filter((e) => e.public)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 12)

  const steps = STAGES.map((st, n) => {
    const state = n < i ? 'done' : n === i ? 'now' : 'todo'
    return `<li class="step ${state}"><span class="dot">${n < i ? '✓' : n === i ? st.emoji : ''}</span><span class="lbl">${esc(st.label)}</span></li>`
  }).join('')

  const proof =
    r.stage === 'proof'
      ? `<section class="card proof">
          <h2>Your Proof Is Ready</h2>
          ${proofs.length ? `<div class="files">${fileList(proofs, false)}</div>` : ''}
          ${r.proofUrl ? `<a class="btn ghost" href="${esc(r.proofUrl)}" target="_blank" rel="noopener">${proofs.length ? 'Also View Online' : 'View The Proof'} ↗</a>` : ''}
          ${!proofs.length && !r.proofUrl ? '<p class="muted">The team will share the proof shortly.</p>' : ''}
          <form method="post" action="${esc(r.token)}/approve" class="row">
            <button class="btn primary" ${opts.interactive ? '' : 'disabled'}>Approve</button>
          </form>
          <form method="post" action="${esc(r.token)}/changes" class="changes">
            <label for="msg">Or tell us what to change</label>
            <textarea id="msg" name="message" rows="3" required maxlength="2000" placeholder="e.g. Can the date be larger? Use the blue logo."></textarea>
            <button class="btn" ${opts.interactive ? '' : 'disabled'}>Request Changes</button>
          </form>
        </section>`
      : ''

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(r.title)} · Request Tracker</title>
<style>
:root{--bg:#f4f4f5;--surface:#fff;--band:#e2e2da;--ink:#231f20;--muted:#71717a;--line:#e4e4e7;--accent:#00b7e2;--accent-soft:#dff6fc;--accent-ink:#00799a}
*{box-sizing:border-box}html,body{margin:0}
body{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:var(--bg);color:var(--ink);font-size:16px;-webkit-font-smoothing:antialiased}
b,h1,h2,.lbl,.btn{font-weight:700;letter-spacing:-1px;word-spacing:2px}
header{background:var(--band);padding:18px 20px;display:flex;align-items:center;gap:12px}
header .name{font-weight:700;letter-spacing:-1px;font-size:19px}header .sub{color:var(--ink);font-size:13px;margin-left:auto}
main{max-width:720px;margin:0 auto;padding:24px 16px 48px;display:grid;gap:16px}
.card{background:var(--surface);border-radius:22px;padding:24px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 6px 20px rgba(0,0,0,.05)}
.kicker{color:var(--muted);font-size:14px;margin:0 0 6px}
h1{font-size:30px;line-height:1.1;margin:0 0 6px}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}.tag{background:#eeeae2;color:#6b5a3e;border-radius:99px;padding:5px 12px;font-size:13px}
ol{list-style:none;margin:26px 0 8px;padding:0;display:grid;grid-template-columns:repeat(6,1fr);position:relative}
ol:before{content:'';position:absolute;top:21px;left:8%;right:8%;height:6px;border-radius:6px;background:var(--line)}
ol:after{content:'';position:absolute;top:21px;left:8%;height:6px;border-radius:6px;background:var(--accent);width:calc(84% * ${i} / ${STAGES.length - 1})}
.step{position:relative;z-index:1;display:grid;justify-items:center;gap:8px;text-align:center}
.dot{width:48px;height:48px;border-radius:50%;display:grid;place-items:center;background:var(--surface);border:3px solid var(--line);font-size:20px;color:#fff;font-weight:700}
.done .dot{background:var(--accent);border-color:var(--accent)}
.now .dot{border-color:var(--accent);box-shadow:0 0 0 6px var(--accent-soft);animation:pulse 2s ease-in-out infinite}
@keyframes pulse{50%{box-shadow:0 0 0 12px rgba(0,183,226,.12)}}
@media (prefers-reduced-motion:reduce){.now .dot{animation:none}}
.lbl{font-size:13px;color:var(--muted)}.now .lbl{color:var(--ink)}
.status h2{font-size:24px;margin:18px 0 4px}.status p{margin:0;color:var(--muted);line-height:1.5}
.note{margin-top:14px;background:var(--accent-soft);border-radius:14px;padding:14px 16px;line-height:1.5}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-top:4px}
.facts div{background:var(--bg);border-radius:14px;padding:12px 14px}.facts span{display:block;color:var(--muted);font-size:13px;margin-bottom:4px}
.proof{display:grid;gap:12px;border:2px solid var(--accent)}.proof h2{margin:0;font-size:22px}
.btn{display:inline-flex;align-items:center;justify-content:center;height:46px;padding:0 22px;border-radius:99px;border:0;background:#e9e9ec;color:var(--ink);font:inherit;font-weight:700;text-decoration:none;cursor:pointer}
.btn.primary{background:var(--accent);color:#fff}.btn.ghost{background:var(--accent-soft);color:var(--accent-ink);justify-self:start}
.btn[disabled]{opacity:.55;cursor:default}
.changes{display:grid;gap:8px}.msg-h{font-size:20px;margin:0}.send{justify-self:start}
.history li.mine div{background:var(--accent-soft);border-radius:12px;padding:10px 12px}.changes label{font-size:14px;color:var(--muted)}
textarea{font:inherit;border:0;background:var(--bg);border-radius:12px;padding:12px;width:100%;resize:vertical}
.flash{background:#e3f6e5;color:#2f7a3d;border-radius:14px;padding:12px 16px;font-weight:700;letter-spacing:-1px}
.history h2{font-size:18px;margin:0 0 10px}.history ul{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.history li{display:grid;grid-template-columns:110px 1fr;gap:12px;font-size:14.5px;line-height:1.45}.history time{color:var(--muted)}
.muted{color:var(--muted)}
.files{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
.thumb{display:grid;gap:6px;text-decoration:none;color:var(--ink);font-size:13px}.thumb img{width:100%;aspect-ratio:4/3;object-fit:contain;background:var(--bg);border-radius:14px;border:1px solid var(--line)}
.thumb span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.file{display:flex;gap:12px;align-items:center;background:var(--bg);border-radius:14px;padding:12px;text-decoration:none;color:var(--ink);font-size:14px;word-break:break-word}
.file .ext{flex-shrink:0;width:46px;height:46px;border-radius:12px;background:var(--accent-soft);color:var(--accent-ink);display:grid;place-items:center;font-weight:700;font-size:12px}.file small{color:var(--muted)}
footer{text-align:center;color:var(--muted);font-size:12.5px}
@media (max-width:520px){h1{font-size:24px}.dot{width:38px;height:38px;font-size:16px}ol:before,ol:after{top:16px}.lbl{font-size:12px;visibility:hidden;white-space:nowrap}.now .lbl{visibility:visible}.history li{grid-template-columns:1fr;gap:2px}.card{padding:18px}}
</style></head>
<body>
<header>
  <svg width="30" height="30" viewBox="0 0 1932 1932" aria-hidden="true"><path fill="#231f20" fill-rule="evenodd" d="${EMBLEM}"/></svg>
  <span class="name">Constellation</span><span class="sub">NorthStar Creative</span>
</header>
<main>
  ${opts.flash ? `<div class="flash" role="status">${esc(opts.flash)}</div>` : ''}
  <section class="card">
    <p class="kicker">Media request for ${esc(r.ministry || 'your ministry')}</p>
    <h1>${esc(r.title)}</h1>
    ${r.deliverables.length ? `<div class="tags">${r.deliverables.map((d) => `<span class="tag">${esc(d)}</span>`).join('')}</div>` : ''}
    <ol aria-label="Progress">${steps}</ol>
    <div class="status" aria-live="polite">
      <h2>${s.emoji} ${esc(s.label)}</h2>
      <p>${esc(s.blurb)}</p>
      ${r.publicNote ? `<div class="note"><b>From the Creative team:</b> ${esc(r.publicNote)}</div>` : ''}
    </div>
  </section>
  ${proof}
  ${
    r.stage === 'delivered' && finals.length
      ? `<section class="card proof"><h2>Your Finished Files</h2><p class="muted">Tap a file to download it.</p><div class="files">${fileList(finals, true)}</div></section>`
      : ''
  }
  <section class="card">
    <div class="facts">
      <div><span>Needed by</span><b>${r.dueDate ? esc(fmtDate(r.dueDate)) : 'Not set'}</b></div>
      ${r.eventDate ? `<div><span>Event date</span><b>${esc(fmtDate(r.eventDate))}</b></div>` : ''}
      <div><span>${people.length > 1 ? 'Team' : 'Team Member'}</span><b>${teamMember ? esc(teamMember) : 'Being assigned'}</b></div>
      <div><span>Submitted</span><b>${esc(fmtDate(r.createdAt.slice(0, 10)))}</b></div>
    </div>
  </section>
  ${`<section class="card">
    <form method="post" action="${esc(r.token)}/message" class="changes">
      <h2 class="msg-h">Message The Creative Team</h2>
      <label for="note">Questions, extra details or a change of plans: it goes straight to the team.</label>
      <textarea id="note" name="message" rows="3" required maxlength="2000" placeholder="Type your message"></textarea>
      <button class="btn primary send" ${opts.interactive ? '' : 'disabled'}>Send Message</button>
    </form>
  </section>`}
  ${
    events.length
      ? `<section class="card history"><h2>Updates</h2><ul>${events
          .map((e) => `<li class="${e.kind === 'reply' ? 'mine' : ''}"><time>${esc(fmtWhen(e.at))}</time><div><b>${esc(e.kind === 'stage' && e.stage ? stageById(e.stage).label : KIND_LABEL[e.kind] ?? 'Update')}</b>${e.message ? `<br>${esc(e.message)}` : ''}</div></li>`)
          .join('')}</ul></section>`
      : ''
  }
  <footer>This page updates on its own. Keep the link handy: anyone with it can see this request.</footer>
</main>
${
  opts.interactive
    ? `<script>setInterval(function(){var a=document.activeElement;if(document.hidden||(a&&a.tagName==='TEXTAREA'))return;location.replace(location.pathname)},45000)</script>`
    : ''
}
</body></html>`
}
