// Brand Library: NorthStar's brand guidelines as a living document. Chapters hold blocks
// (text, do/don't lists, color swatches, typefaces, tables, logo files, examples, downloads).

export interface BrandFile {
  id: string
  name: string
  contentType: string
  size: number
  uploadedBy: string
  at: string
}

export interface Swatch {
  id: string
  name: string
  hex: string
  /** '' = worked out from the hex */
  rgb: string
  cmyk: string
  pms: string
}

export interface FontSpec {
  id: string
  name: string
  /** How it's set: drives the live sample */
  style: 'heading' | 'mono' | 'body'
  role: string
  caseRule: string
  sample: string
  /** Where to get it (Adobe Fonts, Google Fonts…) */
  link: string
}

export interface LogoSlot {
  id: string
  name: string
  /** Which background the preview sits on */
  bg: 'light' | 'dark'
  files: BrandFile[]
}

export interface Example {
  id: string
  label: string
  good: boolean
  caption: string
  file: BrandFile | null
}

export type BrandBlock =
  | { id: string; type: 'text'; heading: string; body: string }
  | { id: string; type: 'columns'; items: { title: string; body: string }[] }
  | { id: string; type: 'rules'; heading: string; dos: string[]; donts: string[] }
  | { id: string; type: 'colors'; heading: string; note: string; swatches: Swatch[] }
  | { id: string; type: 'fonts'; heading: string; fonts: FontSpec[] }
  | { id: string; type: 'table'; heading: string; note: string; columns: string[]; rows: string[][] }
  | { id: string; type: 'logos'; heading: string; note: string; slots: LogoSlot[] }
  | { id: string; type: 'examples'; heading: string; note: string; items: Example[] }
  | { id: string; type: 'files'; heading: string; note: string; files: BrandFile[] }

export type BlockType = BrandBlock['type']
type NoId<T> = T extends unknown ? Omit<T, 'id'> : never

export interface Chapter {
  id: string
  title: string
  /** Shown under the title */
  intro: string
  /** Drafts are visible to the creative team only */
  draft: boolean
  blocks: BrandBlock[]
  updatedAt: string
  updatedBy: string
}

export interface BrandDoc {
  /** Bumps on every save, so two people editing at once don't overwrite each other */
  version: number
  chapters: Chapter[]
}

export const BLOCK_TYPES: { type: BlockType; label: string; hint: string }[] = [
  { type: 'text', label: 'Text', hint: 'A heading and paragraphs' },
  { type: 'rules', label: 'Do’s & Don’ts', hint: 'Two lists side by side' },
  { type: 'columns', label: 'Columns', hint: 'Short notes side by side' },
  { type: 'colors', label: 'Color Palette', hint: 'Swatches with HEX, RGB, CMYK, PMS' },
  { type: 'fonts', label: 'Typefaces', hint: 'Live samples with usage rules' },
  { type: 'table', label: 'Table', hint: 'Rows and columns' },
  { type: 'logos', label: 'Logo Files', hint: 'Logos on light or dark, with downloads' },
  { type: 'examples', label: 'Examples', hint: 'Proper / improper images' },
  { type: 'files', label: 'Downloads', hint: 'Templates, fonts, any files' }
]

