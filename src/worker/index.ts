import { Hono } from 'hono'

import { authMode, requireUser, supabaseConfig } from './auth'
import { requireDb } from './db'
import type { AppContext, Env } from './env'
import { account } from './routes/account'
import { boards } from './routes/boards'
import { decks } from './routes/decks'
import { notes } from './routes/notes'

const app = new Hono<AppContext>()

app.get('/api/auth/status', (c) => {
  const config = supabaseConfig(c.env)
  c.header('Cache-Control', 'private, no-store')
  return c.json({
    mode: authMode(c.env, c.req.raw),
    database: Boolean(c.env.DB),
    files: Boolean(c.env.FILES),
    // Public by design: the browser needs these to talk to Supabase Auth.
    supabase: config ? { url: config.url, anonKey: config.anonKey } : null,
  })
})
app.get('/api/health', (c) => c.json({ ok: true }))

const api = new Hono<AppContext>()
api.use('*', requireUser, requireDb)
api.route('/', account)
api.route('/decks', decks)
api.route('/notes', notes)
api.route('/boards', boards)
app.route('/api', api)

app.onError((error, c) => {
  console.error(error)
  return c.json({ error: 'Something went wrong.' }, 500)
})
app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'Not found.' }, 404) : c.env.ASSETS.fetch(c.req.raw)))

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return Promise.resolve(app.fetch(request, env, ctx))
  },
}
