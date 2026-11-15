import type { SupabaseClient } from '@supabase/supabase-js'

import type { BoardDoc, BoardElement, NoteKind } from '../../shared/types'
import { hueFor, newId } from '../../shared/util'

// First-run content: three decks with believable progress, a few CRM notes and
// one studio board. Seeded from the browser because there is no server in the
// static build, right after the profile row is created.

const DAY = 86_400_000

const SEED_DECKS: { title: string; description: string; cards: [string, string][] }[] = [
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

const SEED_NOTES: { title: string; body: string; kind: NoteKind; tags: string[]; pinned: boolean; deck?: string }[] = [
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

type SeedElement = Omit<BoardElement, 'id' | 'angle' | 'opacity' | 'strokeWidth' | 'align'> & Partial<Pick<BoardElement, 'angle' | 'opacity' | 'strokeWidth' | 'align'>>

export function starterBoardDoc(): BoardDoc {
  const element = (el: SeedElement): BoardElement => ({ angle: 0, opacity: 1, strokeWidth: 0, align: 'left', ...el, id: newId() })
  return {
    version: 1,
    background: '#fbfaf7',
    grid: 'dots',
    elements: [
      element({ kind: 'text', x: 80, y: 48, w: 560, h: 56, fill: null, stroke: '#15141f', text: 'Cell biology — exam map', fontSize: 34, bold: true }),
      element({ kind: 'text', x: 80, y: 104, w: 460, h: 32, fill: null, stroke: '#676577', text: 'What I know, what I keep forgetting', fontSize: 17 }),
      element({ kind: 'ellipse', x: 60, y: 150, w: 600, h: 300, fill: null, stroke: '#5b4df0', strokeWidth: 1.5, dashed: true }),
      element({ kind: 'note', x: 92, y: 180, w: 220, h: 140, fill: '#fdf2c8', stroke: '#e5d59b', strokeWidth: 1, text: 'Mitochondria make ATP — double membrane, own DNA', fontSize: 16 }),
      element({ kind: 'note', x: 350, y: 170, w: 210, h: 132, fill: '#ffe0d3', stroke: '#efc7b7', strokeWidth: 1, text: 'Ribosomes build proteins from mRNA', fontSize: 16 }),
      element({ kind: 'note', x: 420, y: 330, w: 220, h: 118, fill: '#dcf0ff', stroke: '#bcdcef', strokeWidth: 1, text: 'Golgi packages and ships proteins out', fontSize: 16 }),
      element({ kind: 'arrow', x: 300, y: 238, w: 56, h: 40, fill: null, stroke: '#15141f', strokeWidth: 2, a: { x: 306, y: 244 }, b: { x: 352, y: 238 } }),
      element({ kind: 'arrow', x: 540, y: 302, w: 60, h: 50, fill: null, stroke: '#15141f', strokeWidth: 2, a: { x: 545, y: 306 }, b: { x: 592, y: 344 } }),
      element({ kind: 'note', x: 96, y: 372, w: 240, h: 108, fill: '#ddf3e4', stroke: '#bde3cd', strokeWidth: 1, text: 'Weak spot: peroxisomes. Write three more cards.', fontSize: 16 }),
      element({
        kind: 'stroke',
        x: 700,
        y: 190,
        w: 210,
        h: 220,
        fill: null,
        stroke: '#d9483a',
        strokeWidth: 3,
        points: [
          { x: 706, y: 398 },
          { x: 742, y: 312 },
          { x: 792, y: 352 },
          { x: 838, y: 232 },
          { x: 904, y: 268 },
        ],
      }),
      element({ kind: 'text', x: 690, y: 410, w: 260, h: 30, fill: null, stroke: '#d9483a', text: 'memory over the week', fontSize: 15 }),
    ],
  }
}

/** Fills a brand-new account with sample decks, history, notes and a board. */
export async function seedLibrary(client: SupabaseClient, owner: string): Promise<void> {
  const t = Date.now()
  const sessionDays = [0, 1, 2, 4, 5, 6, 7, 9, 12, 13]
  const deckIds = new Map<string, string>()
  const deckRows: Record<string, unknown>[] = []
  const cardRows: Record<string, unknown>[] = []
  const progressRows: Record<string, unknown>[] = []
  const sessionRows: Record<string, unknown>[] = []

  SEED_DECKS.forEach((deck, di) => {
    const deckId = newId()
    deckIds.set(deck.title, deckId)
    const lastStudied = di === 0 ? t - 3 * 3_600_000 : di === 1 ? t - 1.2 * DAY : t - 6 * DAY
    deckRows.push({
      id: deckId,
      owner_id: owner,
      title: deck.title,
      description: deck.description,
      hue: hueFor(deck.title),
      last_studied_at: Math.round(lastStudied),
      created_at: t - (20 - di * 4) * DAY,
      updated_at: Math.round(lastStudied),
    })
    deck.cards.forEach(([term, definition], ci) => {
      const cardId = newId()
      cardRows.push({ id: cardId, owner_id: owner, deck_id: deckId, term, definition, position: ci, created_at: t - (20 - di * 4) * DAY + ci })
      // Progress that looks like a few sessions have happened: early cards are
      // strong, later cards are still new.
      if (di < 2 && ci < deck.cards.length * 0.7) {
        const strength = Math.max(0, 1 - ci / deck.cards.length)
        const correct = Math.round(2 + strength * 6)
        const incorrect = Math.round((1 - strength) * 3)
        const mastery = Math.min(100, Math.round(strength * 100))
        progressRows.push({
          card_id: cardId,
          owner_id: owner,
          deck_id: deckId,
          correct,
          incorrect,
          streak: Math.min(correct, 4),
          mastery,
          next_due: t + (mastery >= 80 ? 3 : mastery >= 40 ? 1 : 0) * DAY,
          last_seen: Math.round(lastStudied),
        })
      }
    })
    sessionDays.forEach((daysAgo, si) => {
      if ((si + di) % 3 === 2) return
      const total = 10 + ((si * 3 + di) % 6)
      const score = Math.max(4, total - ((si + di * 2) % 5))
      const modes = ['learn', 'flashcards', 'match'] as const
      sessionRows.push({
        id: newId(),
        owner_id: owner,
        deck_id: deckId,
        mode: modes[(si + di) % 3],
        score,
        total,
        duration_ms: (90 + ((si * 37) % 200)) * 1000,
        created_at: t - daysAgo * DAY - (di + 1) * 2 * 3_600_000,
      })
    })
  })

  const noteRows = SEED_NOTES.map((note, ni) => {
    const stamp = t - (ni + 1) * 7 * 3_600_000
    return {
      id: newId(),
      owner_id: owner,
      title: note.title,
      body: note.body,
      kind: note.kind,
      tags: note.tags,
      pinned: note.pinned,
      deck_id: note.deck ? (deckIds.get(note.deck) ?? null) : null,
      created_at: stamp - 2 * DAY,
      updated_at: stamp,
    }
  })

  const boardDoc = starterBoardDoc()
  const boardRow = {
    id: newId(),
    owner_id: owner,
    title: 'Cell biology — exam map',
    doc: boardDoc,
    thumb: null,
    element_count: boardDoc.elements.length,
    created_at: t - 4 * DAY,
    updated_at: t - 26 * 3_600_000,
  }

  const steps: [string, Record<string, unknown>[]][] = [
    ['decks', deckRows],
    ['cards', cardRows],
    ['card_progress', progressRows],
    ['sessions', sessionRows],
    ['notes', noteRows],
    ['boards', [boardRow]],
  ]
  for (const [table, rows] of steps) {
    if (!rows.length) continue
    const { error } = await client.from(table).insert(rows)
    if (error) throw new Error(`Could not seed ${table}: ${error.message}`)
  }

  const { error } = await client.from('profiles').update({ seeded_at: t }).eq('id', owner)
  if (error) throw new Error(error.message)
}
