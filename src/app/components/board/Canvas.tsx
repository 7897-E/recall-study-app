import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'

import type { BoardDoc, BoardElement, BoardPoint } from '../../../shared/types'
import {
  GRID_STEP,
  type Handle,
  type InkStyle,
  type Tool,
  type View,
  centerOf,
  clamp,
  createElement,
  elementAt,
  handleAt,
  nearRotateHandle,
  normalizeElement,
  resizeElement,
  screenToWorld,
  touchesBox,
  withSmoothedPoints,
} from './model'
import { drawMarquee, drawScene, drawSelection, inkOn } from './render'

const HANDLE_CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
}

type Interaction =
  | { type: 'pan'; startScreen: BoardPoint; startPan: BoardPoint }
  | { type: 'draw'; element: BoardElement; startDoc: BoardDoc }
  | { type: 'move'; startWorld: BoardPoint; elements: BoardElement[]; startDoc: BoardDoc; pushed: boolean }
  | { type: 'resize'; handle: Handle; startEl: BoardElement; startDoc: BoardDoc; pushed: boolean }
  | { type: 'rotate'; id: string; center: BoardPoint; startAngle: number; angle0: number; startDoc: BoardDoc; pushed: boolean }
  | { type: 'marquee'; startWorld: BoardPoint; base: string[] }
  | { type: 'erase'; startDoc: BoardDoc; pushed: boolean }

export interface CanvasProps {
  doc: BoardDoc
  view: View
  tool: Tool
  style: InkStyle
  selection: string[]
  editing: string | null
  gridSnap: boolean
  spaceHeld: boolean
  onView: (view: View) => void
  onSelection: (ids: string[]) => void
  onEdit: (id: string | null) => void
  onMutate: (mutator: (doc: BoardDoc) => BoardDoc) => void
  onHistory: (snapshot: BoardDoc) => void
  onSize?: (size: { w: number; h: number }) => void
}

function translate(el: BoardElement, dx: number, dy: number): BoardElement {
  return {
    ...el,
    x: el.x + dx,
    y: el.y + dy,
    a: el.a ? { x: el.a.x + dx, y: el.a.y + dy } : undefined,
    b: el.b ? { x: el.b.x + dx, y: el.b.y + dy } : undefined,
    points: el.points?.map((point) => ({ x: point.x + dx, y: point.y + dy })),
  }
}

function isMeaningful(el: BoardElement): boolean {
  if (el.kind === 'stroke' || el.kind === 'highlight') return (el.points?.length ?? 0) >= 1
  if (el.kind === 'line' || el.kind === 'arrow') return Boolean(el.a && el.b) && Math.hypot((el.b?.x ?? 0) - (el.a?.x ?? 0), (el.b?.y ?? 0) - (el.a?.y ?? 0)) > 4
  return el.w > 6 && el.h > 6
}

