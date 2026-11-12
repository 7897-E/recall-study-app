import { ArrowLeft, NotebookPen, Pin, PinOff, Plus, Search, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import type { Deck, Note, NoteKind } from '../../shared/types'
import { NOTE_KINDS } from '../../shared/types'
import { Badge, Button, ConfirmDialog, EmptyState, Input, Select, Skeleton, Textarea, useToast } from '../components/ui'
import { api, useApiMutation, useDecks, useInvalidate, useNotes } from '../lib/api'
import { cx } from '../lib/cx'
import { relativeTime } from '../lib/format'

const KIND_TONE: Record<NoteKind, 'neutral' | 'accent' | 'info' | 'warning' | 'success'> = {
  note: 'neutral',
  contact: 'accent',
  meeting: 'info',
  call: 'warning',
  task: 'success',
}

export function NotesPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { data, isLoading } = useNotes()
  const { data: deckData } = useDecks()
  const notes = data?.items ?? []
  const decks = deckData?.items ?? []
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<NoteKind | 'all'>('all')

  const active = notes.find((note) => note.id === id)
  const needle = query.trim().toLowerCase()
  const filtered = notes.filter((note) => {
    if (kind !== 'all' && note.kind !== kind) return false
    if (!needle) return true
    return `${note.title} ${note.body} ${note.tags.join(' ')}`.toLowerCase().includes(needle)
  })
  const pinned = filtered.filter((note) => note.pinned)
  const rest = filtered.filter((note) => !note.pinned)

  const create = useApiMutation(() => api<{ note: Note }>('/notes', { method: 'POST', json: { title: '', kind: 'note' } }), ['notes'], {
    onSuccess: (result) => navigate(`/notes/${result.note.id}`),
  })

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-[-0.02em]">Notes</h1>
          <p className="mt-1 text-[14.5px] text-muted">People, meetings, calls and the things you keep forgetting — all in one place.</p>
        </div>
        <Button variant="primary" onClick={() => create.mutate(undefined)} loading={create.isPending}>
          <Plus />
          New note
        </Button>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className={cx('min-w-0', id && 'hidden lg:block')}>
          <div className="flex flex-col gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes, people, tags" className="pl-9" />
            </div>
            <div className="scrollbar-thin -mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5">
              <button
                type="button"
                onClick={() => setKind('all')}
                className={cx('h-8 shrink-0 rounded-control px-3 text-[12.5px] font-medium transition-colors', kind === 'all' ? 'bg-fg text-white' : 'bg-surface-2 text-muted hover:text-fg')}
              >
                All
              </button>
              {NOTE_KINDS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setKind(entry.id)}
                  className={cx('h-8 shrink-0 rounded-control px-3 text-[12.5px] font-medium transition-colors', kind === entry.id ? 'bg-fg text-white' : 'bg-surface-2 text-muted hover:text-fg')}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-2">
            {isLoading && Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-[86px] rounded-card" />)}
            {!isLoading && filtered.length === 0 && (
              <div className="rounded-card bg-surface p-6 text-center shadow-card">
                <p className="text-[13.5px] font-medium">{notes.length === 0 ? 'No notes yet' : 'Nothing matches that'}</p>
                <p className="mt-1 text-[12.5px] text-muted">{notes.length === 0 ? 'Write the first one — a person, a meeting, or a thought.' : 'Try another search or filter.'}</p>
              </div>
            )}
            {[...pinned, ...rest].map((note) => (
              <Link
                key={note.id}
                to={`/notes/${note.id}`}
                className={cx(
                  'group block rounded-card border p-3.5 transition-[border-color,background-color,box-shadow]',
                  active?.id === note.id ? 'border-accent/45 bg-accent-soft/40' : 'border-transparent bg-surface shadow-card hover:border-line-strong',
                )}
              >
                <div className="flex items-center gap-2">
                  <Badge tone={KIND_TONE[note.kind]}>{NOTE_KINDS.find((entry) => entry.id === note.kind)?.label ?? 'Note'}</Badge>
                  {note.pinned && <Pin className="size-3.5 text-accent" />}
                  <span className="ml-auto text-[11.5px] text-faint">{relativeTime(note.updatedAt)}</span>
                </div>
                <p className="mt-2 truncate text-[14px] font-medium">{note.title.trim() || 'Untitled note'}</p>
                <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted">{note.body.trim() || 'No content yet'}</p>
                {note.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {note.tags.slice(0, 4).map((tag) => (
                      <span key={tag} className="rounded-[6px] bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
            ))}
          </div>
        </div>

        <div className={cx('min-w-0', !id && 'hidden lg:block')}>
          {active ? (
            <NoteEditor
              key={active.id}
              note={active}
              decks={decks}
              onDeleted={() => {
                toast('Note deleted')
                navigate('/notes')
              }}
            />
          ) : (
            <div className="rounded-card bg-surface shadow-card">
              <EmptyState icon={<NotebookPen />} title="Pick a note" description="Choose something on the left, or start a new note for a person, meeting or task." action={<Button variant="primary" onClick={() => create.mutate(undefined)} loading={create.isPending}><Plus />New note</Button>} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

interface Draft {
  title: string
  body: string
  kind: NoteKind
  tags: string[]
  pinned: boolean
  deckId: string | null
}

function toDraft(note: Note): Draft {
  return { title: note.title, body: note.body, kind: note.kind, tags: note.tags, pinned: note.pinned, deckId: note.deckId }
}

function NoteEditor({ note, decks, onDeleted }: { note: Note; decks: Deck[]; onDeleted: () => void }) {
  const navigate = useNavigate()
  const invalidate = useInvalidate()
  const [draft, setDraft] = useState<Draft>(() => toDraft(note))
  const [tagInput, setTagInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const savedRef = useRef(JSON.stringify(toDraft(note)))
  const pendingRef = useRef<{ id: string; payload: Draft } | null>(null)

  useEffect(() => {
    const initial = toDraft(note)
    setDraft(initial)
    savedRef.current = JSON.stringify(initial)
    pendingRef.current = null
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id])

  const edit = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }))

  useEffect(() => {
    const payload = JSON.stringify(draft)
    if (payload === savedRef.current) return
    pendingRef.current = { id: note.id, payload: draft }
    const timer = window.setTimeout(async () => {
      setSaving(true)
      try {
        await api(`/notes/${note.id}`, { method: 'PATCH', json: draft })
        savedRef.current = payload
        pendingRef.current = null
        setSaving(false)
        setSavedAt(Date.now())
        setError(null)
        void invalidate('notes')
      } catch (cause) {
        setSaving(false)
        setError(cause instanceof Error ? cause.message : 'Could not save')
      }
    }, 650)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  // Flush a pending edit if the user leaves before the debounce fires.
  useEffect(() => {
    return () => {
      const pending = pendingRef.current
      if (!pending) return
      void fetch(`/api/notes/${pending.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(pending.payload),
        keepalive: true,
      })
    }
  }, [])

  const remove = useApiMutation((id: string) => api(`/notes/${id}`, { method: 'DELETE' }), ['notes'], {
    onSuccess: () => {
      setConfirm(false)
      onDeleted()
    },
  })

  const addTag = () => {
    const tag = tagInput.trim()
    if (!tag) return
    if (!draft.tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) edit({ tags: [...draft.tags, tag].slice(0, 10) })
    setTagInput('')
  }

  const words = draft.body.trim() ? draft.body.trim().split(/\s+/).length : 0

  return (
    <div className="flex min-h-[600px] flex-col rounded-card bg-surface shadow-card">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <button type="button" onClick={() => navigate('/notes')} className="grid size-8 place-items-center rounded-tile text-muted hover:bg-surface-2 hover:text-fg lg:hidden" aria-label="Back to notes">
          <ArrowLeft className="size-4" />
        </button>
        <Select value={draft.kind} onChange={(event) => edit({ kind: event.target.value as NoteKind })} className="w-[134px]">
          {NOTE_KINDS.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </Select>
        <button
          type="button"
          onClick={() => edit({ pinned: !draft.pinned })}
          className={cx('inline-flex h-8 items-center gap-1.5 rounded-tile px-2.5 text-[12.5px] font-medium transition-colors', draft.pinned ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg')}
        >
          {draft.pinned ? <Pin className="size-3.5" /> : <PinOff className="size-3.5" />}
          {draft.pinned ? 'Pinned' : 'Pin'}
        </button>
        <span className="ml-auto text-[12px] text-faint">{error ? <span className="text-danger">{error}</span> : saving ? 'Saving…' : savedAt ? `Saved ${relativeTime(savedAt)}` : 'Autosaves as you type'}</span>
        <button type="button" onClick={() => setConfirm(true)} className="grid size-8 place-items-center rounded-tile text-muted transition-colors hover:bg-danger-soft hover:text-danger" aria-label="Delete note">
          <Trash2 className="size-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-5 py-5">
        <input
          value={draft.title}
          onChange={(event) => edit({ title: event.target.value })}
          placeholder="Untitled note"
          className="w-full bg-transparent text-[24px] font-bold tracking-[-0.02em] outline-none placeholder:text-faint"
        />

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {draft.tags.map((tag) => (
            <span key={tag} className="inline-flex h-7 items-center gap-1 rounded-[8px] bg-surface-2 pl-2 pr-1 text-[12px] font-medium text-muted">
              {tag}
              <button
                type="button"
                onClick={() => edit({ tags: draft.tags.filter((existing) => existing !== tag) })}
                className="grid size-5 place-items-center rounded-[5px] text-faint hover:bg-surface hover:text-fg"
                aria-label={`Remove ${tag}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          <input
            value={tagInput}
            onChange={(event) => setTagInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ',') {
                event.preventDefault()
                addTag()
              }
              if (event.key === 'Backspace' && !tagInput && draft.tags.length > 0) edit({ tags: draft.tags.slice(0, -1) })
            }}
            onBlur={addTag}
            placeholder={draft.tags.length === 0 ? 'Add a tag' : 'Add another'}
            className="h-7 min-w-[100px] flex-1 bg-transparent px-1 text-[12.5px] outline-none placeholder:text-faint"
          />
        </div>

        <Textarea
          value={draft.body}
          onChange={(event) => edit({ body: event.target.value })}
          placeholder="What happened? What do you need to remember?"
          className="mt-4 min-h-[300px] flex-1 resize-none border-0 bg-transparent px-0 py-0 text-[14px] leading-relaxed shadow-none focus:ring-0"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-2.5 text-[12px] text-faint">
        <span>{words} {words === 1 ? 'word' : 'words'}</span>
        <span className="text-line-strong">·</span>
        <span>Updated {relativeTime(note.updatedAt)}</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden sm:inline">Linked deck</span>
          <Select value={draft.deckId ?? ''} onChange={(event) => edit({ deckId: event.target.value || null })} className="w-[180px]">
            <option value="">None</option>
            {decks.map((deck) => (
              <option key={deck.id} value={deck.id}>
                {deck.title}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => remove.mutate(note.id)}
        loading={remove.isPending}
        title="Delete this note?"
        description={`“${draft.title.trim() || 'Untitled note'}” will be removed. This cannot be undone.`}
        confirmLabel="Delete note"
      />
    </div>
  )
}
