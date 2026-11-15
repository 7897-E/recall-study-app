import { motion } from 'motion/react'
import { Database, KeyRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

import { Logo } from '../components/Shell'
import { Button, Input, useToast } from '../components/ui'
import { useAuth } from '../lib/auth'

export function SignIn() {
  const { client } = useAuth()
  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex h-16 w-full max-w-[1120px] items-center px-5 sm:px-8">
        <Logo />
      </header>
      <main className="mx-auto grid w-full max-w-[1120px] flex-1 items-center gap-12 px-5 pb-16 sm:px-8 lg:grid-cols-2">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} className="max-w-md">
          <h1 className="text-balance text-[40px] font-bold leading-[1.05] tracking-[-0.03em] sm:text-[52px]">Remember what you learn</h1>
          <p className="mt-4 text-[16px] leading-relaxed text-muted">Flashcards, quizzes and matching games that schedule themselves around what you forget. Sign in to open your library.</p>
          <p className="mt-8 text-[13px] text-faint">Accounts are handled by Supabase. Your decks, notes and boards stay private to your account.</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.1, ease: [0.22, 1, 0.36, 1] }} className="w-full max-w-[420px] lg:justify-self-center">
          {client ? <AuthForm client={client} /> : <SetupPanel />}
        </motion.div>
      </main>
    </div>
  )
}

function AuthForm({ client }: { client: SupabaseClient }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const toast = useToast()

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (mode === 'signup') {
        const { data, error: failure } = await client.auth.signUp({ email, password })
        if (failure) setError(failure.message)
        else if (!data.session) setNotice('Account created. Check your email to confirm it, then sign in.')
        else toast('Welcome to Recall')
      } else {
        const { error: failure } = await client.auth.signInWithPassword({ email, password })
        if (failure) setError(failure.message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-card bg-surface p-6 shadow-float">
      <h2 className="text-[19px] font-semibold tracking-tight">{mode === 'signin' ? 'Sign in' : 'Create your account'}</h2>
      <p className="mt-1 text-[13px] text-muted">{mode === 'signin' ? 'Email and password, no card needed.' : 'A single account keeps every deck, note and board yours.'}</p>
      <form onSubmit={submit} className="mt-5 grid gap-3.5">
        <label className="grid gap-1.5">
          <span className="text-[13px] font-medium">Email</span>
          <Input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
        </label>
        <label className="grid gap-1.5">
          <span className="text-[13px] font-medium">Password</span>
          <Input
            type="password"
            required
            minLength={8}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
          />
        </label>
        {error && <p className="rounded-tile bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</p>}
        {notice && <p className="rounded-tile bg-success-soft px-3 py-2 text-[12.5px] text-success">{notice}</p>}
        <Button variant="primary" type="submit" loading={busy} className="mt-1 h-11">
          {mode === 'signin' ? 'Sign in' : 'Create account'}
        </Button>
      </form>
      <p className="mt-4 text-[12.5px] text-muted">
        {mode === 'signin' ? 'New here?' : 'Already have an account?'}{' '}
        <button
          type="button"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin')
            setError(null)
            setNotice(null)
          }}
          className="font-semibold text-accent hover:underline"
        >
          {mode === 'signin' ? 'Create an account' : 'Sign in'}
        </button>
      </p>
    </div>
  )
}

function SetupPanel() {
  return (
    <div className="rounded-card bg-surface p-6 shadow-float">
      <div className="grid size-10 place-items-center rounded-tile bg-warning-soft text-warning">
        <KeyRound className="size-5" />
      </div>
      <h2 className="mt-3 text-[17px] font-semibold tracking-tight">Supabase is not connected yet</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        Add <code className="rounded bg-surface-2 px-1 py-0.5 text-[12px]">SUPABASE_URL</code> and{' '}
        <code className="rounded bg-surface-2 px-1 py-0.5 text-[12px]">SUPABASE_ANON_KEY</code> from your Supabase project (Settings → API), then reload.
      </p>
      <p className="mt-3 text-[12.5px] text-faint">Locally they go in <code className="rounded bg-surface-2 px-1 py-0.5">.dev.vars</code>; on Freebuff Sites, save them as project secrets.</p>
    </div>
  )
}

export function SetupNeeded({ message }: { message: string }) {
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-card bg-surface-2 text-muted">
          <Database className="size-5" />
        </div>
        <h1 className="mt-4 text-[20px] font-semibold tracking-tight">Almost there</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">{message}</p>
        <p className="mt-4 text-[13px] text-faint">If this is a fresh project, run <code className="rounded bg-surface-2 px-1 py-0.5">supabase/schema.sql</code> in the Supabase SQL editor to create the tables, policies and image bucket.</p>
      </div>
    </div>
  )
}
