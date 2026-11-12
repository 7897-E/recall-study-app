import { hueFor, id } from './db'
import type { BoardDoc, NoteKind } from '../shared/types'

const DAY = 86_400_000

const decks: { title: string; description: string; cards: [string, string][] }[] = [
  {
    title: 'Spanish essentials',
    description: 'The hundred words that get you through a weekend in Madrid.',
    cards: [
      ['hola', 'hello'],
      ['gracias', 'thank you'],
      ['por favor', 'please'],
      ['la cuenta', 'the bill'],
      ['¿dónde está?', 'where is?'],
      ['la estación', 'the station'],
      ['el desayuno', 'breakfast'],
      ['la cena', 'dinner'],
      ['agua', 'water'],
      ['vino tinto', 'red wine'],
      ['izquierda', 'left'],
      ['derecha', 'right'],
      ['mañana', 'tomorrow, or morning'],
      ['ahora', 'now'],
      ['lo siento', 'I am sorry'],
      ['¿cuánto cuesta?', 'how much does it cost?'],
    ],
  },
  {
    title: 'Cell biology',
    description: 'Organelles and what they do. Chapter three.',
    cards: [
      ['Mitochondrion', 'Produces ATP through cellular respiration'],
      ['Ribosome', 'Builds proteins from amino acids using mRNA'],
      ['Nucleus', 'Holds the genetic material and controls the cell'],
      ['Golgi apparatus', 'Modifies, sorts and packages proteins for transport'],
      ['Lysosome', 'Breaks down waste and worn-out cell parts with enzymes'],
      ['Endoplasmic reticulum', 'Network of membranes for protein and lipid synthesis'],
      ['Chloroplast', 'Site of photosynthesis in plant cells'],
      ['Cell membrane', 'Controls what enters and leaves the cell'],
      ['Cytoskeleton', 'Protein filaments that give the cell shape and movement'],
      ['Vacuole', 'Stores water, nutrients and waste'],
      ['Centriole', 'Organises microtubules during cell division'],
      ['Peroxisome', 'Breaks down fatty acids and neutralises hydrogen peroxide'],
    ],
  },
  {
    title: 'Design principles',
    description: 'Gestalt and the vocabulary of visual hierarchy.',
    cards: [
      ['Proximity', 'Elements close together are perceived as a group'],
      ['Similarity', 'Elements that look alike are perceived as related'],
      ['Closure', 'The mind completes incomplete shapes'],
      ['Continuity', 'The eye follows lines and curves beyond their end'],
      ['Figure and ground', 'Separating a subject from its background'],
      ['Contrast', 'Difference that creates emphasis and hierarchy'],
      ['Alignment', 'Placing elements along shared edges or axes'],
      ['Whitespace', 'Empty space that gives content room to breathe'],
      ['Repetition', 'Reusing elements to create consistency and rhythm'],
      ['Hierarchy', 'Arranging elements to show their order of importance'],
    ],
  },
]

