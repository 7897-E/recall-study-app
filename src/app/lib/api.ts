import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { Board, BoardSummary, Card, Deck, Me, Note, Session, SessionResult, Stats, StudyMode } from '../../shared/types'
import { handleApi } from './backend'
import { ApiError } from './errors'

export { ApiError }

// The hooks keep the `/api`-style call shape they always had; in the static
// build those calls are served locally by the Supabase data layer.
export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  try {
    return (await handleApi(init?.method ?? 'GET', path, { json: init?.json, body: init?.body })) as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(500, error instanceof Error ? error.message : 'Something went wrong.')
  }
}

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me'), retry: false, staleTime: 60_000 })
export const useDecks = () => useQuery({ queryKey: ['decks'], queryFn: () => api<{ items: Deck[] }>('/decks') })
export const useDeck = (id: string | undefined) =>
  useQuery({
    queryKey: ['deck', id],
    queryFn: () => api<{ deck: Deck; cards: Card[]; sessions: Session[] }>(`/decks/${id}`),
    enabled: Boolean(id),
  })
export const useStats = () => useQuery({ queryKey: ['stats'], queryFn: () => api<Stats>('/stats') })
export const useNotes = () => useQuery({ queryKey: ['notes'], queryFn: () => api<{ items: Note[] }>('/notes') })
export const useBoards = () => useQuery({ queryKey: ['boards'], queryFn: () => api<{ items: BoardSummary[] }>('/boards') })
export const useBoard = (id: string | undefined) =>
  useQuery({ queryKey: ['board', id], queryFn: () => api<{ board: Board }>(`/boards/${id}`), enabled: Boolean(id) })

export function useInvalidate() {
  const client = useQueryClient()
  return (...keys: string[]) => Promise.all(keys.map((key) => client.invalidateQueries({ queryKey: [key] })))
}

export function useApiMutation<TInput, TResult>(run: (input: TInput) => Promise<TResult>, invalidates: string[], options?: { onSuccess?: (result: TResult, input: TInput) => void }) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: run,
    onSuccess: async (result, input) => {
      await invalidate(...invalidates)
      options?.onSuccess?.(result, input)
    },
  })
}

export function recordSession(deckId: string, mode: StudyMode, results: SessionResult[], durationMs: number) {
  return api<{ session: { id: string; score: number; total: number; accuracy: number } }>(`/decks/${deckId}/sessions`, {
    method: 'POST',
    json: { mode, results, durationMs },
  })
}

export async function uploadCardImage(deckId: string, cardId: string, file: File) {
  const form = new FormData()
  form.set('file', file)
  await api(`/decks/${deckId}/cards/${cardId}/image`, { method: 'PUT', body: form })
}
