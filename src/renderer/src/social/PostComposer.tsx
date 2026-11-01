import { format, formatDistanceToNow, parseISO } from 'date-fns'
import { tint } from '../data/tint'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { IconClose, IconCopy, IconPlus } from '../components/Icons'
import type { TeamMember } from '../data/requests'
import { canAutoPublish, charCount, PLATFORMS, platformById, POST_CATEGORIES, postProblems, postStatus, type PlatformId, type PostCategoryId, type PostMedia, type PostStatus, type SocialAccount, type SocialPost } from '../data/social'
import { PlatformIcon } from './PlatformIcon'
import { MediaView, PostPreview, useMediaUrl } from './PostPreview'
import type { AccountChoice, SocialStore } from './socialStore'

interface Props {
  /** An existing post, or the starting values for a new one */
  post: SocialPost | null
  /** Starting values for a new post (e.g. made from a Studio board) */
  seed?: Partial<SocialPost> | null
  initialDate?: string
  /** Connected accounts the app can publish to */
  accounts: SocialAccount[]
  /** The Studio board this post was planned on, if the viewer can see it */
  boardTitle?: string | null
  /** Opens (or makes) the post's board in Creative Studio */
  onPlanInStudio?: (post: SocialPost) => void
  /** Everyone but the social media director just looks */
  readOnly?: boolean
  campaigns: string[]
  team: TeamMember[]
  me: string
  /** The social media director: approves posts others submit */
  lead: TeamMember | undefined
  store: SocialStore
  onClose: () => void
  onError: (msg: string) => void
}

const first = (n: string) => n.split(' ')[0]

/** Saves the post's image or video to the computer, ready to upload to the platform. */
function SaveMedia({ m }: { m: PostMedia }) {
  const src = useMediaUrl(m)
  return (
    <a className="btn" href={src || undefined} download={m.name} aria-disabled={!src}>
      Save {m.kind === 'video' ? 'Video' : 'Image'}
    </a>
  )
}

