// The staff Brand Library page behind the private link (/track/brand/<token>), or sample data in the preview.
import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './brand/brandstaff.css'
import { startTheme } from './data/theme'
import { seedDoc, type BrandDoc, type BrandFile } from './data/brand'
import { BrandGuide } from './brand/BrandGuide'

startTheme()

const PREVIEW = !!import.meta.env.VITE_PREVIEW
const token = location.pathname.split('/')[3] ?? ''
const base = `/track/brand/${token}`

async function load(): Promise<BrandDoc> {
  if (PREVIEW) return seedDoc()
  const res = await fetch(`${base}/data`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? 'These guidelines aren’t available. Check that you have the latest link.')
  return data
}
const fileUrl = async (f: BrandFile) => {
  if (PREVIEW) throw new Error('Downloads work on the real link once logos are uploaded.')
  return `${base}/files/${f.id}`
}

function Page() {
  const [doc, setDoc] = useState<BrandDoc | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    load().then(setDoc).catch((e: Error) => setError(e.message))
  }, [])
  return (
    <div className="bs">
      <header className="bs-head">
        <div>
          <span className="bs-kicker">NorthStar Church</span>
          <h1>Brand Guidelines</h1>
        </div>
        <div className="bs-actions">
          <label className="bs-search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the guidelines" aria-label="Search the guidelines" />
          </label>
          <button className="bs-btn" onClick={() => window.print()}>Print / PDF</button>
        </div>
      </header>
      {PREVIEW && <div className="bs-banner">Preview of the staff link, with sample content. In-progress chapters are shown here only so you can see them; on the real link they stay hidden until you mark them ready.</div>}
      {error && <div className="bs-banner warn">{error}</div>}
      {doc && <BrandGuide doc={doc} fileUrl={fileUrl} staff showDrafts={PREVIEW} query={q} />}
      <footer className="bs-foot">Questions about using the brand? Contact NorthStar Creative.</footer>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Page />
  </React.StrictMode>
)