export function Canvas({ doc, view, tool, style, selection, editing, gridSnap, spaceHeld, onView, onSelection, onEdit, onMutate, onHistory, onSize }: CanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const docRef = useRef(doc)
  docRef.current = doc
  const interactionRef = useRef<Interaction | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [draft, setDraft] = useState<BoardElement | null>(null)
  const draftRef = useRef<BoardElement | null>(null)
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [cursor, setCursor] = useState('default')
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const textRef = useRef('')
  textRef.current = text
  const committingRef = useRef(false)

  const editingEl = editing ? doc.elements.find((el) => el.id === editing) : undefined

  useEffect(() => {
    const node = wrapRef.current
    if (!node) return
    const measure = () => setSize({ w: node.clientWidth, h: node.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    onSize?.(size)
  }, [size, onSize])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.w === 0 || size.h === 0) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(size.w * dpr)
    canvas.height = Math.round(size.h * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const scene = draft ? { ...doc, elements: [...doc.elements, draft] } : doc
    drawScene(ctx, scene, view, size.w, size.h)
    drawSelection(ctx, doc, selection, view)
    if (marquee) drawMarquee(ctx, marquee, view)
  }, [doc, draft, selection, view, size, marquee])

  useEffect(() => {
    setText(editingEl?.text ?? '')
    // Only re-seed when a different element opens for editing; typing must not
    // be reset by autosave or selection updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  // A brand new note or text box should be ready to type into: React's
  // autoFocus can lose the race with the pointerup that created it.
  useEffect(() => {
    if (!editing) return
    const timer = window.setTimeout(() => {
      const node = textareaRef.current
      if (!node) return
      node.focus({ preventScroll: true })
      node.select()
    }, 40)
    return () => window.clearTimeout(timer)
  }, [editing])

  useEffect(() => {
    setCursor(tool === 'select' ? 'default' : tool === 'hand' ? 'grab' : tool === 'eraser' ? 'cell' : 'crosshair')
  }, [tool])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      if (event.ctrlKey || event.metaKey) {
        const nextZoom = clamp(view.zoom * Math.exp(-event.deltaY * 0.0018), 0.1, 5)
        const world = screenToWorld(point, view)
        onView({ zoom: nextZoom, pan: { x: point.x - world.x * nextZoom, y: point.y - world.y * nextZoom } })
      } else {
        onView({ zoom: view.zoom, pan: { x: view.pan.x - event.deltaX, y: view.pan.y - event.deltaY } })
      }
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [view, onView])

  function commitEditing() {
    if (!editing || committingRef.current) return
    const el = docRef.current.elements.find((item) => item.id === editing)
    committingRef.current = true
    const value = textRef.current
    onMutate((current) => ({
      ...current,
      elements:
        el && el.kind === 'text' && !value.trim()
          ? current.elements.filter((item) => item.id !== el.id)
          : current.elements.map((item) => (item.id === editing ? { ...item, text: value } : item)),
    }))
    onEdit(null)
    window.setTimeout(() => {
      committingRef.current = false
    }, 0)
  }

  function eraseAt(world: BoardPoint, drag: Extract<Interaction, { type: 'erase' }>) {
    const current = docRef.current
    const hit = elementAt(current, world, view.zoom)
    if (!hit) return
    if (!drag.pushed) {
      onHistory(current)
      drag.pushed = true
    }
    onMutate((next) => ({ ...next, elements: next.elements.filter((el) => el.id !== hit.id) }))
  }

  function grow(start: BoardElement, world: BoardPoint): BoardElement {
    if (start.kind === 'stroke' || start.kind === 'highlight') {
      const points = start.points ?? []
      const last = points[points.length - 1]
      // Sample densely: the renderer turns these points into a curve, so a
      // short minimum step keeps corners from being cut off between events.
      const minStep = (start.kind === 'highlight' ? 2.4 : 0.9) / view.zoom
      const next = !last || Math.hypot(world.x - last.x, world.y - last.y) > minStep ? [...points, world] : points
      const xs = next.map((point) => point.x)
      const ys = next.map((point) => point.y)
      const minX = Math.min(...xs)
      const minY = Math.min(...ys)
      return { ...start, points: next, x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY }
    }
    if (start.kind === 'line' || start.kind === 'arrow') {
      const a = start.a ?? { x: start.x, y: start.y }
      return { ...start, a, b: world, x: Math.min(a.x, world.x), y: Math.min(a.y, world.y), w: Math.abs(a.x - world.x), h: Math.abs(a.y - world.y) }
    }
    return normalizeElement({ ...start, w: world.x - start.x, h: world.y - start.y })
  }

  function updateCursor(screen: BoardPoint, world: BoardPoint) {
    if (spaceHeld || tool === 'hand') {
      setCursor('grab')
      return
    }
    if (tool !== 'select') {
      setCursor(tool === 'eraser' ? 'cell' : 'crosshair')
      return
    }
    const primary = selection.length === 1 ? doc.elements.find((el) => el.id === selection[0]) : undefined
    if (primary && !primary.hidden) {
      if (nearRotateHandle(primary, screen, view)) {
        setCursor('grab')
        return
      }
      const handle = handleAt(primary, screen, view)
      if (handle) {
        setCursor(HANDLE_CURSORS[handle])
        return
      }
    }
    setCursor(elementAt(doc, world, view.zoom) ? 'move' : 'default')
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 && event.button !== 1) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const rect = event.currentTarget.getBoundingClientRect()
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    const world = screenToWorld(screen, view)
    if (editing) commitEditing()

    if (event.button === 1 || spaceHeld || tool === 'hand') {
      interactionRef.current = { type: 'pan', startScreen: screen, startPan: view.pan }
      setCursor('grabbing')
      return
    }

    const current = docRef.current

    if (tool === 'select') {
      const primary = selection.length === 1 ? current.elements.find((el) => el.id === selection[0]) : undefined
      if (primary && !primary.locked) {
        if (nearRotateHandle(primary, screen, view)) {
          const center = centerOf(primary)
          interactionRef.current = {
            type: 'rotate',
            id: primary.id,
            center,
            startAngle: Math.atan2(world.y - center.y, world.x - center.x) * (180 / Math.PI),
            angle0: primary.angle,
            startDoc: current,
            pushed: false,
          }
          return
        }
        const handle = handleAt(primary, screen, view)
        if (handle) {
          interactionRef.current = { type: 'resize', handle, startEl: primary, startDoc: current, pushed: false }
          return
        }
      }

      const hit = elementAt(current, world, view.zoom)
      if (hit) {
        const ids = event.shiftKey
          ? selection.includes(hit.id)
            ? selection.filter((id) => id !== hit.id)
            : [...selection, hit.id]
          : selection.includes(hit.id) && selection.length > 0
            ? selection
            : [hit.id]
        onSelection(ids)
        interactionRef.current = { type: 'move', startWorld: world, elements: current.elements.filter((el) => ids.includes(el.id)), startDoc: current, pushed: false }
        return
      }
      if (!event.shiftKey) onSelection([])
      interactionRef.current = { type: 'marquee', startWorld: world, base: event.shiftKey ? selection : [] }
      setMarquee({ x: world.x, y: world.y, w: 0, h: 0 })
      return
    }

    if (tool === 'eraser') {
      const drag: Interaction = { type: 'erase', startDoc: current, pushed: false }
      interactionRef.current = drag
      eraseAt(world, drag)
      return
    }

    const element = createElement(tool, world, style)
    if (tool === 'text' || tool === 'note') {
      if (gridSnap) {
        element.x = Math.round(element.x / GRID_STEP) * GRID_STEP
        element.y = Math.round(element.y / GRID_STEP) * GRID_STEP
      }
      onHistory(current)
      onMutate((next) => ({ ...next, elements: [...next.elements, element] }))
      onSelection([element.id])
      onEdit(element.id)
      return
    }
    interactionRef.current = { type: 'draw', element, startDoc: current }
    setDraft(element)
    draftRef.current = element
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    const world = screenToWorld(screen, view)
    const drag = interactionRef.current
    if (!drag) {
      updateCursor(screen, world)
      return
    }
    switch (drag.type) {
      case 'pan':
        onView({ zoom: view.zoom, pan: { x: drag.startPan.x + (screen.x - drag.startScreen.x), y: drag.startPan.y + (screen.y - drag.startScreen.y) } })
        return
      case 'draw': {
        // A pointermove can carry several samples; using them all is what makes
        // fast strokes smooth instead of a handful of long straight segments.
        const native = event.nativeEvent
        const coalesced = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : []
        const samples = coalesced.length ? coalesced : [native]
        let next = drag.element
        for (const sample of samples) {
          next = grow(next, screenToWorld({ x: sample.clientX - rect.left, y: sample.clientY - rect.top }, view))
        }
        if (next === drag.element) return
        drag.element = next
        draftRef.current = next
        setDraft(next)
        return
      }
      case 'move': {
        let dx = world.x - drag.startWorld.x
        let dy = world.y - drag.startWorld.y
        const anchor = drag.elements[0]
        if (gridSnap && anchor) {
          dx = Math.round((anchor.x + dx) / GRID_STEP) * GRID_STEP - anchor.x
          dy = Math.round((anchor.y + dy) / GRID_STEP) * GRID_STEP - anchor.y
        }
        if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return
        if (!drag.pushed) {
          onHistory(drag.startDoc)
          drag.pushed = true
        }
        const moved = new Map(drag.elements.map((el) => [el.id, translate(el, dx, dy)]))
        onMutate((current) => ({ ...current, elements: current.elements.map((el) => moved.get(el.id) ?? el) }))
        return
      }
      case 'resize': {
        const target = gridSnap ? { x: Math.round(world.x / GRID_STEP) * GRID_STEP, y: Math.round(world.y / GRID_STEP) * GRID_STEP } : world
        if (!drag.pushed) {
          onHistory(drag.startDoc)
          drag.pushed = true
        }
        const next = resizeElement(drag.startEl, drag.handle, target, event.shiftKey)
        onMutate((current) => ({ ...current, elements: current.elements.map((el) => (el.id === next.id ? next : el)) }))
        return
      }
      case 'rotate': {
        const raw = Math.atan2(world.y - drag.center.y, world.x - drag.center.x) * (180 / Math.PI)
        const angle = drag.angle0 + raw - drag.startAngle
        const snapped = event.shiftKey ? Math.round(angle / 15) * 15 : Math.round(angle * 10) / 10
        if (!drag.pushed) {
          onHistory(drag.startDoc)
          drag.pushed = true
        }
        onMutate((current) => ({ ...current, elements: current.elements.map((el) => (el.id === drag.id ? { ...el, angle: snapped } : el)) }))
        return
      }
      case 'marquee': {
        const box = {
          x: Math.min(drag.startWorld.x, world.x),
          y: Math.min(drag.startWorld.y, world.y),
          w: Math.abs(world.x - drag.startWorld.x),
          h: Math.abs(world.y - drag.startWorld.y),
        }
        setMarquee(box)
        const ids = docRef.current.elements.filter((el) => !el.hidden && touchesBox(el, box)).map((el) => el.id)
        onSelection([...new Set([...drag.base, ...ids])])
        return
      }
      case 'erase':
        eraseAt(world, drag)
        return
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const drag = interactionRef.current
    interactionRef.current = null
    if (!drag) return
    if (drag.type === 'draw') {
      const drawn = draftRef.current
      draftRef.current = null
      setDraft(null)
      const element = drawn && (drawn.kind === 'stroke' || drawn.kind === 'highlight') ? withSmoothedPoints(drawn) : drawn
      if (element && isMeaningful(element)) {
        onHistory(drag.startDoc)
        onMutate((current) => ({ ...current, elements: [...current.elements, element] }))
        onSelection([element.id])
      }
    }
    if (drag.type === 'marquee') setMarquee(null)
    if (drag.type === 'pan') setCursor(spaceHeld ? 'grab' : tool === 'hand' ? 'grab' : 'default')
  }

  function handleDoubleClick(event: ReactMouseEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const world = screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top }, view)
    const hit = elementAt(docRef.current, world, view.zoom)
    if (hit && (hit.kind === 'text' || hit.kind === 'note')) {
      onSelection([hit.id])
      onEdit(hit.id)
    }
  }

  const overlay = editingEl
    ? {
        left: editingEl.x * view.zoom + view.pan.x,
        top: editingEl.y * view.zoom + view.pan.y,
        width: Math.max(40, editingEl.w * view.zoom),
        height: Math.max(28, editingEl.h * view.zoom),
        fontSize: Math.max(9, (editingEl.fontSize ?? 18) * view.zoom),
      }
    : null

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none"
        style={{ cursor }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(event) => event.preventDefault()}
      />
      {editingEl && overlay && (
        <div className="pointer-events-none absolute inset-0">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onBlur={commitEditing}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) {
                event.preventDefault()
                commitEditing()
              }
            }}
            placeholder={editingEl.kind === 'note' ? 'Write a note…' : 'Type something…'}
            className="pointer-events-auto absolute resize-none overflow-hidden outline-none"
            style={{
              left: overlay.left,
              top: overlay.top,
              width: overlay.width,
              height: overlay.height,
              fontSize: overlay.fontSize,
              lineHeight: editingEl.kind === 'note' ? 1.38 : 1.32,
              padding: editingEl.kind === 'note' ? 16 * view.zoom : 0,
              transform: editingEl.angle ? `rotate(${editingEl.angle}deg)` : undefined,
              transformOrigin: 'center',
              borderRadius: editingEl.kind === 'note' ? 10 : 4,
              background: editingEl.kind === 'note' ? (editingEl.fill ?? '#fdf2c8') : 'transparent',
              color: editingEl.kind === 'note' ? inkOn(editingEl.fill) : editingEl.stroke,
              border: '2px solid #5b4df0',
              boxShadow: '0 0 0 4px rgb(91 77 240 / 0.16)',
              fontWeight: editingEl.bold ? 680 : 450,
            }}
          />
        </div>
      )}
    </div>
  )
}
