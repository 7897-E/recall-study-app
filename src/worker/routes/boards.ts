import { Hono } from 'hono'

import { privateJson } from '../auth'
import { id, now } from '../db'
import type { AppContext } from '../env'
import type { Board, BoardDoc, BoardElement, BoardSummary } from '../../shared/types'

// A board is one JSON document (elements plus canvas settings) owned by the
// signed-in user. The Worker validates the shape and the size, then stores it
// verbatim; the studio in src/app/components/board owns the drawing model.

const MAX_DOC = 1_500_000
const MAX_THUMB = 240_000
const MAX_ELEMENTS = 5000

type Row = Record<string, unknown>

export const boards = new Hono<AppContext>()

export function emptyBoardDoc(): BoardDoc {
  return { version: 1, background: '#fbfaf7', grid: 'dots', elements: [] }
}

function mapSummary(row: Row): BoardSummary {
  return {
    id: row.id as string,
    title: (row.title as string) ?? 'Untitled board',
    thumb: (row.thumb as string | null) ?? null,
    elementCount: Number(row.element_count ?? 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

function parseDoc(raw: unknown): BoardDoc {
  if (typeof raw !== 'string') return emptyBoardDoc()
  try {
    return cleanDoc(JSON.parse(raw))?.doc ?? emptyBoardDoc()
  } catch {
    return emptyBoardDoc()
  }
}

export function cleanDoc(input: unknown): { json: string; doc: BoardDoc } | null {
  if (!input || typeof input !== 'object') return null
  const candidate = input as Partial<BoardDoc>
  if (!Array.isArray(candidate.elements)) return null
  const elements = candidate.elements
    .slice(0, MAX_ELEMENTS)
    .filter((el): el is BoardElement => Boolean(el) && typeof el === 'object' && typeof (el as BoardElement).id === 'string' && typeof (el as BoardElement).kind === 'string')
  const doc: BoardDoc = {
    version: 1,
    background: typeof candidate.background === 'string' && /^#[0-9a-f]{3,8}$/i.test(candidate.background) ? candidate.background : '#fbfaf7',
    grid: candidate.grid === 'lines' || candidate.grid === 'blank' ? candidate.grid : 'dots',
    elements,
  }
  const json = JSON.stringify(doc)
  if (json.length > MAX_DOC) return null
  return { json, doc }
}

function cleanThumb(input: unknown): string | null {
  if (typeof input !== 'string') return null
  if (!input.startsWith('data:image/') || input.length > MAX_THUMB) return null
  return input
}

function cleanTitle(input: unknown, fallback: string): string {
  if (typeof input !== 'string') return fallback
  return input.trim().slice(0, 80) || fallback
}

boards.get('/', async (c) => {
  const rows = await c
    .get('db')
    .prepare(`SELECT id, title, thumb, element_count, created_at, updated_at FROM boards WHERE owner_sub = ? ORDER BY updated_at DESC LIMIT 200`)
    .bind(c.get('user').sub)
    .all()
  return privateJson(c, { items: (rows.results as Row[]).map(mapSummary) })
})

boards.post('/', async (c) => {
  const db = c.get('db')
  const owner = c.get('user').sub
  const input = await c.req.json<{ title?: string; doc?: BoardDoc }>().catch(() => ({} as { title?: string; doc?: BoardDoc }))
  const boardId = id()
  const t = now()
  let doc = emptyBoardDoc()
  if (input.doc !== undefined) {
    const cleaned = cleanDoc(input.doc)
    if (!cleaned) return c.json({ error: 'That board document is not valid or is too large.' }, 400)
    doc = cleaned.doc
  }
  await db
    .prepare(`INSERT INTO boards (id, owner_sub, title, doc, thumb, element_count, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`)
    .bind(boardId, owner, cleanTitle(input.title, 'Untitled board'), JSON.stringify(doc), doc.elements.length, t, t)
    .run()
  const row = await db.prepare(`SELECT * FROM boards WHERE owner_sub = ? AND id = ?`).bind(owner, boardId).first()
  return privateJson(c, { board: { ...mapSummary(row as Row), doc } }, 201)
})

boards.get('/:id', async (c) => {
  const row = await c.get('db').prepare(`SELECT * FROM boards WHERE owner_sub = ? AND id = ?`).bind(c.get('user').sub, c.req.param('id')).first<Row>()
  if (!row) return c.json({ error: 'Not found.' }, 404)
  const board: Board = { ...mapSummary(row), doc: parseDoc(row.doc) }
  return privateJson(c, { board })
})

boards.put('/:id', async (c) => {
  const db = c.get('db')
  const owner = c.get('user').sub
  const boardId = c.req.param('id')
  const existing = await db.prepare(`SELECT * FROM boards WHERE owner_sub = ? AND id = ?`).bind(owner, boardId).first<Row>()
  if (!existing) return c.json({ error: 'Not found.' }, 404)
  const input = await c.req.json<{ title?: string; doc?: BoardDoc; thumb?: string | null }>().catch(() => ({} as { title?: string; doc?: BoardDoc; thumb?: string | null }))
  const cleaned = cleanDoc(input.doc)
  if (!cleaned) return c.json({ error: 'That board document is not valid or is too large.' }, 400)
  const title = cleanTitle(input.title, (existing.title as string) ?? 'Untitled board')
  const thumb = input.thumb === null ? null : cleanThumb(input.thumb) ?? ((existing.thumb as string | null) ?? null)
  await db
    .prepare(`UPDATE boards SET title = ?, doc = ?, thumb = ?, element_count = ?, updated_at = ? WHERE owner_sub = ? AND id = ?`)
    .bind(title, cleaned.json, thumb, cleaned.doc.elements.length, now(), owner, boardId)
    .run()
  return privateJson(c, { ok: true, updatedAt: now(), elementCount: cleaned.doc.elements.length })
})

boards.patch('/:id', async (c) => {
  const db = c.get('db')
  const owner = c.get('user').sub
  const boardId = c.req.param('id')
  const existing = await db.prepare(`SELECT title FROM boards WHERE owner_sub = ? AND id = ?`).bind(owner, boardId).first<{ title: string }>()
  if (!existing) return c.json({ error: 'Not found.' }, 404)
  const input = await c.req.json<{ title?: string }>().catch(() => ({} as { title?: string }))
  const title = cleanTitle(input.title, existing.title)
  await db.prepare(`UPDATE boards SET title = ?, updated_at = ? WHERE owner_sub = ? AND id = ?`).bind(title, now(), owner, boardId).run()
  return privateJson(c, { ok: true, title })
})

boards.delete('/:id', async (c) => {
  const result = await c.get('db').prepare(`DELETE FROM boards WHERE owner_sub = ? AND id = ?`).bind(c.get('user').sub, c.req.param('id')).run()
  if (!result.meta.changes) return c.json({ error: 'Not found.' }, 404)
  return privateJson(c, { ok: true })
})