export function PostComposer({ readOnly = false, post, seed, initialDate, accounts, boardTitle, onPlanInStudio, campaigns, team, me, lead, store, onClose, onError }: Props) {
  const isNew = !post
  const iAmLead = !!lead && lead.name === me
  const leadFirst = lead ? first(lead.name) : 'the social media director'
  const [platforms, setPlatforms] = useState<PlatformId[]>(post ? [post.platform] : ['instagram', 'facebook'])
  const [caption, setCaption] = useState(post?.caption ?? seed?.caption ?? '')
  const [title, setTitle] = useState(post?.title ?? '')
  const [media, setMedia] = useState<PostMedia[]>(post?.media ?? seed?.media ?? [])
  const accountsOn = (pf: PlatformId) => accounts.filter((a) => a.platform === pf)
  const [accountFor, setAccountFor] = useState<AccountChoice>(() => {
    if (post) return { [post.platform]: post.account }
    // Instagram has several accounts, so it's picked each time; the rest default to their only account
    const out: AccountChoice = {}
    for (const pf of PLATFORMS) {
      const list = accounts.filter((a) => a.platform === pf.id)
      out[pf.id] = pf.id === 'instagram' ? (list.length === 1 ? list[0].id : '') : (list[0]?.id ?? '')
    }
    return out
  })
  // Accounts can arrive after the composer opens: fill in the defaults then
  useEffect(() => {
    if (post || !accounts.length) return
    setAccountFor((cur) => {
      const out = { ...cur }
      for (const pf of PLATFORMS) {
        const list = accounts.filter((a) => a.platform === pf.id)
        if (!out[pf.id]) out[pf.id] = pf.id === 'instagram' ? (list.length === 1 ? list[0].id : '') : (list[0]?.id ?? '')
      }
      return out
    })
  }, [accounts, post])
  const connected = (pf: PlatformId) => canAutoPublish(pf) && accountsOn(pf).some((a) => a.connected)
  const [autoPublish, setAutoPublish] = useState(post ? post.autoPublish : true)
  const [publishing, setPublishing] = useState(false)
  const [manual, setManual] = useState(false)
  const [date, setDate] = useState(post?.date ?? initialDate ?? format(new Date(), 'yyyy-MM-dd'))
  const [time, setTime] = useState(post?.time ?? '09:00')
  const [campaign, setCampaign] = useState(post?.campaign ?? '')
  const [category, setCategory] = useState<PostCategoryId | ''>(post?.category ?? '')
  // The social media director posts everything
  const poster = lead?.name ?? post?.poster ?? me
  const [postUrl, setPostUrl] = useState(post?.postUrl ?? '')
  const [note, setNote] = useState('')
  const [sendingBack, setSendingBack] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [previewOn, setPreviewOn] = useState<PlatformId>(platforms[0])
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState(false)
  const [copied, setCopied] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!platforms.includes(previewOn) && platforms.length) setPreviewOn(platforms[0])
  }, [platforms, previewOn])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const status: PostStatus = post?.status ?? 'draft'
  const boardId = post?.boardId ?? seed?.boardId ?? ''
  const fields = { caption, title, media, date, time, campaign: campaign.trim(), category, poster, autoPublish, boardId }
  // Once accounts are connected, Instagram posts must say which account (there are several)
  const accountOf = (pf: PlatformId) => (accountsOn(pf).length ? (accountFor[pf] ?? '') : undefined)
  const autoOn = (pf: PlatformId) => autoPublish && connected(pf)
  // Problems that block review/scheduling, per selected platform
  const problems = useMemo(
    () =>
      platforms
        .flatMap((pf) => postProblems({ ...fields, platform: pf, account: accountOf(pf), autoPublish: autoOn(pf) }).map((msg) => ({ pf, msg })))
        .filter((x, i, a) => a.findIndex((y) => y.msg === x.msg) === i),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [platforms, caption, title, media, date, time, accountFor, autoPublish]
  )
  const postAuto = !!post && post.autoPublish && connected(post.platform)
  const failed = post?.publishState === 'failed'
  const dueNow = status === 'scheduled' && !!date && !!time && new Date(`${date}T${time}`) <= new Date(Date.now() + 15 * 60_000) && (!postAuto || manual)
  const account = post ? accounts.find((a) => a.id === post.account) : undefined
  const anyAuto = platforms.some(connected)
  const manualOnly = platforms.filter((pf) => !connected(pf))

  const togglePlatform = (id: PlatformId) => setPlatforms((ps) => (ps.includes(id) ? ps.filter((x) => x !== id) : [...ps, id]))

  async function addFiles(files: FileList | null) {
    if (!files) return
    try {
      const added: PostMedia[] = []
      for (const f of Array.from(files)) {
        if (!/^(image|video)\//.test(f.type)) throw new Error(`${f.name} isn’t an image or video.`)
        added.push(await store.addMedia(f))
      }
      setMedia((m) => [...m, ...added])
    } catch (e) {
      onError((e as Error).message)
    }
  }

  /** Save with a new status. `what` is logged in the post's activity. */
  async function save(next: PostStatus, what?: string, extra: Partial<SocialPost> = {}, logNote?: string) {
    const needsReady = next === 'review' || next === 'scheduled'
    if (needsReady && problems.length) {
      setTried(true)
      return
    }
    if (!platforms.length) return onError('Pick at least one platform.')
    setBusy(true)
    try {
      // Re-scheduling clears an earlier publishing failure so it's tried again
      if (next === 'scheduled') extra = { publishState: '', publishError: '', ...extra }
      if (isNew) {
        await store.create({ ...fields, status: next, ...extra }, platforms, what ?? 'created', accountFor)
      } else {
        // Changes to a scheduled post go back to the social media director unless she makes them.
        let st = next
        let w = what
        if (!what && status === 'scheduled' && !iAmLead && lead) {
          st = 'review'
          w = 'edited a scheduled post (back to review)'
        }
        await store.update(post.id, { ...fields, account: accountFor[post.platform] ?? post.account, status: st, ...extra }, w ?? (st === status ? undefined : `moved to ${postStatus(st).label}`), logNote)
      }
      onClose()
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function publishNow() {
    if (!post) return
    setPublishing(true)
    try {
      await store.publishNow(post.id)
      onClose()
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setPublishing(false)
    }
  }

  const copyCaption = async () => {
    const text = post?.platform === 'youtube' ? `${title}\n\n${caption}` : caption
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      onError('Couldn’t copy. Select the caption and copy it instead.')
    }
  }

  const headTitle = isNew ? 'New Post' : `${platformById(post.platform).label} Post`
  const st = postStatus(status)

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal composer" role="dialog" aria-label={headTitle}>
        <div className="modal-head">
          {post && <PlatformIcon id={post.platform} size={34} title />}
          <h2>{headTitle}</h2>
          {post && (
            <span className="status-pill" style={tint(st.soft, st.ink)}>
              <span className="dot" style={{ background: st.dot }} /> {st.label}
            </span>
          )}
          <span className="grow" />
          {boardId && boardTitle !== undefined ? (
            boardTitle ? (
              <button type="button" className="board-chip" onClick={() => post && onPlanInStudio?.(post)} disabled={!post} title="Open the board in Creative Studio">
                <span className="board-glyph sm" /> {boardTitle}
              </button>
            ) : (
              <span className="board-chip muted" title="Planned on a board that’s private to someone else">
                <span className="board-glyph sm" /> Private board
              </span>
            )
          ) : post && onPlanInStudio && !readOnly ? (
            <button type="button" className="btn sm" onClick={() => onPlanInStudio(post)} title="Make a private board for this post in Creative Studio">
              Plan In Studio
            </button>
          ) : null}
          <button type="button" className="round-btn" onClick={onClose} aria-label="Close">
            <IconClose size={20} />
          </button>
        </div>

        <div className="composer-cols">
          <fieldset className="composer-form" disabled={readOnly}>
            {post?.status === 'review' && (
              <div className="review-box">
                {iAmLead ? (
                  <>
                    <b>{first(post.author)} submitted this for your review.</b>
                    {sendingBack ? (
                      <>
                        <label className="field">
                          <span>What should change? ({first(post.author)} gets this note)</span>
                          <textarea id="sendback-note" rows={2} autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Use the vertical version of the graphic" />
                        </label>
                        <div className="row-btns">
                          <button className="btn-primary sm" disabled={!note.trim() || busy} onClick={() => save('draft', 'sent back', { reviewNote: note.trim() }, note.trim())}>
                            Send Back
                          </button>
                          <button className="btn" onClick={() => setSendingBack(false)}>
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="row-btns">
                        <button className="btn-primary sm" disabled={busy} onClick={() => save('scheduled', 'approved and scheduled', { reviewNote: '' })}>
                          Approve & Schedule
                        </button>
                        <button className="btn" onClick={() => setSendingBack(true)}>
                          Send Back With A Note
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <span>Waiting for {leadFirst} to review. You can still make changes.</span>
                )}
              </div>
            )}
            {post?.reviewNote && post.status === 'draft' && (
              <div className="review-box warn">
                <b>{leadFirst} sent this back:</b> {post.reviewNote}
              </div>
            )}
            {status === 'scheduled' && postAuto && !manual && (
              <div className={`publish-box ${failed ? 'warn' : ''}`} role={failed ? 'alert' : undefined}>
                {failed ? (
                  <>
                    <b>This didn’t publish.</b>
                    <span>
                      {post!.publishError || 'Something went wrong on the way to the platform.'}
                      {lead && !iAmLead && ` ${leadFirst} can try again or post it by hand.`}
                    </span>
                  </>
                ) : (
                  <span>
                    Publishes automatically to <b>{platformById(post!.platform).label}</b>
                    {account ? (post!.platform === 'instagram' ? <> as <b>@{account.handle}</b></> : <> on <b>{account.name}</b></>) : null} on {date ? format(new Date(`${date}T${time || '00:00'}`), 'EEE, MMM d') : '—'} at {time ? format(new Date(`2000-01-01T${time}`), 'h:mm a') : '—'}.
                  </span>
                )}
                <div className="row-btns">
                  {(iAmLead || !lead) && (
                    <button className="btn-primary sm" disabled={publishing || busy} onClick={publishNow}>
                      {publishing ? 'Publishing…' : failed ? 'Try Again' : 'Publish Now'}
                    </button>
                  )}
                  {failed && (
                    <button className="btn" onClick={() => setManual(true)}>
                      Post It Myself
                    </button>
                  )}
                </div>
              </div>
            )}
            {dueNow && (
              <div className="ready-box">
                <b>Ready to post on {platformById(post!.platform).label}.</b>
                <span>Copy the caption, save the media, post it, then paste the link here.</span>
                <div className="row-btns">
                  <button className="btn" onClick={copyCaption}>
                    <IconCopy size={16} /> {copied ? 'Copied' : post?.platform === 'youtube' ? 'Copy Title & Description' : 'Copy Caption'}
                  </button>
                  {media.map((m) => (
                    <SaveMedia key={m.id} m={m} />
                  ))}
                </div>
                <div className="posted-row">
                  <input id="post-url" value={postUrl} onChange={(e) => setPostUrl(e.target.value)} placeholder={`Link to the ${platformById(post!.platform).label} post`} aria-label="Link to the live post" />
                  <button className="btn-primary sm" disabled={busy} onClick={() => save('posted', 'marked posted', { postUrl: postUrl.trim() })}>
                    Mark Posted
                  </button>
                </div>
              </div>
            )}

            {isNew ? (
              <div className="field">
                <span>Post to</span>
                <div className="pf-toggles" role="group" aria-label="Platforms">
                  {PLATFORMS.map((p) => (
                    <button key={p.id} type="button" className={`pf-toggle ${platforms.includes(p.id) ? 'on' : ''}`} aria-pressed={platforms.includes(p.id)} onClick={() => togglePlatform(p.id)}>
                      <PlatformIcon id={p.id} size={22} /> {p.label}
                    </button>
                  ))}
                </div>
                {platforms.length > 1 && <small className="muted-sm">Saving makes one post per platform, so you can fine-tune each one afterward.</small>}
              </div>
            ) : null}

            {platforms.some((pf) => accountsOn(pf).length > (pf === 'instagram' ? 0 : 1)) && (
              <div className="field-row accounts-row">
                {platforms
                  .filter((pf) => accountsOn(pf).length > (pf === 'instagram' ? 0 : 1))
                  .map((pf) => (
                    <label key={pf} className="field">
                      <span>
                        <PlatformIcon id={pf} size={16} /> {platformById(pf).label} account
                      </span>
                      <select id={`account-${pf}`} value={accountFor[pf] ?? ''} onChange={(e) => setAccountFor((a) => ({ ...a, [pf]: e.target.value }))}>
                        <option value="">Choose an account…</option>
                        {accountsOn(pf).map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} (@{a.handle})
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
              </div>
            )}

            {status !== 'posted' && (
              <div className="field">
                <span>Publishing</span>
                {anyAuto ? (
                  <label className="check-row">
                    <input id="auto-publish" type="checkbox" checked={autoPublish} onChange={(e) => setAutoPublish(e.target.checked)} />
                    <span>
                      Publish automatically at the scheduled time
                      <small className="muted-sm">
                        {platforms.filter(connected).map((pf) => platformById(pf).label).join(' and ')} {platforms.filter(connected).length > 1 ? 'post' : 'posts'} on {platforms.filter(connected).length > 1 ? 'their' : 'its'} own at the scheduled time.
                        {manualOnly.length > 0 && ` ${manualOnly.map((pf) => platformById(pf).label).join(' and ')} still ${manualOnly.length > 1 ? 'get' : 'gets'} a reminder to post by hand.`}
                      </small>
                    </span>
                  </label>
                ) : (
                  <small className="muted-sm">
                    {platforms.some(canAutoPublish) && !accounts.some((a) => a.connected)
                      ? 'Instagram and Facebook aren’t connected yet, so this gets a reminder at posting time.'
                      : 'You’ll get a reminder at posting time to post it by hand.'}
                  </small>
                )}
              </div>
            )}

            {platforms.includes('youtube') && (
              <label className="field">
                <span>
                  YouTube title <em className={charCount(title) > 100 ? 'over' : ''}>{charCount(title)}/100</em>
                </span>
                <input id="yt-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Finding Our Way Home | Week 4" />
              </label>
            )}

            <label className="field">
              <span className="caption-label">
                {platforms.length === 1 && platforms[0] === 'youtube' ? 'Description' : 'Caption'}
                <span className="counts">
                  {platforms.map((pf) => {
                    const lim = platformById(pf).limit
                    const n = charCount(caption)
                    return (
                      <em key={pf} className={n > lim ? 'over' : ''} title={`${platformById(pf).label} limit`}>
                        <PlatformIcon id={pf} size={14} /> {n.toLocaleString()}/{lim.toLocaleString()}
                      </em>
                    )
                  })}
                </span>
              </span>
              <textarea id="caption" rows={6} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Write the caption…" />
            </label>

            <div className="field">
              <span>Media</span>
              <div
                className="media-row"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  void addFiles(e.dataTransfer.files)
                }}
              >
                {media.map((m) => (
                  <span key={m.id} className="media-thumb">
                    <MediaView m={m} cover />
                    <button className="media-x" onClick={() => setMedia((ms) => ms.filter((x) => x.id !== m.id))} aria-label={`Remove ${m.name}`}>
                      ×
                    </button>
                  </span>
                ))}
                <button type="button" className="media-add" onClick={() => fileRef.current?.click()}>
                  <IconPlus size={18} />
                  <span>Add image or video</span>
                </button>
                <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => void addFiles(e.target.files).then(() => (e.target.value = ''))} />
              </div>
            </div>

            <div className="field">
              <span>Category</span>
              <div className="cat-picker" role="radiogroup" aria-label="Category">
                {POST_CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={category === c.id}
                    className={`cat-opt ${category === c.id ? 'on' : ''}`}
                    style={category === c.id ? { ...tint(c.soft, c.ink), boxShadow: `inset 0 0 0 1.5px ${c.color}` } : undefined}
                    onClick={() => setCategory(category === c.id ? '' : c.id)}
                  >
                    <span className="dot" style={{ background: c.color }} /> {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="field-row">
              <label className="field">
                <span>Date</span>
                <input id="post-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label className="field">
                <span>Time</span>
                <input id="post-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </label>
            </div>
            <div>
              <label className="field">
                <span>Campaign</span>
                <input id="post-campaign" list="campaign-list" value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="e.g. Christmas at NorthStar" />
                <datalist id="campaign-list">
                  {campaigns.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </label>
            </div>

            {tried && problems.length > 0 && (
              <ul className="problems" role="alert">
                {problems.map((p) => (
                  <li key={p.msg}>
                    <PlatformIcon id={p.pf} size={16} /> {p.msg}
                  </li>
                ))}
              </ul>
            )}

            {post && post.activity.length > 0 && (
              <div className="post-activity">
                <b>Activity</b>
                <ul>
                  {[...post.activity].reverse().map((a, i) => (
                    <li key={i}>
                      <Avatar name={a.by} size={24} />
                      <span>
                        <b>{first(a.by)}</b> {a.what}
                        {a.note && <q>{a.note}</q>}
                        <span className="muted-sm"> · {formatDistanceToNow(parseISO(a.at), { addSuffix: true })}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </fieldset>

          <aside className="composer-preview" aria-label="Preview">
            {platforms.length > 1 && (
              <div className="pill-group pv-tabs" role="tablist" aria-label="Preview platform">
                {platforms.map((pf) => (
                  <button key={pf} className={previewOn === pf ? 'on' : ''} role="tab" aria-selected={previewOn === pf} onClick={() => setPreviewOn(pf)} title={platformById(pf).label}>
                    <PlatformIcon id={pf} size={20} />
                  </button>
                ))}
              </div>
            )}
            {platforms.length ? <PostPreview post={{ ...fields, platform: platforms.includes(previewOn) ? previewOn : platforms[0] }} account={accounts.find((a) => a.id === accountFor[platforms.includes(previewOn) ? previewOn : platforms[0]])} /> : <div className="empty">Pick a platform to see a preview.</div>}
          </aside>
        </div>

        <div className="modal-foot">
          {readOnly ? (
            <>
              <span className="muted-sm">{lead ? `View only. ${leadFirst} manages the Posting Calendar.` : ''}</span>
              <span className="grow" />
              {post?.postUrl && (
                <a className="btn" href={post.postUrl} target="_blank" rel="noreferrer">
                  View Post ↗
                </a>
              )}
              <button className="btn-primary sm" onClick={onClose}>
                Close
              </button>
            </>
          ) : (
            <>
          {post && (
            confirmDelete ? (
              <>
                <span className="muted-sm">Delete this post?</span>
                <button className="btn danger" onClick={() => store.remove(post.id).then(onClose).catch((e) => onError((e as Error).message))}>
                  Delete
                </button>
                <button className="btn" onClick={() => setConfirmDelete(false)}>
                  Keep
                </button>
              </>
            ) : (
              <button className="btn danger" onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            )
          )}
          <span className="grow" />
          {status === 'posted' ? (
            <>
              {post?.postUrl && (
                <a className="btn" href={post.postUrl} target="_blank" rel="noreferrer">
                  View Post ↗
                </a>
              )}
              <button className="btn" disabled={busy} onClick={() => save('scheduled', 'marked not posted')}>
                Mark Not Posted
              </button>
              <button className="btn-primary sm" disabled={busy} onClick={() => save('posted')}>
                Save
              </button>
            </>
          ) : status === 'scheduled' ? (
            <>
              <button className="btn" disabled={busy} onClick={() => save('draft', 'unscheduled')}>
                Unschedule
              </button>
              <button className="btn-primary sm" disabled={busy} onClick={() => save('scheduled')}>
                Save Changes
              </button>
            </>
          ) : status === 'review' && !iAmLead ? (
            <>
              <button className="btn" disabled={busy} onClick={() => save('draft', 'withdrew from review')}>
                Back To Draft
              </button>
              <button className="btn-primary sm" disabled={busy} onClick={() => save('review')}>
                Save Changes
              </button>
            </>
          ) : status === 'review' ? (
            <button className="btn" disabled={busy} onClick={() => save('review')}>
              Save Changes
            </button>
          ) : (
            <>
              <button className="btn" disabled={busy} onClick={() => save('idea', status === 'idea' ? undefined : 'saved as an idea')}>
                Save As Idea
              </button>
              <button className="btn" disabled={busy} onClick={() => save('draft', status === 'draft' && !isNew ? undefined : 'saved a draft')}>
                Save Draft
              </button>
              {iAmLead || !lead ? (
                <button className="btn-primary sm" disabled={busy} onClick={() => save('scheduled', 'scheduled')}>
                  Schedule
                </button>
              ) : (
                <button className="btn-primary sm" disabled={busy} onClick={() => save('review', 'submitted for review')}>
                  Submit For Review
                </button>
              )}
            </>
          )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
