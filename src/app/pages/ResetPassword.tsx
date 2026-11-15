import { motion } from 'motion/react'
import { KeyRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'

import { Logo } from '../components/Shell'
import { Button, Input, Spinner, useToast } from '../components/ui'
import { useAuth } from '../lib/auth'

export function ResetPassword() {
  const { client, session, ready } = useAuth()
  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex h-16 w-full max-w-[1120px] items-center px-5 sm:px-8">
        <Logo />
      </header>
      <main className="mx-auto grid w-full max-w-[420px] flex-1 content-start gap-4 px-5 pb-16 pt-8 sm:px-8">
        {!ready ? (
          <div className="grid place-items-center py-20">
            <Spinner />
          </div>
        ) : !client ? (
          <Notice icon title="Supabase is not connected yet" body="Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then reload." />
        ) : session ? (
          <ResetForm />
        ) : (
          <Notice
            icon={false}
            title="This link has expired"
            body="Open the reset link from your email again, or request a fresh one from the sign-in screen."
            action={<Button onClick={() => window.location.assign(import.meta.env.BASE_URL)}>Back to sign in</Button>}
          />
        )}
      </main>
    </div>
  )
}

function ResetForm() {
  const { client } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!client) return
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }
    setBusy(true)
    setError(null)
    const { error: failure } = await client.auth.updateUser({ password })
    setBusy(false)
    if (failure) {
      setError(failure.message)
      return
    }
    toast('Password updated')
    navigate('/', { replace: true })
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="rounded-card bg-surface p-6 shadow-float">
      <h1 className="text-[20px] font-semibold tracking-tight">Set a new password</h1>
      <p className="mt-1 text-[13px] text-muted">Choose something you have not used before.</p>
      <form onSubmit={submit} className="mt-5 grid gap-3.5">
        <label className="grid gap-1.5">
          <span className="text-[13px] font-medium">New password</span>
          <Input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" />
        </label>
        <label className="grid gap-1.5">
          <span className="text-[13px] font-medium">Confirm password</span>
          <Input type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="Repeat it" />
        </label>
        {error && <p className="rounded-tile bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</p>}
        <Button variant="primary" type="submit" loading={busy} className="mt-1 h-11">
          Save password
        </Button>
      </form>
    </motion.div>
  )
}

function Notice({ title, body, action, icon = true }: { title: string; body: string; action?: React.ReactNode; icon?: boolean }) {
  return (
    <div className="rounded-card bg-surface p-6 shadow-float">
      {icon && (
        <div className="grid size-10 place-items-center rounded-tile bg-warning-soft text-warning">
          <KeyRound className="size-5" />
        </div>
      )}
      <h1 className="mt-3 text-[19px] font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
