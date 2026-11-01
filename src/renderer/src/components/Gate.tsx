import { useEffect, useRef, useState } from 'react'
import { call } from '../data/cloudStore'
import { LogoMark } from './Icons'

const EMAIL_KEY = 'constellation.signin-email'
const remembered = () => {
  try {
    return localStorage.getItem(EMAIL_KEY) ?? ''
  } catch {
    return ''
  }
}

/** Shown instead of the app when the team hub needs a sign-in or can't be reached. Sign-in: church email → code by Slack DM. */
export function Gate({ state, onRetry, demo = false }: { state: 'signedOut' | 'offline'; onRetry: () => void; demo?: boolean }) {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState(() => remembered() || (demo ? 'jeremy.thompson@northstarchurch.org' : ''))
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [wait, setWait] = useState(0)
  const codeRef = useRef<HTMLInputElement>(null)

  // When offline, quietly try again every 15 seconds.
  useEffect(() => {
    if (state !== 'offline') return
    const t = setInterval(onRetry, 15_000)
    return () => clearInterval(t)
  }, [state, onRetry])

  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setNote('')
    const clean = email.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(clean)) return setNote('Enter your church email, like first.last@northstarchurch.org.')
    setBusy(true)
    try {
      if (!demo) await call('/api/auth/start', 'POST', { email: clean })
      try {
        localStorage.setItem(EMAIL_KEY, clean)
      } catch {
        /* private window */
      }
      setEmail(clean)
      setStep('code')
      setCode('')
      setWait(30)
      setTimeout(() => codeRef.current?.focus(), 50)
    } catch (err) {
      setNote((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const verify = async (value = code) => {
    const digits = value.replace(/\D/g, '')
    if (digits.length !== 6) return
    setBusy(true)
    setNote('')
    try {
      if (!demo) await call('/api/auth/verify', 'POST', { email, code: digits })
      const next = new URLSearchParams(location.search).get('next')
      if (!window.hub?.isDesktop && next && next.startsWith('/') && !next.startsWith('//')) location.replace(next)
      else onRetry()
    } catch (err) {
      setNote((err as Error).message)
      setCode('')
      codeRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="gate">
      <div className="gate-band" />
      <div className="gate-card">
        <div className="gate-logo">
          <LogoMark size={40} />
        </div>
        {state === 'offline' ? (
          <>
            <h1>You’re Offline</h1>
            <p>Constellation needs an internet connection to load the Event Calendar. It will reconnect on its own as soon as you’re back online.</p>
            <button className="btn-primary" onClick={onRetry}>Try Again</button>
          </>
        ) : step === 'email' ? (
          <form className="gate-form" onSubmit={send}>
            <h1>Welcome To Constellation</h1>
            <p>Sign in with your church email. We’ll send a code to you in Slack. No password, and you’ll stay signed in on this {window.hub?.isDesktop ? 'Mac' : 'browser'}.</p>
            <input
              className="gate-input"
              type="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="first.last@northstarchurch.org"
              aria-label="Church email"
            />
            <button className="btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send Code'}</button>
          </form>
        ) : (
          <div className="gate-form">
            <h1>Check Slack</h1>
            <p>
              We sent a 6-digit code to <b>{email}</b> in a Slack message from Constellation. It works for 10 minutes.
              {demo && <em className="gate-demo"> Preview: any 6 digits work.</em>}
            </p>
            <input
              ref={codeRef}
              className="gate-input code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={(e) => {
                const v = e.target.value.replace(/[^\d ]/g, '')
                setCode(v)
                if (v.replace(/\D/g, '').length === 6) void verify(v)
              }}
              placeholder="123 456"
              aria-label="Code from Slack"
              disabled={busy}
            />
            <button className="btn-primary" onClick={() => verify()} disabled={busy || code.replace(/\D/g, '').length !== 6}>
              {busy ? 'Signing In…' : 'Sign In'}
            </button>
            <div className="gate-links">
              <button onClick={() => send()} disabled={wait > 0 || busy}>{wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}</button>
              <button
                onClick={() => {
                  setStep('email')
                  setNote('')
                }}
              >
                Use a different email
              </button>
            </div>
          </div>
        )}
        {note && <p className="error">{note}</p>}
        {state !== 'offline' && <p className="gate-help">Not on the team yet? Ask Jeremy or Stephanie to add you.</p>}
      </div>
    </div>
  )
}
