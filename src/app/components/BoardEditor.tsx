import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  ArrowUpRight,
  Bold,
  BringToFront,
  Circle,
  Copy,
  Diamond,
  Download,
  Eraser,
  Eye,
  EyeOff,
  Grid3x3,
  Hand,
  Highlighter,
  Lock,
  Magnet,
  Maximize,
  Minus,
  MousePointer2,
  Pencil,
  Redo2,
  SendToBack,
  SlidersHorizontal,
  Square,
  StickyNote,
  Trash2,
  Triangle,
  Type,
  Undo2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { Link, useNavigate } from 'react-router'

import type { Board, BoardDoc, BoardElement } from '../../shared/types'
import { api } from '../lib/api'
import { cx } from '../lib/cx'
import { Canvas } from './board/Canvas'
import {
  BACKGROUNDS,
  FILL_COLORS,
  GRID_STEP,
  INK_COLORS,
  type AlignMode,
  type InkStyle,
  type Tool,
  type View,
  alignBoxes,
  applyBox,
  boundsOf,
  clamp,
  duplicateElements,
  emptyDoc,
  sanitizeDoc,
  screenToWorld,
  uid,
  zOrder,
} from './board/model'
import { boardThumbnail, renderBoardCanvas } from './board/render'

type SaveState = 'saved' | 'saving' | 'dirty' | 'error'

const TOOL_GROUPS: { id: Tool; label: string; key: string; icon: ReactNode }[][] = [
  [
    { id: 'select', label: 'Select', key: 'V', icon: <MousePointer2 /> },
    { id: 'hand', label: 'Pan', key: 'H', icon: <Hand /> },
  ],
  [
    { id: 'pen', label: 'Pen', key: 'P', icon: <Pencil /> },
    { id: 'marker', label: 'Highlighter', key: 'M', icon: <Highlighter /> },
    { id: 'eraser', label: 'Eraser', key: 'E', icon: <Eraser /> },
  ],
  [
    { id: 'rect', label: 'Rectangle', key: 'R', icon: <Square /> },
    { id: 'ellipse', label: 'Ellipse', key: 'O', icon: <Circle /> },
    { id: 'diamond', label: 'Diamond', key: 'D', icon: <Diamond /> },
    { id: 'triangle', label: 'Triangle', key: '', icon: <Triangle /> },
    { id: 'line', label: 'Line', key: 'L', icon: <Minus /> },
    { id: 'arrow', label: 'Arrow', key: 'A', icon: <ArrowUpRight /> },
  ],
  [
    { id: 'text', label: 'Text', key: 'T', icon: <Type /> },
    { id: 'note', label: 'Sticky note', key: 'N', icon: <StickyNote /> },
  ],
]

const TOOL_BY_KEY: Record<string, Tool> = { v: 'select', h: 'hand', p: 'pen', m: 'marker', e: 'eraser', r: 'rect', o: 'ellipse', d: 'diamond', l: 'line', a: 'arrow', t: 'text', n: 'note' }

const iconButton = 'grid size-8 place-items-center rounded-tile text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-35'
const chip = 'inline-flex h-8 items-center justify-center gap-1.5 rounded-tile px-2.5 text-[12.5px] font-medium transition-colors'

function nudge(el: BoardElement, dx: number, dy: number): BoardElement {
  return {
    ...el,
    x: el.x + dx,
    y: el.y + dy,
    a: el.a ? { x: el.a.x + dx, y: el.a.y + dy } : undefined,
    b: el.b ? { x: el.b.x + dx, y: el.b.y + dy } : undefined,
    points: el.points?.map((point) => ({ x: point.x + dx, y: point.y + dy })),
  }
}

function elementLabel(el: BoardElement): string {
  const kind = el.kind === 'note' ? 'Note' : el.kind === 'text' ? 'Text' : el.kind === 'highlight' ? 'Marker' : el.kind.charAt(0).toUpperCase() + el.kind.slice(1)
  const text = (el.text ?? '').trim().replace(/\s+/g, ' ').slice(0, 26)
  return text ? `${kind} · ${text}` : kind
}

function fileStem(title: string): string {
  const stem = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return stem || 'board'
}

