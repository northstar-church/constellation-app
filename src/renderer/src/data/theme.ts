// Light/dark: follows the Mac until someone flips the header switch, then remembers their pick.

export type Theme = 'light' | 'dark'
const KEY = 'constellation.theme'
const media = () => window.matchMedia?.('(prefers-color-scheme: dark)')

export function savedTheme(): Theme | null {
  try {
    const t = localStorage.getItem(KEY)
    return t === 'light' || t === 'dark' ? t : null
  } catch {
    return null
  }
}
export const systemTheme = (): Theme => (media()?.matches ? 'dark' : 'light')
export const currentTheme = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

const listeners = new Set<(t: Theme) => void>()
function apply(t: Theme) {
  document.documentElement.dataset.theme = t
  listeners.forEach((l) => l(t))
}

/** Call once at startup: sets the theme and keeps following the Mac while nothing is picked. */
export function startTheme() {
  apply(savedTheme() ?? systemTheme())
  media()?.addEventListener?.('change', () => !savedTheme() && apply(systemTheme()))
}

export function setTheme(t: Theme) {
  try {
    localStorage.setItem(KEY, t)
  } catch {
    /* private window: lasts until reload */
  }
  apply(t)
}

export function onTheme(l: (t: Theme) => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}
