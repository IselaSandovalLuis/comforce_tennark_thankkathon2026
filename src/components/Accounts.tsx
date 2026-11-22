import { useState, type FormEvent } from 'react'
import { authService } from '../services/authService'
import { Hero } from './Layout'

function PasswordField({ id, label, value, onChange, newPassword = false }: {
  id: string; label: string; value: string; onChange: (value: string) => void; newPassword?: boolean
}) {
  const [show, setShow] = useState(false)
  return <div className="field">
    <label htmlFor={id}>{label}</label>
    <div className="password-field">
      <input id={id} type={show ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)}
        autoComplete={newPassword ? 'new-password' : 'current-password'} maxLength={128} required />
      <button className="secondary" type="button" onClick={() => setShow(!show)} aria-controls={id}>
        {show ? 'Hide' : 'Show'} {label.toLowerCase()}
      </button>
    </div>
  </div>
}

export function LoginForm() {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function login(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await authService.login(identifier, password)
      location.hash = 'dashboard'
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign in.')
    } finally {
      setBusy(false)
    }
  }

  return <>
    <Hero title="Staff sign-in">Sign in to your organization’s incident dashboard.</Hero>
    <div className="account-grid">
      <form className="dashboard-card grid gap-4" onSubmit={login}>
        <div className="field">
          <label htmlFor="account-id">Username</label>
          <input id="account-id" autoComplete="username" value={identifier} onChange={e => setIdentifier(e.target.value)} required />
        </div>
        <PasswordField id="login-password" label="Password" value={password} onChange={setPassword} />
        {error && <p role="alert" className="field-error">{error}</p>}
        <div className="form-actions">
          <button type="submit" className="primary" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
          <a className="tip-text-link" href="#my-reports">Find community reports</a>
        </div>
      </form>
    </div>
  </>
}