let n = 0
export const bid = () => `b${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function emptyBlock(type: BlockType): BrandBlock {
  const id = bid()
  switch (type) {
    case 'text':
      return { id, type, heading: '', body: '' }
    case 'columns':
      return { id, type, items: [{ title: '', body: '' }, { title: '', body: '' }] }
    case 'rules':
      return { id, type, heading: 'Do’s & Don’ts', dos: [], donts: [] }
    case 'colors':
      return { id, type, heading: 'Palette', note: '', swatches: [] }
    case 'fonts':
      return { id, type, heading: 'Typefaces', fonts: [] }
    case 'table':
      return { id, type, heading: '', note: '', columns: ['', ''], rows: [['', '']] }
    case 'logos':
      return { id, type, heading: 'Logos', note: '', slots: [] }
    case 'examples':
      return { id, type, heading: 'Examples', note: '', items: [] }
    case 'files':
      return { id, type, heading: 'Downloads', note: '', files: [] }
  }
}

// ---------- color helpers ----------

export const cleanHex = (h: string) => {
  const x = h.replace(/[^0-9a-f]/gi, '').toUpperCase()
  return x.length === 3 ? x.split('').map((c) => c + c).join('') : x.slice(0, 6)
}
export const validHex = (h: string) => /^[0-9A-F]{6}$/.test(cleanHex(h))
export function rgbOf(hex: string): string {
  const h = cleanHex(hex)
  if (!validHex(h)) return ''
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ')
}
/** Dark text on light swatches, white on dark ones */
export function inkOn(hex: string): string {
  const h = cleanHex(hex)
  if (!validHex(h)) return '#231f20'
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#231f20' : '#ffffff'
}

// ---------- starting content: from the Illustrator draft (October 2026) ----------

export function seedDoc(by = 'Jeremy Thompson'): BrandDoc {
  const at = new Date().toISOString()
  const ch = (title: string, intro: string, blocks: NoId<BrandBlock>[], draft = false): Chapter => ({
    id: bid(),
    title,
    intro,
    draft,
    blocks: blocks.map((b) => ({ ...b, id: bid() }) as BrandBlock),
    updatedAt: at,
    updatedBy: by
  })
  const sw = (name: string, hex: string, cmyk: string, pms = ''): Swatch => ({ id: bid(), name, hex, rgb: '', cmyk, pms })
  const slot = (name: string, bg: 'light' | 'dark'): LogoSlot => ({ id: bid(), name, bg, files: [] })
  const ex = (label: string, good: boolean): Example => ({ id: bid(), label, good, caption: '', file: null })

  return {
    version: 1,
    chapters: [
      ch(
        'Brand Identity & Purpose',
        'Who we are and why our brand looks and sounds the way it does.',
        [{ type: 'text', heading: 'Our mission', body: 'We exist to help people find their way HOME by Loving God, Loving People, & Living Sent.' }],
        true
      ),
      ch('Brand Voice & Messaging', 'How NorthStar sounds in everything we write.', [], true),
      ch('AI Statement', 'How we do and don’t use AI in our creative work.', [], true),
      ch('Logos', 'Use only these approved files. Download the version you need below each preview.', [
        { type: 'logos', heading: 'Approved Logos', note: '', slots: [slot('Primary Logo', 'light'), slot('Primary Logo', 'dark'), slot('Secondary Logo', 'light'), slot('Secondary Logo', 'dark'), slot('Icon', 'light'), slot('Icon', 'dark')] },
        {
          type: 'columns',
          items: [
            { title: 'Primary Logo', body: 'The preferred logo for most communications.' },
            { title: 'Secondary Logo', body: 'Used when the primary logo does not fit the layout.' },
            { title: 'Icon', body: 'Used only once the NorthStar identity is already established.' }
          ]
        },
        {
          type: 'text',
          heading: 'Spacing, Sizing, & Scaling',
          body: '- Maintain adequate clear space around the logo.\n- Keep the logo proportional when resizing.\n- Ensure the logo is large enough to remain recognizable.\n- Position the logo where it is clearly visible without competing with other design elements.'
        },
        { type: 'examples', heading: 'Proper vs. Improper', note: '', items: [ex('Spacing', true), ex('Spacing', false), ex('Sizing', true), ex('Sizing', false), ex('Scaling', true), ex('Scaling', false)] },
        {
          type: 'rules',
          heading: 'Logo Do’s & Don’ts',
          dos: [
            'Use only approved NorthStar logo files.',
            'Maintain the logo’s original proportions.',
            'Allow adequate clear space around the logo.',
            'Ensure strong contrast between the logo and its background.',
            'Use high-resolution or vector logo files for printed materials.',
            'Use approved logo variations for their intended purposes.',
            'Use PNG or vector logo files.'
          ],
          donts: [
            'Stretch, compress, rotate, or distort the logo.',
            'Change the logo’s color.',
            'Add shadows, outlines, gradients, or effects.',
            'Place the logo over busy photography that reduces visibility.',
            'Recreate the logo using text, AI, or substitute fonts.',
            'Crop, rearrange, or remove elements of the logo.',
            'Use past logo variations.',
            'Use just the wordmark without the star.',
            'Use flattened logo graphics with a background.'
          ]
        }
      ]),
      ch(
        'Ministry Logos',
        'Each ministry’s approved logos. The NorthStar logo rules apply to these too.',
        [
          { type: 'logos', heading: 'Kids', note: '', slots: [slot('Kids Logo', 'light'), slot('Kids Logo', 'dark')] },
          { type: 'logos', heading: '678', note: '', slots: [slot('678 Logo', 'light'), slot('678 Logo', 'dark')] },
          { type: 'logos', heading: 'HSM', note: '', slots: [slot('HSM Logo', 'light'), slot('HSM Logo', 'dark')] }
        ],
        true
      ),
      ch('Color', 'Click any value to copy it.', [
        { type: 'colors', heading: 'Primary Palette', note: 'Use for headings, subheadings, & backgrounds. Body text should always be black or white.', swatches: [sw('Black', '231F20', '70, 67, 64, 74'), sw('White', 'FFFFFF', '0, 0, 0, 0'), sw('Light Gray', 'F4F4F5', '3, 2, 2, 0')] },
        { type: 'colors', heading: 'Secondary Palette', note: 'Use for subheadings, section colors, & highlights. Minimal use to accentuate the primary palette.', swatches: [sw('Blue', '00B7E2', '71, 5, 5, 0'), sw('Red', 'DF1F26', '6, 100, 100, 1'), sw('Stone', 'E2E2DA', '11, 7, 13, 0')] },
        {
          type: 'rules',
          heading: 'Color Do’s & Don’ts',
          dos: [
            'Use black or white for body text to ensure readability.',
            'Only use colors from the approved primary and secondary palettes.',
            'Prioritize the primary color palette in most designs, using secondary colors sparingly.',
            'Maintain strong contrast between text and background colors.',
            'Use color intentionally to highlight important information, calls to action, or key design elements.',
            'Allow neutral colors and white space to balance designs and prevent them from feeling overcrowded.',
            'Use the exact HEX, RGB, or CMYK color codes.'
          ],
          donts: [
            'Use accent colors for body text.',
            'Introduce colors outside the approved brand palettes.',
            'Use too many accent colors within a single design.',
            'Place text over backgrounds that make it difficult to read.',
            'Alter brand colors by adjusting their hue, saturation, or opacity without approval.',
            'Use gradients or combinations of brand colors that are not included in the approved guidelines.',
            'Rely on color alone to communicate important information.'
          ]
        }
      ]),
      ch('Typography', 'Our three typefaces, and how to size and space them.', [
        {
          type: 'fonts',
          heading: 'Brand Typefaces',
          fonts: [
            { id: bid(), name: 'Helvetica Neue Bold', style: 'heading', role: 'Headings & subheadings', caseRule: 'Title Case', sample: 'Love God, Love People, Live Sent', link: '' },
            { id: bid(), name: 'IBM Plex Mono', style: 'mono', role: 'Subheadings & highlights', caseRule: 'ALL CAPS', sample: 'Love God, Love People, Live Sent', link: 'https://fonts.google.com/specimen/IBM+Plex+Mono' },
            { id: bid(), name: 'Helvetica Neue Regular', style: 'body', role: 'Body text', caseRule: 'Sentence case', sample: 'We exist to help people find their way home by loving God, loving people, and living sent.', link: '' }
          ]
        },
        { type: 'table', heading: 'Typeface Sizing', note: '', columns: ['', 'Print', 'Web'], rows: [['Heading', '24–36 pt', '36–48 pt'], ['Subheading', '14–24 pt', '22–36 pt'], ['Body', '10–12 pt', '16–18 pt']] },
        {
          type: 'text',
          heading: 'Leading',
          body: 'Leading is the vertical spacing between lines of text.\n\nLeading should only apply to body text, as headings & subheadings should NOT require multiple lines of text.\n\nLeading should scale proportionally with the font size, always **+1 of the automatic setting**.'
        },
        {
          type: 'text',
          heading: 'Tracking',
          body: 'Tracking is the spacing between letters.\n\nFor **headings**, set the tracking to the negative equivalent of the font size. A font size of 20 gets a tracking of -20; a font size of 50 gets -50.\n\n**Subheadings & body** tracking should always be set to 0/auto.'
        },
        {
          type: 'table',
          heading: 'Typeface Reference Guide',
          note: 'Filled in from the pages above. Check before sharing.',
          columns: ['Typeface', 'Function', 'Case', 'Size', 'Tracking', 'Leading'],
          rows: [
            ['Helvetica Neue Bold', 'Headings', 'Title Case', 'Print 24–36 pt · Web 36–48 pt', 'Negative of the font size', 'Single line'],
            ['IBM Plex Mono', 'Subheadings & highlights', 'ALL CAPS', 'Print 14–24 pt · Web 22–36 pt', '0 / auto', 'Single line'],
            ['Helvetica Neue Regular', 'Body text', 'Sentence case', 'Print 10–12 pt · Web 16–18 pt', '0 / auto', 'Auto +1']
          ]
        }
      ]),
      ch('Photography', 'What our photos should feel like, and how to use them.', [
        {
          type: 'text',
          heading: 'Photo Voice',
          body: 'Our imagery should feel authentic, welcoming, joyful, and people-centered. Photos should capture genuine moments of worship, community, connection, and life change. We prioritize natural expressions and meaningful interactions that reflect the people, diversity, and experiences that make up our church family.'
        },
        {
          type: 'rules',
          heading: 'Photo Usage Do’s & Don’ts',
          dos: [
            'Prioritize photos that communicate connection, community, and genuine emotion.',
            'Use high resolution, sharp, well-edited images.',
            'Select photos with natural lighting and accurate skin tones.',
            'Use imagery that reflects diversity of ages, ethnicities, and backgrounds within our church.',
            'Consider negative space when selecting photos that will have text overlays.'
          ],
          donts: [
            'Overuse posed or staged imagery when authentic moments are available.',
            'Use blurry, low-resolution, or pixelated images.',
            'Use stock photography.',
            'Crop photos in a way that removes important context or cuts off subjects.',
            'Use imagery where children’s names or name tags are visible.',
            'Skew photography when resizing.'
          ]
        }
      ])
    ]
  }
}