export async function seedUser(db: D1Database, owner: string) {
  const t = Date.now()
  const statements: D1PreparedStatement[] = []
  const sessionDays = [0, 1, 2, 4, 5, 6, 7, 9, 12, 13]
  const deckIds = new Map<string, string>()

  decks.forEach((deck, di) => {
    const deckId = id()
    deckIds.set(deck.title, deckId)
    const lastStudied = di === 0 ? t - 3 * 3_600_000 : di === 1 ? t - 1.2 * DAY : t - 6 * DAY
    statements.push(
      db
        .prepare(`INSERT INTO decks (id, owner_sub, title, description, hue, last_studied_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(deckId, owner, deck.title, deck.description, hueFor(deck.title), lastStudied, t - (20 - di * 4) * DAY, lastStudied),
    )
    deck.cards.forEach(([term, definition], ci) => {
      const cardId = id()
      statements.push(
        db
          .prepare(`INSERT INTO cards (id, owner_sub, deck_id, term, definition, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .bind(cardId, owner, deckId, term, definition, ci, t - (20 - di * 4) * DAY + ci),
      )
      // Progress that looks like a few sessions have happened: early cards
      // are strong, later cards are still new.
      if (di < 2 && ci < deck.cards.length * 0.7) {
        const strength = Math.max(0, 1 - ci / deck.cards.length)
        const correct = Math.round(2 + strength * 6)
        const incorrect = Math.round((1 - strength) * 3)
        const mastery = Math.min(100, Math.round(strength * 100))
        statements.push(
          db
            .prepare(`INSERT INTO card_progress (card_id, owner_sub, deck_id, correct, incorrect, streak, mastery, next_due, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(cardId, owner, deckId, correct, incorrect, Math.min(correct, 4), mastery, t + (mastery >= 80 ? 3 : mastery >= 40 ? 1 : 0) * DAY, lastStudied),
        )
      }
    })
    // A short session history so stats and streaks are furnished.
    sessionDays.forEach((daysAgo, si) => {
      if ((si + di) % 3 === 2) return
      const total = 10 + ((si * 3 + di) % 6)
      const score = Math.max(4, total - ((si + di * 2) % 5))
      const modes = ['learn', 'flashcards', 'match'] as const
      statements.push(
        db
          .prepare(`INSERT INTO sessions (id, owner_sub, deck_id, mode, score, total, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(id(), owner, deckId, modes[(si + di) % 3], score, total, (90 + ((si * 37) % 200)) * 1000, t - daysAgo * DAY - (di + 1) * 2 * 3_600_000),
      )
    })
  })

  // Seeded notes so the notebook has something to read, and one studio board
  // so the whiteboard opens on a real drawing instead of an empty canvas.
  const seedNotes: { title: string; body: string; kind: NoteKind; tags: string[]; pinned: boolean; deck?: string }[] = [
    {
      title: 'Maya Chen — study partner',
      body: 'Met in the Friday review group. Strong on genetics, wants help with organic chemistry.\n\nPrefers evenings after 6pm. Send the cell biology deck before the next session.',
      kind: 'contact',
      tags: ['study group', 'genetics'],
      pinned: true,
      deck: 'Cell biology',
    },
    {
      title: 'Weak spots before the midterm',
      body: 'Peroxisomes keep slipping. Also mixing up the Golgi and the endoplasmic reticulum.\n\nPlan: two short learn rounds on the cell biology deck, then a match round to finish.',
      kind: 'note',
      tags: ['midterm', 'review'],
      pinned: true,
      deck: 'Cell biology',
    },
    {
      title: 'Design review with Sam',
      body: 'Walked through the hierarchy exercise. Sam suggested practising contrast before proximity.\n\nFollow up: add three more cards on figure and ground.',
      kind: 'meeting',
      tags: ['design', 'feedback'],
      pinned: false,
      deck: 'Design principles',
    },
    {
      title: 'Book a quiet study room',
      body: 'Library level 3, Thursday 4pm, before the Spanish speaking practice.',
      kind: 'task',
      tags: ['admin'],
      pinned: false,
    },
    {
      title: 'Spanish tutor call',
      body: 'Ask about the subjunctive, and whether the listening drills are worth another month.',
      kind: 'call',
      tags: ['spanish', 'admin'],
      pinned: false,
    },
  ]
  seedNotes.forEach((note, ni) => {
    const stamp = t - (ni + 1) * 7 * 3_600_000
    statements.push(
      db
        .prepare(`INSERT INTO notes (id, owner_sub, title, body, kind, tags, pinned, deck_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id(), owner, note.title, note.body, note.kind, JSON.stringify(note.tags), note.pinned ? 1 : 0, note.deck ? (deckIds.get(note.deck) ?? null) : null, stamp - 2 * 86_400_000, stamp),
    )
  })

  const base = { angle: 0, opacity: 1, strokeWidth: 0, align: 'left' as const }
  const starterBoard: BoardDoc = {
    version: 1,
    background: '#fbfaf7',
    grid: 'dots',
    elements: [
      { ...base, id: id(), kind: 'text', x: 80, y: 48, w: 560, h: 56, fill: null, stroke: '#15141f', text: 'Cell biology — exam map', fontSize: 34, bold: true },
      { ...base, id: id(), kind: 'text', x: 80, y: 104, w: 460, h: 32, fill: null, stroke: '#676577', text: 'What I know, what I keep forgetting', fontSize: 17 },
      { ...base, id: id(), kind: 'ellipse', x: 60, y: 150, w: 600, h: 300, fill: null, stroke: '#5b4df0', strokeWidth: 1.5, dashed: true },
      { ...base, id: id(), kind: 'note', x: 92, y: 180, w: 220, h: 140, fill: '#fdf2c8', stroke: '#e5d59b', strokeWidth: 1, text: 'Mitochondria make ATP — double membrane, own DNA', fontSize: 16 },
      { ...base, id: id(), kind: 'note', x: 350, y: 170, w: 210, h: 132, fill: '#ffe0d3', stroke: '#efc7b7', strokeWidth: 1, text: 'Ribosomes build proteins from mRNA', fontSize: 16 },
      { ...base, id: id(), kind: 'note', x: 420, y: 330, w: 220, h: 118, fill: '#dcf0ff', stroke: '#bcdcef', strokeWidth: 1, text: 'Golgi packages and ships proteins out', fontSize: 16 },
      { ...base, id: id(), kind: 'arrow', x: 300, y: 238, w: 56, h: 40, fill: null, stroke: '#15141f', strokeWidth: 2, a: { x: 306, y: 244 }, b: { x: 352, y: 238 } },
      { ...base, id: id(), kind: 'arrow', x: 540, y: 302, w: 60, h: 50, fill: null, stroke: '#15141f', strokeWidth: 2, a: { x: 545, y: 306 }, b: { x: 592, y: 344 } },
      { ...base, id: id(), kind: 'note', x: 96, y: 372, w: 240, h: 108, fill: '#ddf3e4', stroke: '#bde3cd', strokeWidth: 1, text: 'Weak spot: peroxisomes. Write three more cards.', fontSize: 16 },
      { ...base, id: id(), kind: 'stroke', x: 700, y: 190, w: 210, h: 220, fill: null, stroke: '#d9483a', strokeWidth: 3, points: [
        { x: 706, y: 398 }, { x: 742, y: 312 }, { x: 792, y: 352 }, { x: 838, y: 232 }, { x: 904, y: 268 },
      ] },
      { ...base, id: id(), kind: 'text', x: 690, y: 410, w: 260, h: 30, fill: null, stroke: '#d9483a', text: 'memory over the week', fontSize: 15 },
    ],
  }
  statements.push(
    db
      .prepare(`INSERT INTO boards (id, owner_sub, title, doc, thumb, element_count, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`)
      .bind(id(), owner, 'Cell biology — exam map', JSON.stringify(starterBoard), starterBoard.elements.length, t - 4 * DAY, t - 26 * 3_600_000),
  )

  statements.push(db.prepare(`UPDATE users SET seeded_at = ? WHERE owner_sub = ?`).bind(t, owner))
  for (let i = 0; i < statements.length; i += 40) await db.batch(statements.slice(i, i + 40))
}

export async function clearUser(db: D1Database, owner: string) {
  await db.batch(['sessions', 'card_progress', 'cards', 'decks', 'notes', 'boards'].map((table) => db.prepare(`DELETE FROM ${table} WHERE owner_sub = ?`).bind(owner)))
  await db.prepare(`UPDATE users SET seeded_at = NULL WHERE owner_sub = ?`).bind(owner).run()
}