export function BoardEditor({ boardId, fallbackTitle }: { boardId: string; fallbackTitle?: string }) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const [board, setBoard] = useState<Board | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [doc, setDoc] = useState<BoardDoc>(emptyDoc)
  const docRef = useRef(doc)
  docRef.current = doc
  const [title, setTitle] = useState(fallbackTitle ?? 'Untitled board')
  const titleRef = useRef(title)
  titleRef.current = title
  const [loaded, setLoaded] = useState(false)
  const [tool, setTool] = useState<Tool>('select')
  const [style, setStyle] = useState<InkStyle>({ stroke: INK_COLORS[1], fill: FILL_COLORS[0], strokeWidth: 3, fontSize: 20, opacity: 1 })
  const [selection, setSelection] = useState<string[]>([])
  const [view, setView] = useState<View>({ zoom: 1, pan: { x: 0, y: 0 } })
  const [editing, setEditing] = useState<string | null>(null)
  const [gridSnap, setGridSnap] = useState(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [status, setStatus] = useState<SaveState>('saved')
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 })
  const [panelOpen, setPanelOpen] = useState(false)
  const [, setHistoryVersion] = useState(0)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const past = useRef<BoardDoc[]>([])
  const future = useRef<BoardDoc[]>([])
  const clipboard = useRef<BoardElement[]>([])
  const savedRef = useRef('')
  const fitted = useRef(false)
  const importRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    fitted.current = false
    void api<{ board: Board }>(`/boards/${boardId}`)
      .then((result) => {
        if (cancelled) return
        const nextDoc = result.board.doc?.elements ? result.board.doc : emptyDoc()
        setBoard(result.board)
        setDoc(nextDoc)
        docRef.current = nextDoc
        setTitle(result.board.title)
        titleRef.current = result.board.title
        savedRef.current = JSON.stringify({ title: result.board.title, doc: nextDoc })
        setLoaded(true)
      })
      .catch((error: Error) => {
        if (!cancelled) setLoadError(error.message)
      })
    return () => {
      cancelled = true
    }
  }, [boardId])

  const pushHistory = (snapshot: BoardDoc) => {
    past.current = [...past.current.slice(-79), snapshot]
    future.current = []
    setHistoryVersion((value) => value + 1)
  }

  const apply = (mutator: (current: BoardDoc) => BoardDoc) => {
    const next = mutator(docRef.current)
    docRef.current = next
    setDoc(next)
  }

  const undo = () => {
    const previous = past.current.pop()
    if (!previous) return
    future.current = [...future.current, docRef.current]
    docRef.current = previous
    setDoc(previous)
    setSelection((ids) => ids.filter((id) => previous.elements.some((el) => el.id === id)))
    setHistoryVersion((value) => value + 1)
  }

  const redo = () => {
    const next = future.current.pop()
    if (!next) return
    past.current = [...past.current, docRef.current]
    docRef.current = next
    setDoc(next)
    setHistoryVersion((value) => value + 1)
  }

  const save = async () => {
    const current = docRef.current
    setStatus('saving')
    try {
      const thumb = boardThumbnail(current)
      await api(`/boards/${boardId}`, { method: 'PUT', json: { title: titleRef.current, doc: current, thumb } })
      savedRef.current = JSON.stringify({ title: titleRef.current, doc: current })
      setStatus('saved')
      void client.invalidateQueries({ queryKey: ['boards'] })
      void client.invalidateQueries({ queryKey: ['board', boardId] })
    } catch {
      setStatus('error')
    }
  }

  useEffect(() => {
    if (!loaded) return
    const payload = JSON.stringify({ title, doc })
    if (payload === savedRef.current) return
    setStatus('dirty')
    const timer = window.setTimeout(() => void save(), 900)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, title, loaded])

  const fit = () => {
    const width = canvasSize.w || window.innerWidth
    const height = canvasSize.h || window.innerHeight
    const bounds = boundsOf(docRef.current.elements.filter((el) => !el.hidden))
    if (!bounds) {
      setView({ zoom: 1, pan: { x: width / 2, y: height / 2 } })
      return
    }
    const zoom = clamp(Math.min((width - 180) / Math.max(bounds.w, 1), (height - 200) / Math.max(bounds.h, 1)), 0.15, 2)
    setView({ zoom, pan: { x: width / 2 - (bounds.x + bounds.w / 2) * zoom, y: height / 2 - (bounds.y + bounds.h / 2) * zoom } })
  }

  useEffect(() => {
    if (fitted.current || canvasSize.w === 0) return
    fitted.current = true
    fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasSize.w, canvasSize.h])

  const zoomBy = (factor: number) => {
    const cx = (canvasSize.w || window.innerWidth) / 2
    const cy = (canvasSize.h || window.innerHeight) / 2
    const next = clamp(view.zoom * factor, 0.1, 5)
    const world = screenToWorld({ x: cx, y: cy }, view)
    setView({ zoom: next, pan: { x: cx - world.x * next, y: cy - world.y * next } })
  }

  const selected = doc.elements.filter((el) => selection.includes(el.id))
  const active = selected[0]

  const patchSelected = (patch: Partial<BoardElement>, withHistory = true) => {
    if (selection.length === 0) return
    if (withHistory) pushHistory(docRef.current)
    apply((current) => ({ ...current, elements: current.elements.map((el) => (selection.includes(el.id) ? { ...el, ...patch } : el)) }))
  }

  const patchOne = (id: string, patch: Partial<BoardElement>) => {
    pushHistory(docRef.current)
    apply((current) => ({ ...current, elements: current.elements.map((el) => (el.id === id ? { ...el, ...patch } : el)) }))
  }

  const removeSelected = () => {
    if (selection.length === 0) return
    pushHistory(docRef.current)
    apply((current) => ({ ...current, elements: current.elements.filter((el) => !selection.includes(el.id)) }))
    setSelection([])
  }

  const duplicateSelected = () => {
    if (selection.length === 0) return
    pushHistory(docRef.current)
    const result = duplicateElements(docRef.current, selection)
    apply(() => result.doc)
    setSelection(result.ids)
  }

  const copySelected = () => {
    if (selected.length === 0) return
    clipboard.current = selected.map((el) => ({ ...el }))
  }

  const pasteClipboard = () => {
    if (clipboard.current.length === 0) return
    pushHistory(docRef.current)
    const copies = clipboard.current.map((el) => ({
      ...el,
      id: uid(),
      x: el.x + 32,
      y: el.y + 32,
      a: el.a ? { x: el.a.x + 32, y: el.a.y + 32 } : undefined,
      b: el.b ? { x: el.b.x + 32, y: el.b.y + 32 } : undefined,
      points: el.points?.map((point) => ({ x: point.x + 32, y: point.y + 32 })),
    }))
    apply((current) => ({ ...current, elements: [...current.elements, ...copies] }))
    setSelection(copies.map((el) => el.id))
    clipboard.current = copies.map((el) => ({ ...el }))
  }

  const alignSelection = (mode: AlignMode) => {
    if (selected.length < 2) return
    const boxes = alignBoxes(selected, mode)
    pushHistory(docRef.current)
    apply((current) => ({ ...current, elements: current.elements.map((el) => (boxes[el.id] ? applyBox(el, boxes[el.id]) : el)) }))
  }

  const reorder = (action: 'front' | 'back' | 'forward' | 'backward') => {
    if (selection.length === 0) return
    pushHistory(docRef.current)
    apply((current) => zOrder(current, selection, action))
  }

  const addAtCenter = (kind: 'note' | 'text') => {
    const width = canvasSize.w || window.innerWidth
    const height = canvasSize.h || window.innerHeight
    const world = screenToWorld({ x: width / 2, y: height / 2 }, view)
    const element: BoardElement = {
      id: uid(),
      kind,
      x: Math.round((world.x - (kind === 'note' ? 110 : 170)) / GRID_STEP) * GRID_STEP,
      y: Math.round((world.y - (kind === 'note' ? 78 : 20)) / GRID_STEP) * GRID_STEP,
      w: kind === 'note' ? 220 : 340,
      h: kind === 'note' ? 156 : 44,
      angle: 0,
      opacity: style.opacity,
      fill: kind === 'note' ? (style.fill ?? FILL_COLORS[0]) : null,
      stroke: kind === 'note' ? '#00000018' : style.stroke,
      strokeWidth: kind === 'note' ? 1 : 0,
      text: '',
      fontSize: kind === 'note' ? 16 : style.fontSize,
      align: 'left',
    }
    pushHistory(docRef.current)
    apply((current) => ({ ...current, elements: [...current.elements, element] }))
    setSelection([element.id])
    setEditing(element.id)
  }

  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  const exportPng = () => {
    const canvas = renderBoardCanvas(docRef.current, 2)
    if (!canvas) return
    canvas.toBlob((blob) => {
      if (blob) download(blob, `${fileStem(titleRef.current)}.png`)
    }, 'image/png')
  }

  const exportJson = () => {
    download(new Blob([JSON.stringify({ title: titleRef.current, doc: docRef.current }, null, 2)], { type: 'application/json' }), `${fileStem(titleRef.current)}.json`)
  }

  const importJson = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as { title?: string; doc?: unknown }
        const next = sanitizeDoc(parsed.doc ?? parsed)
        if (!next) return
        pushHistory(docRef.current)
        apply(() => next)
        setSelection([])
        if (typeof parsed.title === 'string' && parsed.title.trim()) setTitle(parsed.title.trim().slice(0, 80))
        window.setTimeout(fit, 60)
      } catch {
        /* not a board file */
      }
    }
    reader.readAsText(file)
  }

  const deleteBoard = async () => {
    setDeleting(true)
    try {
      await api(`/boards/${boardId}`, { method: 'DELETE' })
      void client.invalidateQueries({ queryKey: ['boards'] })
      navigate('/studio')
    } catch {
      setDeleting(false)
    }
  }

  const shortcut = useRef<(event: KeyboardEvent) => void>(() => {})
  shortcut.current = (event) => {
    const target = event.target as HTMLElement | null
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
    const meta = event.metaKey || event.ctrlKey
    if (event.code === 'Space' && !event.repeat) {
      event.preventDefault()
      setSpaceHeld(true)
      return
    }
    const key = event.key.toLowerCase()
    if (meta && key === 'z') {
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
      return
    }
    if (meta && key === 'y') {
      event.preventDefault()
      redo()
      return
    }
    if (meta && key === 's') {
      event.preventDefault()
      void save()
      return
    }
    if (meta && key === 'a') {
      event.preventDefault()
      setSelection(docRef.current.elements.filter((el) => !el.hidden && !el.locked).map((el) => el.id))
      return
    }
    if (meta && key === 'd') {
      event.preventDefault()
      duplicateSelected()
      return
    }
    if (meta && key === 'c') {
      copySelected()
      return
    }
    if (meta && key === 'v') {
      event.preventDefault()
      pasteClipboard()
      return
    }
    if (key === 'delete' || key === 'backspace') {
      if (selection.length === 0) return
      event.preventDefault()
      removeSelected()
      return
    }
    if (key === 'escape') {
      setSelection([])
      setEditing(null)
      return
    }
    const step = event.shiftKey ? 10 : 1
    const delta: Record<string, [number, number]> = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] }
    if (delta[key] && selection.length > 0) {
      event.preventDefault()
      const [dx, dy] = delta[key]
      pushHistory(docRef.current)
      apply((current) => ({ ...current, elements: current.elements.map((el) => (selection.includes(el.id) ? nudge(el, dx, dy) : el)) }))
      return
    }
    if (!meta && TOOL_BY_KEY[key]) {
      setTool(TOOL_BY_KEY[key])
      return
    }
    if (key === '[') reorder('backward')
    if (key === ']') reorder('forward')
    if (key === '0' && !meta) zoomBy(1 / view.zoom)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => shortcut.current(event)
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceHeld(false)
    }
    const onBlur = () => setSpaceHeld(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  const statusLabel = status === 'saved' ? 'Saved' : status === 'saving' ? 'Saving…' : status === 'dirty' ? 'Unsaved changes' : 'Save failed'

  const inspector = (
    <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
      {selected.length === 0 ? (
        <div className="space-y-5 p-4">
          <div>
            <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-faint">Canvas</p>
            <div className="grid grid-cols-8 gap-1.5">
              {BACKGROUNDS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Background ${color}`}
                  onClick={() => {
                    pushHistory(docRef.current)
                    apply((current) => ({ ...current, background: color }))
                  }}
                  className={cx('h-7 w-full rounded-[8px] border transition-transform hover:scale-105', doc.background === color ? 'border-accent ring-2 ring-accent/25' : 'border-line-strong')}
                  style={{ background: color }}
                />
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-faint">Grid</p>
            <div className="flex rounded-control bg-surface-2 p-1">
              {(['dots', 'lines', 'blank'] as const).map((grid) => (
                <button
                  key={grid}
                  type="button"
                  onClick={() => {
                    pushHistory(docRef.current)
                    apply((current) => ({ ...current, grid }))
                  }}
                  className={cx('h-7 flex-1 rounded-tile text-[12px] font-medium capitalize transition-colors', doc.grid === grid ? 'bg-surface text-fg shadow-card' : 'text-muted hover:text-fg')}
                >
                  {grid}
                </button>
              ))}
            </div>
          </div>
          <button type="button" onClick={() => setGridSnap((value) => !value)} className={cx(chip, 'w-full justify-start', gridSnap ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-muted')}>
            <Magnet className="size-4" />
            {gridSnap ? 'Snapping to grid' : 'Snap to grid'}
          </button>
          <div>
            <p className="mb-1.5 text-[11.5px] font-medium text-muted">New ink</p>
            <div className="grid grid-cols-9 gap-1">
              {INK_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Default ink ${color}`}
                  onClick={() => setStyle((current) => ({ ...current, stroke: color }))}
                  className={cx('h-6 w-full rounded-[8px] border transition-transform hover:scale-110', style.stroke === color ? 'border-accent ring-2 ring-accent/25' : 'border-line-strong')}
                  style={{ background: color }}
                />
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[11.5px] font-medium text-muted">New fill</p>
            <div className="grid grid-cols-10 gap-1">
              <button
                type="button"
                aria-label="Default no fill"
                onClick={() => setStyle((current) => ({ ...current, fill: null }))}
                className={cx('grid h-6 w-full place-items-center rounded-[8px] border text-faint', style.fill === null ? 'border-accent ring-2 ring-accent/25' : 'border-line-strong')}
              >
                <X className="size-3" />
              </button>
              {FILL_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Default fill ${color}`}
                  onClick={() => setStyle((current) => ({ ...current, fill: color }))}
                  className={cx('h-6 w-full rounded-[8px] border transition-transform hover:scale-110', style.fill === color ? 'border-accent ring-2 ring-accent/25' : 'border-line-strong')}
                  style={{ background: color }}
                />
              ))}
            </div>
          </div>
          <Slider label="New stroke width" value={style.strokeWidth} min={1} max={24} step={1} onChange={(value) => setStyle((current) => ({ ...current, strokeWidth: value }))} onStart={() => undefined} />
          <div className="rounded-tile bg-surface-2 p-3 text-[12px] leading-relaxed text-muted">
            <p className="font-medium text-fg">{doc.elements.length} elements</p>
            <p className="mt-1">Space or middle-drag to pan, ⌘/Ctrl + wheel to zoom. Double-click text or a note to edit it.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">
              {selected.length === 1 ? elementLabel(active) : `${selected.length} selected`}
            </p>
            <button type="button" onClick={() => setSelection([])} className="text-[11.5px] text-muted hover:text-fg">
              Deselect
            </button>
          </div>

          <div>
            <p className="mb-1.5 text-[11.5px] font-medium text-muted">Ink</p>
            <div className="grid grid-cols-9 gap-1">
              {INK_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Ink ${color}`}
                  onClick={() => patchSelected({ stroke: color })}
                  className={cx('h-6 w-full rounded-[8px] border transition-transform hover:scale-110', active.stroke === color ? 'border-accent ring-2 ring-accent/25' : 'border-line-strong')}
                  style={{ background: color }}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[11.5px] font-medium text-muted">Fill</p>
            <div className="grid grid-cols-10 gap-1">
              <button
                type="button"
                aria-label="No fill"
                onClick={() => patchSelected({ fill: null })}
                className={cx('grid h-6 w-full place-items-center rounded-[8px] border text-faint', active.fill === null ? 'border-accent ring-2 ring-accent/25' : 'border-line-strong')}
              >
                <X className="size-3" />
              </button>
              {FILL_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Fill ${color}`}
                  onClick={() => patchSelected({ fill: color })}
                  className={cx('h-6 w-full rounded-[8px] border transition-transform hover:scale-110', active.fill === color ? 'border-accent ring-2 ring-accent/25' : 'border-line-strong')}
                  style={{ background: color }}
                />
              ))}
            </div>
          </div>

          <Slider label="Stroke width" value={active.strokeWidth} min={0} max={24} step={1} onChange={(value) => patchSelected({ strokeWidth: value }, false)} onStart={() => pushHistory(docRef.current)} />
          <Slider label="Opacity" value={Math.round(active.opacity * 100)} min={10} max={100} step={5} suffix="%" onChange={(value) => patchSelected({ opacity: value / 100 }, false)} onStart={() => pushHistory(docRef.current)} />

          {(active.kind === 'text' || active.kind === 'note') && (
            <>
              <Slider label="Font size" value={active.fontSize ?? 18} min={10} max={72} step={1} onChange={(value) => patchSelected({ fontSize: value }, false)} onStart={() => pushHistory(docRef.current)} />
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => patchSelected({ bold: !active.bold })} className={cx(iconButton, 'border border-line', active.bold && 'bg-fg text-white')} title="Bold">
                  <Bold />
                </button>
                {(['left', 'center', 'right'] as const).map((align) => (
                  <button key={align} type="button" onClick={() => patchSelected({ align })} className={cx(iconButton, 'border border-line', (active.align ?? 'left') === align && 'bg-fg text-white')} title={`Align ${align}`}>
                    {align === 'left' ? <AlignLeft /> : align === 'center' ? <AlignCenter /> : <AlignRight />}
                  </button>
                ))}
              </div>
            </>
          )}

          {['rect', 'ellipse', 'diamond', 'triangle', 'line', 'arrow'].includes(active.kind) && (
            <button type="button" onClick={() => patchSelected({ dashed: !active.dashed })} className={cx(chip, 'w-full justify-start', active.dashed ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-muted')}>
              Dashed outline
            </button>
          )}

          <div>
            <p className="mb-1.5 text-[11.5px] font-medium text-muted">Position</p>
            <div className="grid grid-cols-2 gap-1.5">
              {(['x', 'y', 'w', 'h'] as const).map((field) => (
                <label key={field} className="flex items-center gap-1.5 rounded-tile border border-line bg-surface px-2 text-[11px] uppercase text-faint">
                  {field}
                  <input
                    type="number"
                    value={Math.round(active[field])}
                    onFocus={() => pushHistory(docRef.current)}
                    onChange={(event) => {
                      const value = Number(event.target.value)
                      if (!Number.isFinite(value)) return
                      patchSelected({ [field]: value } as Partial<BoardElement>, false)
                    }}
                    className="h-8 w-full min-w-0 bg-transparent text-right text-[12px] tabular-nums text-fg outline-none"
                  />
                </label>
              ))}
            </div>
          </div>

          {selected.length > 1 && (
            <div>
              <p className="mb-1.5 text-[11.5px] font-medium text-muted">Align</p>
              <div className="grid grid-cols-6 gap-1">
                {([
                  ['left', 'Left'],
                  ['center-x', 'Center'],
                  ['right', 'Right'],
                  ['top', 'Top'],
                  ['center-y', 'Middle'],
                  ['bottom', 'Bottom'],
                ] as [AlignMode, string][]).map(([mode, label]) => (
                  <button key={mode} type="button" title={label} onClick={() => alignSelection(mode)} className="grid h-7 place-items-center rounded-tile bg-surface-2 text-[10.5px] font-medium text-muted hover:text-fg">
                    {label.slice(0, 3)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="mb-1.5 text-[11.5px] font-medium text-muted">Layer</p>
            <div className="flex gap-1">
              {([
                ['front', <BringToFront key="f" />, 'Bring to front'],
                ['forward', <ArrowUpRight key="u" />, 'Forward'],
                ['backward', <ArrowUpRight key="d" className="rotate-180" />, 'Backward'],
                ['back', <SendToBack key="b" />, 'Send to back'],
              ] as const).map(([action, icon, label]) => (
                <button key={action} type="button" title={label} onClick={() => reorder(action)} className={cx(iconButton, 'border border-line')}>
                  {icon}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 border-t border-line pt-3">
            <button type="button" onClick={duplicateSelected} className={cx(iconButton, 'border border-line')} title="Duplicate (⌘D)">
              <Copy />
            </button>
            <button type="button" onClick={() => patchSelected({ locked: !active.locked })} className={cx(iconButton, 'border border-line', active.locked && 'bg-fg text-white')} title={active.locked ? 'Unlock' : 'Lock'}>
              <Lock />
            </button>
            <button type="button" onClick={() => patchSelected({ hidden: !active.hidden })} className={cx(iconButton, 'border border-line', active.hidden && 'bg-fg text-white')} title={active.hidden ? 'Show' : 'Hide'}>
              {active.hidden ? <EyeOff /> : <Eye />}
            </button>
            <button type="button" onClick={removeSelected} className={cx(iconButton, 'border border-line text-danger hover:bg-danger-soft')} title="Delete">
              <Trash2 />
            </button>
          </div>
        </div>
      )}

      <div className="border-t border-line">
        <p className="px-4 pb-1.5 pt-3 text-[11.5px] font-semibold uppercase tracking-wide text-faint">Layers</p>
        <div className="pb-3">
          {doc.elements.length === 0 && <p className="px-4 pb-3 text-[12.5px] text-faint">Nothing on the board yet.</p>}
          {[...doc.elements].reverse().map((el) => (
            <div
              key={el.id}
              onClick={() => setSelection([el.id])}
              className={cx('flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-[12.5px]', selection.includes(el.id) ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg')}
            >
              <span className="min-w-0 flex-1 truncate">{elementLabel(el)}</span>
              <button
                type="button"
                aria-label={el.hidden ? 'Show layer' : 'Hide layer'}
                onClick={(event) => {
                  event.stopPropagation()
                  patchOne(el.id, { hidden: !el.hidden })
                }}
                className="grid size-6 place-items-center rounded-[6px] hover:bg-surface"
              >
                {el.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
              <button
                type="button"
                aria-label={el.locked ? 'Unlock layer' : 'Lock layer'}
                onClick={(event) => {
                  event.stopPropagation()
                  patchOne(el.id, { locked: !el.locked })
                }}
                className={cx('grid size-6 place-items-center rounded-[6px] hover:bg-surface', el.locked ? 'text-fg' : 'text-faint')}
              >
                <Lock className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  if (loadError) {
    return (
      <div className="grid min-h-screen place-items-center px-6">
        <div className="max-w-sm text-center">
          <p className="text-[15px] font-medium">This board could not be opened</p>
          <p className="mt-1 text-[13px] text-muted">{loadError}</p>
          <Link to="/studio" className="mt-5 inline-flex h-9 items-center rounded-control bg-fg px-4 text-[13.5px] font-medium text-white">
            Back to studio
          </Link>
        </div>
      </div>
    )
  }

  if (!loaded || !board) {
    return (
      <div className="grid min-h-screen place-items-center">
        <span className="text-[13px] text-muted">Opening board…</span>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-bg">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface/85 px-3 backdrop-blur-xl">
        <Link to="/studio" className="grid size-8 shrink-0 place-items-center rounded-tile text-muted transition-colors hover:bg-surface-2 hover:text-fg" aria-label="Back to studio">
          <ArrowLeft className="size-4" />
        </Link>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => void save()}
          spellCheck={false}
          className="min-w-[80px] max-w-[300px] flex-1 truncate rounded-tile bg-transparent px-2 py-1 text-[14.5px] font-semibold tracking-tight outline-none hover:bg-surface-2 focus:bg-surface-2"
        />
        <span className={cx('hidden items-center gap-1.5 rounded-[8px] px-2 py-1 text-[11.5px] font-medium sm:inline-flex', status === 'error' ? 'bg-danger-soft text-danger' : status === 'saved' ? 'bg-success-soft text-success' : 'bg-surface-2 text-muted')}>{statusLabel}</span>

        <div className="ml-auto flex items-center gap-0.5">
          <button type="button" onClick={undo} disabled={past.current.length === 0} className={iconButton} title="Undo (⌘Z)">
            <Undo2 />
          </button>
          <button type="button" onClick={redo} disabled={future.current.length === 0} className={iconButton} title="Redo (⇧⌘Z)">
            <Redo2 />
          </button>
          <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
          <button type="button" onClick={() => zoomBy(1 / 1.2)} className={iconButton} title="Zoom out">
            <ZoomOut />
          </button>
          <button type="button" onClick={() => setView({ zoom: 1, pan: view.pan })} className="hidden h-8 min-w-[48px] items-center justify-center rounded-tile px-1 text-[12px] font-medium tabular-nums text-muted hover:bg-surface-2 hover:text-fg sm:inline-flex" title="Reset to 100%">
            {Math.round(view.zoom * 100)}%
          </button>
          <button type="button" onClick={() => zoomBy(1.2)} className={iconButton} title="Zoom in">
            <ZoomIn />
          </button>
          <button type="button" onClick={fit} className={iconButton} title="Fit to content">
            <Maximize />
          </button>
          <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
          <button type="button" onClick={() => setGridSnap((value) => !value)} className={cx(iconButton, 'max-sm:hidden', gridSnap && 'bg-fg text-white')} title="Snap to grid">
            <Grid3x3 />
          </button>
          <button type="button" onClick={exportPng} className={cx(iconButton, 'max-sm:hidden')} title="Export PNG">
            <Download />
          </button>
          <button type="button" onClick={exportJson} className={cx(iconButton, 'max-sm:hidden')} title="Export JSON">
            <Download className="size-3.5" />
          </button>
          <button type="button" onClick={() => importRef.current?.click()} className={cx(iconButton, 'max-sm:hidden')} title="Import board JSON">
            <Upload />
          </button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) importJson(file)
              event.target.value = ''
            }}
          />
          <button type="button" onClick={() => setDeleteOpen(true)} className={cx(iconButton, 'max-xl:hidden hover:bg-danger-soft hover:text-danger')} title="Delete board">
            <Trash2 />
          </button>
          <button type="button" onClick={() => setPanelOpen(true)} className={cx(iconButton, 'border border-line xl:hidden')} title="Style and layers">
            <SlidersHorizontal />
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <aside className="flex w-14 shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-line bg-surface/70 py-2">
          {TOOL_GROUPS.map((group, index) => (
            <div key={index} className={cx('flex flex-col items-center gap-0.5', index > 0 && 'mt-1 border-t border-line pt-1.5')}>
              {group.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  title={`${entry.label}${entry.key ? ` (${entry.key})` : ''}`}
                  onClick={() => {
                    setTool(entry.id)
                    setEditing(null)
                  }}
                  className={cx('grid size-9 place-items-center rounded-tile transition-colors [&_svg]:size-4', tool === entry.id ? 'bg-fg text-white shadow-card' : 'text-muted hover:bg-surface-2 hover:text-fg')}
                >
                  {entry.icon}
                </button>
              ))}
            </div>
          ))}
        </aside>

        <div className="relative min-w-0 flex-1">
          <Canvas
            doc={doc}
            view={view}
            tool={tool}
            style={style}
            selection={selection}
            editing={editing}
            gridSnap={gridSnap}
            spaceHeld={spaceHeld}
            onView={setView}
            onSelection={setSelection}
            onEdit={setEditing}
            onMutate={apply}
            onHistory={pushHistory}
            onSize={setCanvasSize}
          />
          <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 rounded-[10px] bg-fg/85 px-2.5 py-1.5 text-[11.5px] font-medium text-white/85 shadow-pop backdrop-blur">
            <span>{doc.elements.length} elements</span>
            <span className="text-white/35">·</span>
            <span>Space to pan · ⌘/Ctrl + wheel to zoom</span>
          </div>
          <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-2 rounded-control bg-surface/95 px-2 py-1.5 shadow-card">
            <span className="text-[11.5px] font-medium text-muted">{gridSnap ? 'Snap on' : 'Freehand'}</span>
          </div>
        </div>

        <aside className="hidden w-[292px] shrink-0 flex-col border-l border-line bg-surface/70 xl:flex">{inspector}</aside>
      </div>

      {panelOpen && (
        <div className="fixed inset-0 z-50 flex bg-fg/25 xl:hidden" onMouseDown={(event) => event.target === event.currentTarget && setPanelOpen(false)}>
          <div className="ml-auto flex h-full w-[min(340px,90vw)] flex-col bg-surface shadow-dialog">
            <div className="flex h-12 items-center justify-between border-b border-line px-4">
              <p className="text-[14px] font-semibold">Style & layers</p>
              <button type="button" onClick={() => setPanelOpen(false)} className={iconButton} aria-label="Close panel">
                <X />
              </button>
            </div>
            {inspector}
            <div className="border-t border-line p-3">
              <button type="button" onClick={() => addAtCenter('note')} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-control bg-surface-2 text-[13px] font-medium text-fg">
                <StickyNote className="size-4" /> Add a sticky note
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-fg/30 p-4">
          <div className="w-full max-w-sm rounded-dialog bg-surface p-5 shadow-dialog">
            <p className="text-[15px] font-semibold">Delete this board?</p>
            <p className="mt-1 text-[13px] text-muted">“{title || 'Untitled board'}” and its drawing will be removed. This cannot be undone.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteOpen(false)} className="inline-flex h-9 items-center rounded-control border border-line-strong px-3.5 text-[13.5px] font-medium">
                Cancel
              </button>
              <button type="button" onClick={() => void deleteBoard()} disabled={deleting} className="inline-flex h-9 items-center rounded-control bg-danger px-3.5 text-[13.5px] font-medium text-white disabled:opacity-60">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Slider({ label, value, min, max, step, suffix, onChange, onStart }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (value: number) => void; onStart: () => void }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-[11.5px] font-medium text-muted">
        {label}
        <span className="tabular-nums text-faint">
          {value}
          {suffix ?? ''}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={onStart}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-raised accent-accent"
      />
    </label>
  )
}
