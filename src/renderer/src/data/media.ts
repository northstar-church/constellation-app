/**
 * Gets an image ready for social posts: notes its size, and re-saves PNG/WebP images as JPG
 * (Instagram only publishes JPGs). GIFs, videos and anything the app can't read pass through.
 */
export async function prepareImage(file: File): Promise<{ file: File; w?: number; h?: number }> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return { file }
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(file)
  } catch {
    return { file } // e.g. HEIC: the app can't read it; the post checks will say so
  }
  const w = bmp.width
  const h = bmp.height
  if (file.type === 'image/jpeg') {
    bmp.close()
    return { file, w, h }
  }
  try {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff' // transparent areas become white, not black
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bmp, 0, 0)
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.92))
    if (!blob) return { file, w, h }
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
    return { file: new File([blob], name, { type: 'image/jpeg' }), w, h }
  } finally {
    bmp.close()
  }
}
