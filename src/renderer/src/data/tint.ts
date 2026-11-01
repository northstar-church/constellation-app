// Pastel tag colors that also work in dark mode: light-dark() picks per theme (the page's color-scheme).

const DARK_SURFACE = '#1c1c20'

/** Background + text for a soft/ink pair */
export const tint = (soft: string, ink: string): { background: string; color: string } => ({
  background: `light-dark(${soft}, color-mix(in srgb, ${ink} 30%, ${DARK_SURFACE}))`,
  color: `light-dark(${ink}, color-mix(in srgb, ${ink} 45%, #ffffff))`
})

/** Just the background (bands, columns), optionally see-through in light mode */
export const tintBg = (soft: string, ink: string, lightAlpha = ''): string => `light-dark(${soft}${lightAlpha}, color-mix(in srgb, ${ink} 18%, ${DARK_SURFACE}))`

/** Media Requests stage columns: same pastel in light mode, a richer color in dark mode */
export const stageBg = (soft: string, dot: string): string => `light-dark(${soft}80, color-mix(in srgb, ${dot} 34%, ${DARK_SURFACE}))`
