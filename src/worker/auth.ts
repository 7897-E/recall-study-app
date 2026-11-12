import type { Context, MiddlewareHandler } from 'hono'

import type { AppContext, AuthUser, Env } from './env'

// Supabase owns the account system; this file only verifies the access token a
// signed-in browser sends with each API call. Verification asks the project's
// /auth/v1/user endpoint, cached per isolate so a burst of requests costs one
// round trip. Without Supabase configured, a loopback-only development user
// keeps the app usable locally.

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

export const DEV_USER: AuthUser = {
  sub: 'dev-user',
  name: 'Alex Morgan',
  email: 'alex@example.com',
}

export function isLoopback(request: Request): boolean {
  return LOOPBACK.has(new URL(request.url).hostname)
}

export function supabaseConfig(env: Env): { url: string; anonKey: string } | null {
  const url = env.SUPABASE_URL?.trim()
  const anonKey = env.SUPABASE_ANON_KEY?.trim()
  if (!url || !anonKey) return null
  return { url: url.replace(/\/+$/, ''), anonKey }
}

export function authMode(env: Env, request: Request): 'supabase' | 'development' | 'off' {
  if (supabaseConfig(env)) return 'supabase'
  return isLoopback(request) ? 'development' : 'off'
}

type CachedUser = { user: AuthUser | null; expires: number }
const tokenCache = new Map<string, CachedUser>()

async function verifyToken(config: { url: string; anonKey: string }, token: string): Promise<AuthUser | null> {
  const cached = tokenCache.get(token)
  if (cached && cached.expires > Date.now()) return cached.user
  try {
    const response = await fetch(`${config.url}/auth/v1/user`, {
      headers: { apikey: config.anonKey, authorization: `Bearer ${token}` },
    })
    if (!response.ok) {
      tokenCache.set(token, { user: null, expires: Date.now() + 20_000 })
      return null
    }
    const body = (await response.json()) as { id?: string; email?: string; user_metadata?: Record<string, unknown> }
    if (!body.id) return null
    const metadata = body.user_metadata ?? {}
    const name = typeof metadata.name === 'string' ? metadata.name : typeof metadata.full_name === 'string' ? metadata.full_name : undefined
    const picture = typeof metadata.avatar_url === 'string' ? metadata.avatar_url : undefined
    const user: AuthUser = { sub: body.id, email: body.email, name, picture }
    if (tokenCache.size > 200) tokenCache.clear()
    tokenCache.set(token, { user, expires: Date.now() + 60_000 })
    return user
  } catch {
    return null
  }
}

export async function currentUser(env: Env, request: Request): Promise<AuthUser | null> {
  const config = supabaseConfig(env)
  if (config) {
    const header = request.headers.get('authorization') ?? ''
    const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
    if (!token) return null
    return verifyToken(config, token)
  }
  return authMode(env, request) === 'development' ? DEV_USER : null
}

export function appOrigin(env: Env, request: Request): string | null {
  return authMode(env, request) === 'off' ? null : new URL(request.url).origin
}

/** True when a mutation carries no foreign Origin (or an explicit same-origin one). */
export function sameOriginRequest(request: Request, origin: string): boolean {
  const header = request.headers.get('origin')
  if (header && header !== 'null') {
    try {
      // Compare hosts: a dev proxy or TLS terminator can change the scheme
      // the Worker sees without the caller actually crossing origins.
      return new URL(header).host === new URL(origin).host
    } catch {
      return false
    }
  }
  return request.headers.get('sec-fetch-site') === 'same-origin'
}

export function privateJson<T>(c: Context<AppContext>, body: T, status = 200) {
  c.header('Cache-Control', 'private, no-store')
  return c.json(body as never, status as never)
}

/** Requires a signed-in user and, for mutations, a same-origin request. */
export const requireUser: MiddlewareHandler<AppContext> = async (c, next) => {
  c.header('Cache-Control', 'private, no-store')
  const request = c.req.raw
  const origin = appOrigin(c.env, request)
  if (request.method !== 'GET' && request.method !== 'HEAD' && (!origin || !sameOriginRequest(request, origin))) {
    return c.json({ error: 'Cross-origin request refused.' }, 403)
  }
  const user = await currentUser(c.env, request)
  if (!user) return c.json({ error: 'Sign in required.' }, 401)
  c.set('user', user)
  await next()
}
