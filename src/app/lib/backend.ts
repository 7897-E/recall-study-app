import type { SupabaseClient } from '@supabase/supabase-js'

import type { Board, BoardDoc, BoardElement, BoardSummary, Card, Deck, Me, Note, NoteKind, Session, SessionResult, Stats, StudyMode } from '../../shared/types'
import { hueFor, newId } from '../../shared/util'
import { ApiError } from './errors'
import { seedLibrary } from './seed'
import { supabaseClient } from './supabase'

// The static build has no server: this module is the API. It implements the
// same operations the Worker used to expose, against Supabase Postgres and
// Storage. Row level security decides what a request can touch, so every query
// also filters by the signed-in user id to keep failures explicit.

const DAY = 86_400_000
const BUCKET = 'card-images'
const MAX_BODY = 20_000
const MAX_DOC = 1_500_000
const MAX_THUMB = 240_000
const MAX_ELEMENTS = 5000

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const MODES = new Set<StudyMode>(['flashcards', 'learn', 'match'])
const KINDS: NoteKind[] = ['note', 'contact', 'meeting', 'call', 'task']

interface DeckRow {
  id: string
  title: string
  description: string | null
  hue: number
  last_studied_at: number | null
  created_at: number
  updated_at: number
}

interface CardRow {
  id: string
  deck_id: string
  term: string
  definition: string
  image_key: string | null
  position: number
}

interface ProgressRow {
  card_id: string
  deck_id: string
  correct: number
  incorrect: number
  streak: number
  mastery: number
  next_due: number | null
  last_seen: number | null
}

interface SessionRow {
  id: string
  deck_id: string
  mode: StudyMode
  score: number
  total: number
  duration_ms: number
  created_at: number
}

interface NoteRow {
  id: string
  title: string
  body: string
  kind: NoteKind
  tags: unknown
  pinned: boolean
  deck_id: string | null
  created_at: number
  updated_at: number
}

interface BoardRow {
  id: string
  title: string
  doc: unknown
  thumb: string | null
  element_count: number
  created_at: number
  updated_at: number
}

export interface ApiRequest {
  json?: unknown
  body?: BodyInit | null
}

interface Auth {
  client: SupabaseClient
  owner: string
  user: { id: string; email?: string; user_metadata?: Record<string, unknown> }
}

