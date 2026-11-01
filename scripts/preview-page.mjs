// Turns the single-file demo build (preview/index.html) into a page for Claude to publish as the shareable preview link.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
const out = process.argv[2] ?? 'preview/page.html'
const html = readFileSync(process.argv[3] ?? 'preview/index.html', 'utf8')
// The bundle itself contains HTML (the tracker page), so use the document's first <head> and last </head>.
const head = html.slice(html.indexOf('<head>') + 6, html.lastIndexOf('</head>'))
  .replace(/<meta charset[^>]*>/i, '')
  .replace(/<meta name="viewport"[^>]*>/i, '')
  .replace(/<title>[\s\S]*?<\/title>/i, '')
const bodyStart = html.indexOf('>', html.lastIndexOf('<body')) + 1
const body = html.slice(bodyStart, html.lastIndexOf('</body>'))
const page = `<title>${process.argv[4] ?? "Constellation Preview"}</title>
<style>html,body{height:100%}body{background:var(--bg,#f4f4f5)}</style>
${head.trim()}
${body.trim()}
`
mkdirSync(out.replace(/\/[^/]*$/, ''), { recursive: true })
writeFileSync(out, page)
console.log(`${out}: ${(page.length / 1024).toFixed(0)} KB`)
