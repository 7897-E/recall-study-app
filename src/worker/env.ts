export interface AuthUser {
  sub: string
  name?: string
  email?: string
  picture?: string
}

export interface Env {
  ASSETS: Fetcher
  // Attached by Freebuff Sites once provisioned (sites_add_storage). Optional so
  // the app can explain what is missing instead of crashing.
  DB?: D1Database
  FILES?: R2Bucket
  // Supabase project (Dashboard → Project Settings → API). The anon key is
  // public by design; the Worker only uses it to introspect access tokens.
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
}

export type Variables = {
  user: AuthUser
  db: D1Database
}

export type AppContext = { Bindings: Env; Variables: Variables }
