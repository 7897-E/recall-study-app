import { Hono } from 'hono'

import { privateJson } from '../auth'
import { id, now } from '../db'
import type { AppContext } from '../env'
import type { Note, NoteKind } from '../../shared/types'

// Notes are the lightweight CRM layer: one row per note, kind tells you whether
// it is a plain note, a person, a meeting, a call or a task. Tags are stored as
// a JSON array so filtering stays a client concern (lists are small).

export const notes = new Hono<AppContext>()

const KINDS: NoteKind[] = ['note', 'contact', 'meeting', 'call', 'task']
const MAX_BODY = 20_000

type Row = Record<string, unknown>

export function cleanTags(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const tags: string[] = []
  for (const value of input) {
    if (typeof value !== 'string') continue
    const tag = value.trim().replace(/\s+/g, ' ').slice(0, 24)
    if (!tag) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
    if (tags.length >= 10) break
  }
  return tags
}

function parseTags(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  try {
    return cleanTags(JSON.parse(raw))
  } catch {
    return []
  }
}

function kindOf(input: unknown, fallback: NoteKind): NoteKind {
  return typeof input === 'string' && (KINDS as string[]).includes(input) ? (input as NoteKind) : fallback
}

function mapNote(row: Row): Note {
  return {
    id: row.id as string,
    title: (row.title as string) ?? '',
    body: (row.body as string) ?? '',
    kind: kindOf(row.kind, 'note'),
    tags: parseTags(row.tags),
    pinned: Boolean(row.pinned),
    deckId: (row.deck_id as string | null) ?? null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

function cleanBody(input: unknown, fallback: string): string {
  if (input === undefined) return fallback
  return typeof input === 'string' ? input.slice(0, MAX_BODY) : ''
}

notes.get('/', async (c) => {
  const rows = await c
    .get('db')
    .prepare(`SELECT * FROM notes WHERE owner_sub = ? ORDER BY pinned DESC, updated_at DESC LIMIT 500`)
    .bind(c.get('user').sub)
    .all()
  return privateJson(c, { items: (rows.results as Row[]).map(mapNote) })
})

notes.post('/', async (c) => {
  const db = c.get('db')
  const owner = c.get('user').sub
  const input = await c.req.json<Partial<Note>>().catch(() => ({} as Partial<Note>))
  const noteId = id()
  const t = now()
  const title = typeof input.title === 'string' ? input.title.trim().slice(0, 120) : ''
  const kind = kindOf(input.kind, 'note')
  const tags = cleanTags(input.tags)
  const deckId = typeof input.deckId === 'string' && input.deckId ? input.deckId : null
  await db
    .prepare(`INSERT INTO notes (id, owner_sub, title, body, kind, tags, pinned, deck_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(noteId, owner, title, cleanBody(input.body, ''), kind, JSON.stringify(tags), input.pinned ? 1 : 0, deckId, t, t)
    .run()
  const row = await db.prepare(`SELECT * FROM notes WHERE owner_sub = ? AND id = ?`).bind(owner, noteId).first()
  return privateJson(c, { note: mapNote(row as Row) }, 201)
})

notes.patch('/:id', async (c) => {
  const db = c.get('db')
  const owner = c.get('user').sub
  const existing = await db.prepare(`SELECT * FROM notes WHERE owner_sub = ? AND id = ?`).bind(owner, c.req.param('id')).first<Row>()
  if (!existing) return c.json({ error: 'Not found.' }, 404)
  const input = await c.req.json<Partial<Note>>().catch(() => ({} as Partial<Note>))
  const title = typeof input.title === 'string' ? input.title.trim().slice(0, 120) : (existing.title as string)
  const body = cleanBody(input.body, (existing.body as string) ?? '')
  const kind = kindOf(input.kind, kindOf(existing.kind, 'note'))
  const tags = input.tags === undefined ? parseTags(existing.tags) : cleanTags(input.tags)
  const pinned = input.pinned === undefined ? Boolean(existing.pinned) : Boolean(input.pinned)
  const deckId = input.deckId === undefined ? ((existing.deck_id as string | null) ?? null) : typeof input.deckId === 'string' && input.deckId ? input.deckId : null
  await db
    .prepare(`UPDATE notes SET title = ?, body = ?, kind = ?, tags = ?, pinned = ?, deck_id = ?, updated_at = ? WHERE owner_sub = ? AND id = ?`)
    .bind(title, body, kind, JSON.stringify(tags), pinned ? 1 : 0, deckId, now(), owner, c.req.param('id'))
    .run()
  const row = await db.prepare(`SELECT * FROM notes WHERE owner_sub = ? AND id = ?`).bind(owner, c.req.param('id')).first()
  return privateJson(c, { note: mapNote(row as Row) })
})

notes.delete('/:id', async (c) => {
  const result = await c.get('db').prepare(`DELETE FROM notes WHERE owner_sub = ? AND id = ?`).bind(c.get('user').sub, c.req.param('id')).run()
  if (!result.meta.changes) return c.json({ error: 'Not found.' }, 404)
  return privateJson(c, { ok: true })
})
