// Small chart pieces for Reports: stat tiles, a column chart (one or two series) and ranked bars.
// Every chart has a table view, so no number is only available by hovering or by color.
import { useState, type ReactNode } from 'react'
import type { Bucket, Count } from '../data/reports'

export function Stat({ label, value, delta, hint, hero }: { label: string; value: string; delta?: { text: string; good: boolean | null } | null; hint?: string; hero?: boolean }) {
  return (
    <div className={`rp-stat ${hero ? 'hero' : ''}`}>
      <span className="rp-stat-label">{label}</span>
      <b className="rp-stat-value">{value}</b>
      {delta && (
        <span className={`rp-delta ${delta.good == null ? '' : delta.good ? 'good' : 'bad'}`}>
          {delta.good != null && <i aria-hidden>{delta.good ? '▲' : '▼'}</i>}
          {delta.text}
        </span>
      )}
      {hint && <span className="rp-stat-hint">{hint}</span>}
    </div>
  )
}

export function Card({ title, sub, table, children, wide }: { title: string; sub?: string; table: { head: string[]; rows: (string | number)[][] }; children: ReactNode; wide?: boolean }) {
  const [asTable, setAsTable] = useState(false)
  return (
    <section className={`rp-card ${wide ? 'wide' : ''}`}>
      <header>
        <div>
          <h3>{title}</h3>
          {sub && <p>{sub}</p>}
        </div>
        <button className="rp-toggle" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>{asTable ? 'Chart' : 'Table'}</button>
      </header>
      {asTable ? (
        <div className="rp-table-wrap">
          <table className="rp-table">
            <thead>
              <tr>{table.head.map((h, i) => <th key={i}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </section>
  )
}

const niceMax = (v: number) => {
  if (v <= 4) return 4
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p
  return v
}

/** Columns over time. With `bName`, two series side by side and a legend. */
export function Columns({ data, aName, bName, empty = 'Nothing in this range.' }: { data: Bucket[]; aName: string; bName?: string; empty?: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const top = niceMax(Math.max(1, ...data.map((d) => Math.max(d.a, bName ? d.b : 0))))
  const ticks = [0, top / 2, top]
  if (!data.some((d) => d.a || d.b)) return <div className="rp-empty">{empty}</div>
  const every = Math.ceil(data.length / 14)
  const last = data.length - 1
  return (
    <div className="rp-cols-wrap">
      {bName && (
        <div className="rp-legend">
          <span><i className="sw a" /> {aName}</span>
          <span><i className="sw b" /> {bName}</span>
        </div>
      )}
      <div className="rp-cols" onMouseLeave={() => setHover(null)}>
        <div className="rp-grid">
          {ticks.map((t) => (
            <span key={t} style={{ bottom: `${(t / top) * 100}%` }}>
              <em>{t}</em>
            </span>
          ))}
        </div>
        {data.map((d, i) => (
          <div key={i} className={`rp-col ${hover === i ? 'on' : ''}`} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${d.long}: ${aName} ${d.a}${bName ? `, ${bName} ${d.b}` : ''}`}>
            <div className="bars">
              <span className="bar a" style={{ height: `${(d.a / top) * 100}%` }}>{i === last && d.a > 0 && !bName && <em>{d.a}</em>}</span>
              {bName && <span className="bar b" style={{ height: `${(d.b / top) * 100}%` }} />}
            </div>
            <span className="x">{i % every === 0 || i === last ? d.label : ''}</span>
            {hover === i && (
              <div className={`rp-tip ${i > data.length * 0.6 ? 'left' : ''}`}>
                <b>{d.long}</b>
                <span><i className="sw a" /> {aName} <strong>{d.a}</strong></span>
                {bName && <span><i className="sw b" /> {bName} <strong>{d.b}</strong></span>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Ranked horizontal bars with the value at the tip */
export function Bars({ data, max = 8, unit = '', empty = 'Nothing in this range.' }: { data: Count[]; max?: number; unit?: string; empty?: string }) {
  const [all, setAll] = useState(false)
  if (!data.length || !data.some((d) => d.value)) return <div className="rp-empty">{empty}</div>
  const shown = all ? data : data.slice(0, max)
  const top = Math.max(...data.map((d) => d.value))
  const total = data.reduce((s, d) => s + d.value, 0)
  return (
    <div className="rp-bars">
      {shown.map((d) => (
        <div key={d.label} className="rp-bar-row" title={`${d.label}: ${d.value}${unit} (${Math.round((d.value / total) * 100)}%)`}>
          <span className="lbl">{d.label}</span>
          <span className="track">
            <span className="fill" style={{ width: `${(d.value / top) * 100}%` }} />
          </span>
          <span className="val">{d.value}{unit}</span>
        </div>
      ))}
      {data.length > max && <button className="rp-more" onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show all ${data.length}`}</button>}
    </div>
  )
}
