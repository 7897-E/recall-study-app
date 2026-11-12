import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// The Supabase URL and anon (publishable) key are fetched from the Worker at
// runtime so the browser bundle carries no configuration and one build works
// against any project. The anon key is public by design; row access is limited
// by the Worker, which verifies the access token on every API call.

export interface AuthStatus {
  mode: 'supabase' | 'development' | 'off'
  database: boolean
  files: boolean
  supabase: { url: string; anonKey: string } | null
}

const unconfigured: AuthStatus = { mode: 'off', database: false, files: false, supabase: null }

let statusRequest: Promise<AuthStatus> | null = null
let clientRequest: Promise<SupabaseClient | null> | null = null

export function authStatus(): Promise<AuthStatus> {
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

/** The current access token, refreshed by supabase-js when it is close to expiry. */
export async function accessToken(): Promise<string | null> {
  const client = await supabaseClient()
  if (!client) return null
  const { data } = await client.auth.getSession()
  return data.session?.access_token ?? null
}

export async function signOut(): Promise<void> {
  const client = await supabaseClient()
  await client?.auth.signOut()
}
