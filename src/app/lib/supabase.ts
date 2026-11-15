import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// The Supabase URL and publishable key are build-time configuration for the
// static build (GitHub Pages has no server to ask), with a runtime fallback to
// the Worker's status endpoint for the hosted build. The publishable key is
// public by design; row level security is what protects the data.

export interface AuthStatus {
  mode: 'supabase' | 'development' | 'off'
  database: boolean
  files: boolean
  supabase: { url: string; anonKey: string } | null
}

const envUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim()
const envKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()
const buildConfig = envUrl && envKey ? { url: envUrl.replace(/\/+$/, ''), anonKey: envKey } : null

const unconfigured: AuthStatus = { mode: 'off', database: false, files: false, supabase: null }

let statusRequest: Promise<AuthStatus> | null = null
let clientRequest: Promise<SupabaseClient | null> | null = null

export function authStatus(): Promise<AuthStatus> {
  if (buildConfig) {
    return Promise.resolve<AuthStatus>({ mode: 'supabase', database: true, files: true, supabase: buildConfig })
  }
  if (!statusRequest) {
    statusRequest = fetch('/api/auth/status')
      .then((response) => (response.ok ? (response.json() as Promise<AuthStatus>) : unconfigured))
      .catch(() => unconfigured)
  }
  return statusRequest
}

export function supabaseClient(): Promise<SupabaseClient | null> {
  if (!clientRequest) {
    clientRequest = authStatus().then((status) =>
      status.supabase
        ? createClient(status.supabase.url, status.supabase.anonKey, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
          })
        : null,
    )
  }
  return clientRequest
}

export async function signOut(): Promise<void> {
  const client = await supabaseClient()
  await client?.auth.signOut()
}