async function context(): Promise<Auth> {
  const client = await supabaseClient()
  if (!client) {
    throw new ApiError(503, 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for the static build.')
  }
  const { data } = await client.auth.getSession()
  const user = data.session?.user
  if (!user) throw new ApiError(401, 'Sign in required.')
  return { client, owner: user.id, user }
}

function fail(error: { message: string } | null, status = 400): void {
  if (error) throw new ApiError(status, error.message)
}

const now = () => Date.now()

/** Consecutive days with at least one session, ending today or yesterday. */
function streakFrom(days: Set<string>): { current: number; longest: number } {
  const key = (d: Date) => d.toISOString().slice(0, 10)
  const cursor = new Date()
  cursor.setUTCHours(0, 0, 0, 0)
  if (!days.has(key(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1)
  let current = 0
  while (days.has(key(cursor))) {
    current++
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }
  const sorted = [...days].sort()
  let longest = 0
  let run = 0
  let previous: string | null = null
  for (const day of sorted) {
    if (previous) {
      const prev = new Date(previous)
      prev.setUTCDate(prev.getUTCDate() + 1)
      run = key(prev) === day ? run + 1 : 1
    } else run = 1
    longest = Math.max(longest, run)
    previous = day
  }
  return { current, longest: Math.max(longest, current) }
}

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10)

async function sessionDays(client: SupabaseClient, owner: string): Promise<Set<string>> {
  const { data, error } = await client.from('sessions').select('created_at').eq('owner_id', owner)
  fail(error)
  return new Set(((data ?? []) as { created_at: number }[]).map((row) => dayKey(Number(row.created_at))))
}

// Decks

interface DeckAggregate {
  cards: number
  masterySum: number
  mastered: number
  due: number
}

function mapDeck(row: DeckRow, agg?: DeckAggregate): Deck {
  const cardCount = agg?.cards ?? 0
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    hue: Number(row.hue ?? 250),
    cardCount,
    mastered: agg?.mastered ?? 0,
    mastery: cardCount ? Math.round((agg?.masterySum ?? 0) / cardCount) : 0,
    dueCount: agg?.due ?? 0,
    lastStudiedAt: row.last_studied_at == null ? null : Number(row.last_studied_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

async function deckList(client: SupabaseClient, owner: string): Promise<Deck[]> {
  const [decks, cards, progress] = await Promise.all([
    client.from('decks').select('*').eq('owner_id', owner),
    client.from('cards').select('id, deck_id').eq('owner_id', owner),
    client.from('card_progress').select('card_id, mastery, next_due').eq('owner_id', owner),
  ])
  fail(decks.error)
  const progressByCard = new Map(((progress.data ?? []) as ProgressRow[]).map((p) => [p.card_id, p]))
  const perDeck = new Map<string, DeckAggregate>()
  const cutoff = now()
  for (const card of (cards.data ?? []) as { id: string; deck_id: string }[]) {
    const bucket = perDeck.get(card.deck_id) ?? { cards: 0, masterySum: 0, mastered: 0, due: 0 }
    const row = progressByCard.get(card.id)
    const mastery = Number(row?.mastery ?? 0)
    bucket.cards++
    bucket.masterySum += mastery
    if (mastery >= 80) bucket.mastered++
    if (row?.next_due == null || Number(row.next_due) <= cutoff) bucket.due++
    perDeck.set(card.deck_id, bucket)
  }
  return ((decks.data ?? []) as DeckRow[])
    .map((row) => mapDeck(row, perDeck.get(row.id)))
    .sort((a, b) => (b.lastStudiedAt ?? b.updatedAt) - (a.lastStudiedAt ?? a.updatedAt))
}

async function mapCards(client: SupabaseClient, rows: CardRow[], progress: Map<string, ProgressRow>): Promise<Card[]> {
  const keys = rows.map((row) => row.image_key).filter((key): key is string => Boolean(key))
  const urls = new Map<string, string>()
  if (keys.length) {
    const { data } = await client.storage.from(BUCKET).createSignedUrls(keys, 3600)
    for (const entry of data ?? []) {
      if (entry.path && entry.signedUrl) urls.set(entry.path, entry.signedUrl)
    }
  }
  return rows.map((row) => {
    const p = progress.get(row.id)
    return {
      id: row.id,
      deckId: row.deck_id,
      term: row.term,
      definition: row.definition,
      hasImage: Boolean(row.image_key),
      imageUrl: row.image_key ? (urls.get(row.image_key) ?? null) : null,
      position: Number(row.position ?? 0),
      progress: {
        correct: Number(p?.correct ?? 0),
        incorrect: Number(p?.incorrect ?? 0),
        streak: Number(p?.streak ?? 0),
        mastery: Number(p?.mastery ?? 0),
        nextDue: p?.next_due == null ? null : Number(p.next_due),
        lastSeen: p?.last_seen == null ? null : Number(p.last_seen),
      },
    }
  })
}

function mapSession(row: SessionRow, deckTitle?: string): Session {
  const total = Number(row.total)
  const score = Number(row.score)
  return {
    id: row.id,
    deckId: row.deck_id,
    deckTitle,
    mode: row.mode,
    score,
    total,
    accuracy: total ? Math.round((score / total) * 100) : 0,
    durationMs: Number(row.duration_ms ?? 0),
    createdAt: Number(row.created_at),
  }
}

interface DeckInput {
  title?: string
  description?: string | null
  cards?: { term: string; definition: string }[]
}

function cleanCards(input: { term?: string; definition?: string }[] | undefined) {
  return (input ?? [])
    .map((card) => ({ term: card.term?.trim().slice(0, 300) ?? '', definition: card.definition?.trim().slice(0, 600) ?? '' }))
    .filter((card) => card.term && card.definition)
    .slice(0, 500)
}

async function createDeck(client: SupabaseClient, owner: string, input: DeckInput) {
  const title = input.title?.trim().slice(0, 80)
  if (!title) throw new ApiError(400, 'Give the deck a title.')
  const deckId = newId()
  const t = now()
  const description = input.description?.trim().slice(0, 300) || null
  const { error } = await client.from('decks').insert({
    id: deckId,
    owner_id: owner,
    title,
    description,
    hue: hueFor(title),
    created_at: t,
    updated_at: t,
  })
  fail(error)
  const cards = cleanCards(input.cards)
  if (cards.length) {
    const { error: cardError } = await client.from('cards').insert(
      cards.map((card, i) => ({ id: newId(), owner_id: owner, deck_id: deckId, term: card.term, definition: card.definition, position: i, created_at: t + i })),
    )
    fail(cardError)
  }
  return {
    deck: mapDeck({ id: deckId, title, description, hue: hueFor(title), last_studied_at: null, created_at: t, updated_at: t }, {
      cards: cards.length,
      masterySum: 0,
      mastered: 0,
      due: cards.length,
    }),
  }
}

async function deckDetail(client: SupabaseClient, owner: string, deckId: string) {
  const { data: deck, error } = await client.from('decks').select('*').eq('owner_id', owner).eq('id', deckId).maybeSingle()
  fail(error)
  if (!deck) throw new ApiError(404, 'Not found.')
  const [cards, sessions] = await Promise.all([
    client.from('cards').select('*').eq('owner_id', owner).eq('deck_id', deckId).order('position', { ascending: true }),
    client.from('sessions').select('*').eq('owner_id', owner).eq('deck_id', deckId).order('created_at', { ascending: false }).limit(10),
  ])
  fail(cards.error)
  const rows = (cards.data ?? []) as CardRow[]
  const { data: progress, error: progressError } = rows.length
    ? await client.from('card_progress').select('*').eq('owner_id', owner).in('card_id', rows.map((row) => row.id))
    : { data: [], error: null }
  fail(progressError)
  const progressByCard = new Map(((progress ?? []) as ProgressRow[]).map((p) => [p.card_id, p]))
  const mapped = await mapCards(client, rows, progressByCard)
  const aggregate: DeckAggregate = {
    cards: rows.length,
    masterySum: mapped.reduce((sum, card) => sum + card.progress.mastery, 0),
    mastered: mapped.filter((card) => card.progress.mastery >= 80).length,
    due: mapped.filter((card) => card.progress.nextDue == null || card.progress.nextDue <= now()).length,
  }
  return {
    deck: mapDeck(deck as DeckRow, aggregate),
    cards: mapped,
    sessions: ((sessions.data ?? []) as SessionRow[]).map((row) => mapSession(row)),
  }
}

async function patchDeck(client: SupabaseClient, owner: string, deckId: string, input: DeckInput) {
  const { data: existing, error } = await client.from('decks').select('*').eq('owner_id', owner).eq('id', deckId).maybeSingle()
  fail(error)
  if (!existing) throw new ApiError(404, 'Not found.')
  const row = existing as DeckRow
  const title = (input.title ?? row.title).trim().slice(0, 80)
  if (!title) throw new ApiError(400, 'Give the deck a title.')
  const description = input.description === undefined ? row.description : input.description?.trim().slice(0, 300) || null
  const { error: updateError } = await client.from('decks').update({ title, description, updated_at: now() }).eq('owner_id', owner).eq('id', deckId)
  fail(updateError)
  return { ok: true }
}

async function deleteDeck(client: SupabaseClient, owner: string, deckId: string) {
  const { data: cards } = await client.from('cards').select('image_key').eq('owner_id', owner).eq('deck_id', deckId)
  const keys = ((cards ?? []) as { image_key: string | null }[]).map((card) => card.image_key).filter((key): key is string => Boolean(key))
  // Cards, progress and sessions cascade from the deck row.
  const { error } = await client.from('decks').delete().eq('owner_id', owner).eq('id', deckId)
  fail(error)
  if (keys.length) await client.storage.from(BUCKET).remove(keys)
  return { ok: true }
}

async function addCards(client: SupabaseClient, owner: string, deckId: string, input: { cards?: { term: string; definition: string }[] }) {
  const { data: deck, error } = await client.from('decks').select('id').eq('owner_id', owner).eq('id', deckId).maybeSingle()
  fail(error)
  if (!deck) throw new ApiError(404, 'Not found.')
  const cards = cleanCards(input.cards)
  if (!cards.length) throw new ApiError(400, 'Each card needs a term and a definition.')
  const { data: top } = await client.from('cards').select('position').eq('owner_id', owner).eq('deck_id', deckId).order('position', { ascending: false }).limit(1).maybeSingle()
  const start = Number((top as { position: number } | null)?.position ?? -1) + 1
  const t = now()
  const { error: insertError } = await client.from('cards').insert(
    cards.map((card, i) => ({ id: newId(), owner_id: owner, deck_id: deckId, term: card.term, definition: card.definition, position: start + i, created_at: t + i })),
  )
  fail(insertError)
  await client.from('decks').update({ updated_at: t }).eq('owner_id', owner).eq('id', deckId)
  return { added: cards.length }
}

async function patchCard(client: SupabaseClient, owner: string, deckId: string, cardId: string, input: { term?: string; definition?: string }) {
  const [card] = cleanCards([{ term: input.term, definition: input.definition }])
  if (!card) throw new ApiError(400, 'Each card needs a term and a definition.')
  const { error } = await client.from('cards').update({ term: card.term, definition: card.definition }).eq('owner_id', owner).eq('id', cardId).eq('deck_id', deckId)
  fail(error)
  return { ok: true }
}

async function deleteCard(client: SupabaseClient, owner: string, deckId: string, cardId: string) {
  const { data: card } = await client.from('cards').select('image_key').eq('owner_id', owner).eq('id', cardId).maybeSingle()
  if (!card) throw new ApiError(404, 'Not found.')
  const { error } = await client.from('cards').delete().eq('owner_id', owner).eq('id', cardId).eq('deck_id', deckId)
  fail(error)
  const key = (card as { image_key: string | null }).image_key
  if (key) await client.storage.from(BUCKET).remove([key])
  return { ok: true }
}

async function uploadImage(client: SupabaseClient, owner: string, cardId: string, body: BodyInit | null | undefined) {
  if (!(body instanceof FormData)) throw new ApiError(400, 'Choose an image.')
  const file = body.get('file')
  if (!(file instanceof File) || !IMAGE_TYPES.has(file.type)) throw new ApiError(400, 'Choose a PNG, JPEG, WebP or GIF image.')
  if (file.size > 4 * 1024 * 1024) throw new ApiError(400, 'Images are limited to 4 MB.')
  const { data: card, error } = await client.from('cards').select('id, image_key').eq('owner_id', owner).eq('id', cardId).maybeSingle()
  fail(error)
  if (!card) throw new ApiError(404, 'Not found.')
  const key = `${owner}/cards/${cardId}/${newId()}`
  const { error: uploadError } = await client.storage.from(BUCKET).upload(key, file, { contentType: file.type, upsert: false })
  fail(uploadError)
  const { error: updateError } = await client.from('cards').update({ image_key: key }).eq('owner_id', owner).eq('id', cardId)
  fail(updateError)
  const previous = (card as { image_key: string | null }).image_key
  if (previous) await client.storage.from(BUCKET).remove([previous])
  return { ok: true }
}

async function deleteImage(client: SupabaseClient, owner: string, cardId: string) {
  const { data: card, error } = await client.from('cards').select('image_key').eq('owner_id', owner).eq('id', cardId).maybeSingle()
  fail(error)
  if (!card) throw new ApiError(404, 'Not found.')
  const { error: updateError } = await client.from('cards').update({ image_key: null }).eq('owner_id', owner).eq('id', cardId)
  fail(updateError)
  const key = (card as { image_key: string | null }).image_key
  if (key) await client.storage.from(BUCKET).remove([key])
  return { ok: true }
}

// Sessions: the client plays the round, this records it and updates each card's
// mastery and due date (a light spaced-repetition schedule).

async function recordSession(client: SupabaseClient, owner: string, deckId: string, input: { mode?: StudyMode; results?: SessionResult[]; durationMs?: number }) {
  if (!input.mode || !MODES.has(input.mode)) throw new ApiError(400, 'Unknown study mode.')
  const results = (input.results ?? []).filter((r) => typeof r.cardId === 'string' && typeof r.correct === 'boolean').slice(0, 500)
  if (!results.length) throw new ApiError(400, 'Nothing to record.')
  const { data: deck, error } = await client.from('decks').select('id').eq('owner_id', owner).eq('id', deckId).maybeSingle()
  fail(error)
  if (!deck) throw new ApiError(404, 'Not found.')

  const ids = [...new Set(results.map((r) => r.cardId))]
  const [owned, progress] = await Promise.all([
    client.from('cards').select('id').eq('owner_id', owner).eq('deck_id', deckId).in('id', ids),
    client.from('card_progress').select('*').eq('owner_id', owner).in('card_id', ids),
  ])
  fail(owned.error)
  const ownedIds = new Set(((owned.data ?? []) as { id: string }[]).map((row) => row.id))
  const byCard = new Map<string, Partial<ProgressRow>>(((progress.data ?? []) as ProgressRow[]).map((row) => [row.card_id, row]))

  const t = now()
  const upserts: Record<string, unknown>[] = []
  let score = 0
  for (const result of results) {
    if (!ownedIds.has(result.cardId)) continue
    if (result.correct) score++
    const row = byCard.get(result.cardId) ?? {}
    const correct = Number(row.correct ?? 0) + (result.correct ? 1 : 0)
    const incorrect = Number(row.incorrect ?? 0) + (result.correct ? 0 : 1)
    const streak = result.correct ? Number(row.streak ?? 0) + 1 : 0
    const previous = Number(row.mastery ?? 0)
    const mastery = result.correct ? Math.min(100, previous + Math.max(10, Math.round((100 - previous) * 0.35))) : Math.max(0, Math.round(previous * 0.5))
    const interval = result.correct ? Math.min(30, Math.pow(2, streak)) * DAY : 0
    upserts.push({ card_id: result.cardId, owner_id: owner, deck_id: deckId, correct, incorrect, streak, mastery, next_due: t + interval, last_seen: t })
    byCard.set(result.cardId, { correct, incorrect, streak, mastery })
  }
  fail((await client.from('card_progress').upsert(upserts, { onConflict: 'card_id' })).error)

  const total = results.filter((result) => ownedIds.has(result.cardId)).length
  const sessionId = newId()
  fail(
    (
      await client.from('sessions').insert({
        id: sessionId,
        owner_id: owner,
        deck_id: deckId,
        mode: input.mode,
        score,
        total,
        duration_ms: Math.max(0, Math.round(Number(input.durationMs) || 0)),
        created_at: t,
      })
    ).error,
  )
  fail((await client.from('decks').update({ last_studied_at: t, updated_at: t }).eq('owner_id', owner).eq('id', deckId)).error)
  return { session: { id: sessionId, score, total, accuracy: total ? Math.round((score / total) * 100) : 0 } }
}

// Notes

function cleanTags(input: unknown): string[] {
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

function tagsOf(value: unknown): string[] {
  if (Array.isArray(value)) return cleanTags(value)
  if (typeof value === 'string') {
    try {
      return cleanTags(JSON.parse(value))
    } catch {
      return []
    }
  }
  return []
}

function kindOf(input: unknown, fallback: NoteKind): NoteKind {
  return typeof input === 'string' && (KINDS as string[]).includes(input) ? (input as NoteKind) : fallback
}

function mapNote(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title ?? '',
    body: row.body ?? '',
    kind: kindOf(row.kind, 'note'),
    tags: tagsOf(row.tags),
    pinned: Boolean(row.pinned),
    deckId: row.deck_id ?? null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

function cleanBody(input: unknown, fallback: string): string {
  if (input === undefined) return fallback
  return typeof input === 'string' ? input.slice(0, MAX_BODY) : ''
}

async function listNotes(client: SupabaseClient, owner: string) {
  const { data, error } = await client.from('notes').select('*').eq('owner_id', owner).order('pinned', { ascending: false }).order('updated_at', { ascending: false }).limit(500)
  fail(error)
  return { items: ((data ?? []) as NoteRow[]).map(mapNote) }
}

async function createNote(client: SupabaseClient, owner: string, input: Partial<Note>) {
  const noteId = newId()
  const t = now()
  const { error } = await client.from('notes').insert({
    id: noteId,
    owner_id: owner,
    title: typeof input.title === 'string' ? input.title.trim().slice(0, 120) : '',
    body: cleanBody(input.body, ''),
    kind: kindOf(input.kind, 'note'),
    tags: cleanTags(input.tags),
    pinned: Boolean(input.pinned),
    deck_id: typeof input.deckId === 'string' && input.deckId ? input.deckId : null,
    created_at: t,
    updated_at: t,
  })
  fail(error)
  const { data, error: readError } = await client.from('notes').select('*').eq('owner_id', owner).eq('id', noteId).maybeSingle()
  fail(readError)
  return { note: mapNote(data as NoteRow) }
}

async function patchNote(client: SupabaseClient, owner: string, noteId: string, input: Partial<Note>) {
  const { data: existing, error } = await client.from('notes').select('*').eq('owner_id', owner).eq('id', noteId).maybeSingle()
  fail(error)
  if (!existing) throw new ApiError(404, 'Not found.')
  const row = existing as NoteRow
  const tags = input.tags === undefined ? tagsOf(row.tags) : cleanTags(input.tags)
  const deckId = input.deckId === undefined ? (row.deck_id ?? null) : typeof input.deckId === 'string' && input.deckId ? input.deckId : null
  const { error: updateError } = await client
    .from('notes')
    .update({
      title: typeof input.title === 'string' ? input.title.trim().slice(0, 120) : row.title,
      body: cleanBody(input.body, row.body ?? ''),
      kind: kindOf(input.kind, kindOf(row.kind, 'note')),
      tags,
      pinned: input.pinned === undefined ? Boolean(row.pinned) : Boolean(input.pinned),
      deck_id: deckId,
      updated_at: now(),
    })
    .eq('owner_id', owner)
    .eq('id', noteId)
  fail(updateError)
  const { data, error: readError } = await client.from('notes').select('*').eq('owner_id', owner).eq('id', noteId).maybeSingle()
  fail(readError)
  return { note: mapNote(data as NoteRow) }
}

async function deleteNote(client: SupabaseClient, owner: string, noteId: string) {
  const { error } = await client.from('notes').delete().eq('owner_id', owner).eq('id', noteId)
  fail(error)
  return { ok: true }
}

// Studio boards

function emptyBoardDoc(): BoardDoc {
  return { version: 1, background: '#fbfaf7', grid: 'dots', elements: [] }
}

function cleanDoc(input: unknown): { json: string; doc: BoardDoc } | null {
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

function mapSummary(row: BoardRow): BoardSummary {
  return {
    id: row.id,
    title: row.title ?? 'Untitled board',
    thumb: row.thumb ?? null,
    elementCount: Number(row.element_count ?? 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

function docOf(row: BoardRow): BoardDoc {
  const cleaned = cleanDoc(row.doc)
  return cleaned?.doc ?? emptyBoardDoc()
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

async function listBoards(client: SupabaseClient, owner: string) {
  const { data, error } = await client
    .from('boards')
    .select('id, title, thumb, element_count, created_at, updated_at')
    .eq('owner_id', owner)
    .order('updated_at', { ascending: false })
    .limit(200)
  fail(error)
  return { items: ((data ?? []) as BoardRow[]).map(mapSummary) }
}

async function createBoard(client: SupabaseClient, owner: string, input: { title?: string; doc?: BoardDoc }) {
  const boardId = newId()
  const t = now()
  let doc = emptyBoardDoc()
  if (input.doc !== undefined) {
    const cleaned = cleanDoc(input.doc)
    if (!cleaned) throw new ApiError(400, 'That board document is not valid or is too large.')
    doc = cleaned.doc
  }
  const title = cleanTitle(input.title, 'Untitled board')
  const { error } = await client.from('boards').insert({
    id: boardId,
    owner_id: owner,
    title,
    doc,
    thumb: null,
    element_count: doc.elements.length,
    created_at: t,
    updated_at: t,
  })
  fail(error)
  const board: Board = { id: boardId, title, thumb: null, elementCount: doc.elements.length, createdAt: t, updatedAt: t, doc }
  return { board }
}

async function getBoard(client: SupabaseClient, owner: string, boardId: string) {
  const { data, error } = await client.from('boards').select('*').eq('owner_id', owner).eq('id', boardId).maybeSingle()
  fail(error)
  if (!data) throw new ApiError(404, 'Not found.')
  const row = data as BoardRow
  const board: Board = { ...mapSummary(row), doc: docOf(row) }
  return { board }
}

async function saveBoard(client: SupabaseClient, owner: string, boardId: string, input: { title?: string; doc?: BoardDoc; thumb?: string | null }) {
  const { data: existing, error } = await client.from('boards').select('*').eq('owner_id', owner).eq('id', boardId).maybeSingle()
  fail(error)
  if (!existing) throw new ApiError(404, 'Not found.')
  const row = existing as BoardRow
  const cleaned = cleanDoc(input.doc)
  if (!cleaned) throw new ApiError(400, 'That board document is not valid or is too large.')
  const title = cleanTitle(input.title, row.title ?? 'Untitled board')
  const thumb = input.thumb === null ? null : (cleanThumb(input.thumb) ?? row.thumb ?? null)
  const updatedAt = now()
  const { error: updateError } = await client
    .from('boards')
    .update({ title, doc: cleaned.doc, thumb, element_count: cleaned.doc.elements.length, updated_at: updatedAt })
    .eq('owner_id', owner)
    .eq('id', boardId)
  fail(updateError)
  return { ok: true, updatedAt, elementCount: cleaned.doc.elements.length }
}

async function renameBoard(client: SupabaseClient, owner: string, boardId: string, input: { title?: string }) {
  const { data: existing, error } = await client.from('boards').select('title').eq('owner_id', owner).eq('id', boardId).maybeSingle()
  fail(error)
  if (!existing) throw new ApiError(404, 'Not found.')
  const title = cleanTitle(input.title, (existing as { title: string }).title)
  fail((await client.from('boards').update({ title, updated_at: now() }).eq('owner_id', owner).eq('id', boardId)).error)
  return { ok: true, title }
}

async function deleteBoard(client: SupabaseClient, owner: string, boardId: string) {
  const { error } = await client.from('boards').delete().eq('owner_id', owner).eq('id', boardId)
  fail(error)
  return { ok: true }
}

// Account

async function me(client: SupabaseClient, auth: Auth): Promise<Me> {
  const owner = auth.owner
  const [{ data: profile, error }, days] = await Promise.all([
    client.from('profiles').select('id, seeded_at').eq('id', owner).maybeSingle(),
    sessionDays(client, owner),
  ])
  fail(error)
  let seeded = Boolean((profile as { seeded_at: number | null } | null)?.seeded_at)
  if (!profile) {
    const { error: insertError } = await client.from('profiles').insert({ id: owner, created_at: now() })
    if (!insertError) {
      // First visit: furnish the library with sample decks and some history.
      await seedLibrary(client, owner)
      seeded = true
    } else if (insertError.code === '23503') {
      // The auth user behind this session was deleted; drop the dead session so
      // the app falls back to the sign-in screen instead of an error page.
      await client.auth.signOut({ scope: 'local' })
      throw new ApiError(401, 'That account no longer exists. Sign in again.')
    } else if (insertError.code !== '23505') {
      throw new ApiError(400, insertError.message)
    }
  }
  const metadata = auth.user.user_metadata ?? {}
  const name = typeof metadata.name === 'string' ? metadata.name : typeof metadata.full_name === 'string' ? metadata.full_name : undefined
  const picture = typeof metadata.avatar_url === 'string' ? metadata.avatar_url : undefined
  return {
    user: { sub: owner, name, email: auth.user.email, picture },
    streak: streakFrom(days).current,
    seeded,
    capabilities: { database: true, files: true, auth: 'supabase' },
  }
}

async function stats(client: SupabaseClient, owner: string): Promise<Stats> {
  const since = now() - 84 * DAY
  const [sessions, decks] = await Promise.all([
    client.from('sessions').select('*').eq('owner_id', owner).order('created_at', { ascending: false }).limit(2000),
    deckList(client, owner),
  ])
  fail(sessions.error)
  const rows = (sessions.data ?? []) as SessionRow[]
  const titles = new Map(decks.map((deck) => [deck.id, deck.title]))
  const byDay = new Map<string, { n: number; s: number; t: number }>()
  let ms = 0
  for (const row of rows) {
    ms += Number(row.duration_ms ?? 0)
    if (Number(row.created_at) < since) continue
    const key = dayKey(Number(row.created_at))
    const bucket = byDay.get(key) ?? { n: 0, s: 0, t: 0 }
    bucket.n++
    bucket.s += Number(row.score)
    bucket.t += Number(row.total)
    byDay.set(key, bucket)
  }
  const series: Stats['days'] = []
  const cursor = new Date()
  cursor.setUTCHours(0, 0, 0, 0)
  cursor.setUTCDate(cursor.getUTCDate() - 83)
  for (let i = 0; i < 84; i++) {
    const key = cursor.toISOString().slice(0, 10)
    const bucket = byDay.get(key)
    series.push({ date: key, sessions: bucket?.n ?? 0, accuracy: bucket && bucket.t ? Math.round((bucket.s / bucket.t) * 100) : null })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  const streak = streakFrom(new Set(rows.map((row) => dayKey(Number(row.created_at)))))
  return {
    streak: streak.current,
    longestStreak: streak.longest,
    sessions: rows.length,
    cardsMastered: decks.reduce((sum, deck) => sum + deck.mastered, 0),
    cardsTotal: decks.reduce((sum, deck) => sum + deck.cardCount, 0),
    minutes: Math.round(ms / 60_000),
    days: series,
    recent: rows.slice(0, 12).map((row) => mapSession(row, titles.get(row.deck_id))),
    decks: decks.map((deck) => ({ id: deck.id, title: deck.title, hue: deck.hue, mastery: deck.mastery, cardCount: deck.cardCount })),
  }
}

async function clearAccount(client: SupabaseClient, owner: string) {
  const { data: cards } = await client.from('cards').select('image_key').eq('owner_id', owner)
  const keys = ((cards ?? []) as { image_key: string | null }[]).map((card) => card.image_key).filter((key): key is string => Boolean(key))
  const [decks, notes, boards] = await Promise.all([
    client.from('decks').delete().eq('owner_id', owner),
    client.from('notes').delete().eq('owner_id', owner),
    client.from('boards').delete().eq('owner_id', owner),
  ])
  fail(decks.error)
  fail(notes.error)
  fail(boards.error)
  if (keys.length) await client.storage.from(BUCKET).remove(keys)
  await client.from('profiles').update({ seeded_at: null }).eq('id', owner)
  return { ok: true }
}

async function resetAccount(client: SupabaseClient, owner: string) {
  await clearAccount(client, owner)
  await seedLibrary(client, owner)
  return { ok: true }
}

/**
 * Routes the small `/api`-style surface the hooks use onto Supabase, so the UI
 * keeps one call shape whether it runs against the Worker or the static build.
 */
export async function handleApi(method: string, path: string, init: ApiRequest = {}): Promise<unknown> {
  const { client, owner, user } = await context()
  const parts = path.split('?')[0].split('/').filter(Boolean)
  const [root, a, b, c, d] = parts
  const json = init.json

  if (root === 'me' && !a) return me(client, { client, owner, user })
  if (root === 'stats' && !a) return stats(client, owner)
  if (root === 'account' && a === 'reset') return resetAccount(client, owner)
  if (root === 'account' && a === 'data') return clearAccount(client, owner)

  if (root === 'decks') {
    if (!a) {
      if (method === 'GET') return { items: await deckList(client, owner) }
      if (method === 'POST') return createDeck(client, owner, (json ?? {}) as DeckInput)
    }
    if (a && !b) {
      if (method === 'GET') return deckDetail(client, owner, a)
      if (method === 'PATCH') return patchDeck(client, owner, a, (json ?? {}) as DeckInput)
      if (method === 'DELETE') return deleteDeck(client, owner, a)
    }
    if (a && b === 'cards' && !c && method === 'POST') {
      return addCards(client, owner, a, (json ?? {}) as { cards?: { term: string; definition: string }[] })
    }
    if (a && b === 'cards' && c) {
      if (!d && method === 'PATCH') return patchCard(client, owner, a, c, (json ?? {}) as { term?: string; definition?: string })
      if (!d && method === 'DELETE') return deleteCard(client, owner, a, c)
      if (d === 'image' && method === 'PUT') return uploadImage(client, owner, c, init.body)
      if (d === 'image' && method === 'DELETE') return deleteImage(client, owner, c)
    }
    if (a && b === 'sessions' && method === 'POST') {
      return recordSession(client, owner, a, (json ?? {}) as { mode?: StudyMode; results?: SessionResult[]; durationMs?: number })
    }
  }

  if (root === 'notes') {
    if (!a) {
      if (method === 'GET') return listNotes(client, owner)
      if (method === 'POST') return createNote(client, owner, (json ?? {}) as Partial<Note>)
    }
    if (a) {
      if (method === 'PATCH') return patchNote(client, owner, a, (json ?? {}) as Partial<Note>)
      if (method === 'DELETE') return deleteNote(client, owner, a)
    }
  }

  if (root === 'boards') {
    if (!a) {
      if (method === 'GET') return listBoards(client, owner)
      if (method === 'POST') return createBoard(client, owner, (json ?? {}) as { title?: string; doc?: BoardDoc })
    }
    if (a) {
      if (method === 'GET') return getBoard(client, owner, a)
      if (method === 'PUT') return saveBoard(client, owner, a, (json ?? {}) as { title?: string; doc?: BoardDoc; thumb?: string | null })
      if (method === 'PATCH') return renameBoard(client, owner, a, (json ?? {}) as { title?: string })
      if (method === 'DELETE') return deleteBoard(client, owner, a)
    }
  }

  throw new ApiError(404, 'Not found.')
}
