import { expect, test } from 'bun:test'
import { Hono } from 'hono'

import { appOrigin, authMode, currentUser, requireUser } from '../src/worker/auth'
import type { AppContext, Env } from '../src/worker/env'

const loopback = new Request('http://localhost:5173/')
const supabaseEnv = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'anon-key' } as Env

test('only an unconfigured loopback origin gets a development user', async () => {
  expect(authMode({} as Env, loopback)).toBe('development')
  expect(await currentUser({} as Env, loopback)).toMatchObject({ sub: 'dev-user' })
  expect(authMode({} as Env, new Request('https://app.example.test/'))).toBe('off')
  expect(await currentUser({} as Env, new Request('https://app.example.test/'))).toBeNull()
})

test('configured Supabase takes over and needs a bearer token', async () => {
  expect(authMode(supabaseEnv, loopback)).toBe('supabase')
  expect(await currentUser(supabaseEnv, loopback)).toBeNull()
  expect(appOrigin(supabaseEnv, new Request('https://app.example.test/x'))).toBe('https://app.example.test')
})

test('access tokens are verified against the project and cached per token', async () => {
  const calls: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    calls.push(`${String(input)}|${headers.get('apikey') ?? ''}`)
    if (headers.get('authorization') === 'Bearer good') {
      return new Response(JSON.stringify({ id: 'user-1', email: 'ada@example.com', user_metadata: { full_name: 'Ada Lovelace' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('{}', { status: 401 })
  }) as typeof fetch

  try {
    const request = new Request('https://app.example.test/', { headers: { authorization: 'Bearer good' } })
    expect(await currentUser(supabaseEnv, request)).toEqual({ sub: 'user-1', email: 'ada@example.com', name: 'Ada Lovelace', picture: undefined })
    await currentUser(supabaseEnv, request)
    expect(calls.length).toBe(1)
    expect(calls[0]).toContain('/auth/v1/user')
    expect(calls[0]).toContain('anon-key')

    const bad = new Request('https://app.example.test/', { headers: { authorization: 'Bearer bad' } })
    expect(await currentUser(supabaseEnv, bad)).toBeNull()
  } finally {
    globalThis.fetch = original
  }
})

test('private routes refuse anonymous and foreign-origin requests without caching them', async () => {
  const app = new Hono<AppContext>()
  app.use('*', requireUser)
  app.all('*', (c) => c.json({ user: c.get('user').sub }))

  const anonymous = await app.request('https://app.example.test/private', {}, {} as Env)
  expect(anonymous.status).toBe(401)
  expect(anonymous.headers.get('Cache-Control')).toBe('private, no-store')

  for (const origin of ['https://foreign.example', '']) {
    const response = await app.request('http://localhost:5173/private', { method: 'POST', headers: { Origin: origin } }, {} as Env)
    expect(response.status).toBe(403)
  }

  const own = await app.request('http://localhost:5173/private', { method: 'POST', headers: { Origin: 'http://localhost:5173' } }, {} as Env)
  expect(own.status).toBe(200)

  // A proxy or TLS terminator can change the scheme without crossing origins.
  const upgraded = await app.request('http://localhost:5173/private', { method: 'POST', headers: { Origin: 'https://localhost:5173' } }, {} as Env)
  expect(upgraded.status).toBe(200)
})
