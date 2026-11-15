// Types shared by the Worker (src/worker) and the app (src/app).

export const BRAND = 'Recall'

export type StudyMode = 'flashcards' | 'learn' | 'match'

export interface Deck {
  id: string
  title: string
  description: string | null
  hue: number
  cardCount: number
  mastered: number
  mastery: number
  dueCount: number
  lastStudiedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface Card {
  id: string
  deckId: string
  term: string
  definition: string
  hasImage: boolean
  /** Short-lived signed URL for the card image, resolved when the deck loads. */
  imageUrl?: string | null
  position: number
  progress: { correct: number; incorrect: number; streak: number; mastery: number; nextDue: number | null; lastSeen: number | null }
}

export interface Session {
  id: string
  deckId: string
  deckTitle?: string
  mode: StudyMode
  score: number
  total: number
  accuracy: number
  durationMs: number
  createdAt: number
}

export interface Me {
  user: { sub: string; name?: string; email?: string; picture?: string }
  streak: number
  seeded: boolean
  capabilities: { database: boolean; files: boolean; auth: 'supabase' | 'development' }
}

export interface Stats {
  streak: number
  longestStreak: number
  sessions: number
  cardsMastered: number
  cardsTotal: number
  minutes: number
  days: { date: string; sessions: number; accuracy: number | null }[]
  recent: Session[]
  decks: { id: string; title: string; hue: number; mastery: number; cardCount: number }[]
}

export interface SessionResult {
  cardId: string
  correct: boolean
}

// Notes: a lightweight CRM-style notebook scoped to the signed-in user.
export type NoteKind = 'note' | 'contact' | 'meeting' | 'call' | 'task'

export const NOTE_KINDS: { id: NoteKind; label: string }[] = [
  { id: 'note', label: 'Note' },
  { id: 'contact', label: 'Contact' },
  { id: 'meeting', label: 'Meeting' },
  { id: 'call', label: 'Call' },
  { id: 'task', label: 'Task' },
]

export interface Note {
  id: string
  title: string
  body: string
  kind: NoteKind
  tags: string[]
  pinned: boolean
  deckId: string | null
  createdAt: number
  updatedAt: number
}

// Studio: an infinite whiteboard / artboard document. Elements are axis
// aligned boxes rotated about their centre, except strokes which keep their
// own points; lines and arrows keep two endpoints.
export type BoardGrid = 'dots' | 'lines' | 'blank'

export interface BoardPoint {
  x: number
  y: number
}

export type BoardElementKind = 'stroke' | 'highlight' | 'rect' | 'ellipse' | 'diamond' | 'triangle' | 'line' | 'arrow' | 'text' | 'note'

export interface BoardElement {
  id: string
  kind: BoardElementKind
  x: number
  y: number
  w: number
  h: number
  angle: number
  opacity: number
  fill: string | null
  stroke: string
  strokeWidth: number
  points?: BoardPoint[]
  a?: BoardPoint
  b?: BoardPoint
  text?: string
  fontSize?: number
  bold?: boolean
  align?: 'left' | 'center' | 'right'
  dashed?: boolean
  hidden?: boolean
  locked?: boolean
}

export interface BoardDoc {
  version: 1
  background: string
  grid: BoardGrid
  elements: BoardElement[]
}

export interface BoardSummary {
  id: string
  title: string
  thumb: string | null
  elementCount: number
  createdAt: number
  updatedAt: number
}

export interface Board extends BoardSummary {
  doc: BoardDoc
}
