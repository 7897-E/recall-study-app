import { PenTool, Plus, Shapes, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import type { Board, BoardSummary } from '../../shared/types'
import { BoardEditor } from '../components/BoardEditor'
import { Button, ConfirmDialog, EmptyState, PageHeader, Skeleton, useToast } from '../components/ui'
import { api, useApiMutation, useBoards } from '../lib/api'
import { relativeTime } from '../lib/format'

export function StudioPage() {
  const { id } = useParams()
  return id ? <BoardEditor boardId={id} /> : <BoardGallery />
}

function BoardGallery() {
  const navigate = useNavigate()
  const toast = useToast()
  const { data, isLoading } = useBoards()
  const [confirm, setConfirm] = useState<BoardSummary | null>(null)
  const boards = data?.items ?? []

  const create = useApiMutation(() => api<{ board: Board }>('/boards', { method: 'POST', json: { title: 'Untitled board' } }), ['boards'], {
    onSuccess: (result) => navigate(`/studio/${result.board.id}`),
  })
  const remove = useApiMutation((id: string) => api(`/boards/${id}`, { method: 'DELETE' }), ['boards'], {
    onSuccess: () => {
      setConfirm(null)
      toast('Board deleted')
    },
  })

  return (
    <div>
      <PageHeader
        title="Studio"
        subtitle="An infinite canvas for diagrams, mind maps and art. Everything autosaves."
        actions={
          <Button variant="primary" onClick={() => create.mutate(undefined)} loading={create.isPending}>
            <Plus />
            New board
          </Button>
        }
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading && Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-[248px] rounded-card" />)}
        {boards.map((board) => (
          <Link key={board.id} to={`/studio/${board.id}`} className="group flex flex-col overflow-hidden rounded-card bg-surface shadow-card transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-pop">
            <div className="relative aspect-[16/10] w-full overflow-hidden border-b border-line bg-surface-2">
              {board.thumb ? (
                <img src={board.thumb} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full place-items-center text-faint">
                  <Shapes className="size-7" />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{board.title || 'Untitled board'}</p>
                <p className="mt-0.5 text-[12px] text-faint">
                  {board.elementCount} {board.elementCount === 1 ? 'element' : 'elements'} · {relativeTime(board.updatedAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setConfirm(board)
                }}
                aria-label={`Delete ${board.title}`}
                className="grid size-8 place-items-center rounded-tile text-faint opacity-100 transition-[opacity,background-color,color] hover:bg-danger-soft hover:text-danger sm:opacity-0 sm:group-hover:opacity-100"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          </Link>
        ))}

        {!isLoading && (
          <button
            type="button"
            onClick={() => create.mutate(undefined)}
            className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-line-strong text-muted transition-colors hover:border-accent hover:text-accent"
          >
            <Plus className="size-5" />
            <span className="text-[14px] font-medium">New board</span>
            <span className="max-w-[200px] text-center text-[12px] text-faint">Blank canvas, or import a board file</span>
          </button>
        )}
      </div>

      {!isLoading && boards.length === 0 && (
        <EmptyState
          icon={<PenTool />}
          title="The studio is empty"
          description="Start a board and sketch a diagram, a mind map or a poster. Every tool lives on the canvas."
          action={
            <Button variant="primary" onClick={() => create.mutate(undefined)} loading={create.isPending}>
              <Plus />
              New board
            </Button>
          }
        />
      )}

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && remove.mutate(confirm.id)}
        loading={remove.isPending}
        title="Delete this board?"
        description={`“${confirm?.title ?? 'Untitled board'}” and its drawing will be removed. This cannot be undone.`}
        confirmLabel="Delete board"
      />
    </div>
  )
}
