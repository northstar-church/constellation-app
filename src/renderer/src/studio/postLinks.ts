import { format, parseISO } from 'date-fns'
import { platformById, type SocialAccount, type SocialPost } from '../data/social'
import type { SocialStore } from '../social/socialStore'
import type { NewCard, StudioStore } from './studioStore'

/**
 * "Plan In Studio" for a post: the board it's already linked to, or a new private board
 * with its caption and images, linked back to the post. Returns the board's id.
 */
export async function boardForPost(post: SocialPost, studio: StudioStore, social: SocialStore): Promise<string> {
  if (post.boardId) return post.boardId
  const pf = platformById(post.platform)
  const accounts: SocialAccount[] = await social.accounts().catch(() => [])
  const acct = accounts.find((a) => a.id === post.account)
  const when = post.date ? format(parseISO(post.date), 'MMM d') : ''
  const title = post.campaign ? `${post.campaign}: ${pf.label} Post` : `${pf.label} Post${when ? ` · ${when}` : ''}`

  const images = await studio.importPostMedia(post.media)
  const videos = post.media.filter((m) => m.kind === 'video')
  const cards: Omit<NewCard, 'boardId'>[] = [
    { type: 'heading', x: 60, y: 40, w: 640, data: { text: title } },
    {
      type: 'note',
      x: 60,
      y: 140,
      w: 340,
      color: 'rose',
      data: { text: `Post caption:\n${post.caption}\n\nPlatform: ${pf.label}${acct ? ` (@${acct.handle})` : ''}` }
    },
    ...images.map((media, i) => ({ type: 'image' as const, x: 440 + (i % 4) * 300, y: 140 + Math.floor(i / 4) * 380, w: 280, data: { media, caption: '' } })),
    ...(videos.length ? [{ type: 'note' as const, x: 60, y: 480, w: 340, data: { text: `## Video\n${videos.map((v) => `- ${v.name}`).join('\n')}\n(Videos stay on the post.)` } }] : [])
  ]
  const board = await studio.seedBoard(title, 'private', cards)
  await social.update(post.id, { boardId: board.id }, 'planned it in Creative Studio')
  return board.id
}
