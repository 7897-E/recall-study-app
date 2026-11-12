import type { BoardDoc, BoardElement, BoardElementKind, BoardPoint } from '../../../shared/types'

// The studio document model. Every element is stored as an axis-aligned box
// (x, y, w, h) rotated about its centre; strokes keep their own points and
// lines keep two endpoints, both in world coordinates so hit testing and
// rendering stay simple.

export type Tool = 'select' | 'hand' | 'pen' | 'marker' | 'eraser' | 'rect' | 'ellipse' | 'diamond' | 'triangle' | 'line' | 'arrow' | 'text' | 'note'

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export interface View {
  zoom: number
  pan: BoardPoint
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface InkStyle {
  stroke: string
  fill: string | null
  strokeWidth: number
  fontSize: number
  opacity: number
}

export const INK_COLORS = ['#15141f', '#5b4df0', '#2f77d1', '#1f9d6b', '#c7811a', '#d9483a', '#d1478c', '#8a6a4f', '#ffffff']
export const FILL_COLORS = ['#fdf2c8', '#ffe0d3', '#dcf0ff', '#ddf3e4', '#efe6ff', '#f6dfef', '#e6e6ef', '#ffffff', '#15141f']
export const BACKGROUNDS = ['#fbfaf7', '#ffffff', '#f2f3fb', '#eef5f1', '#fbeee9', '#f4efe4', '#15151f', '#101d24']
export const GRID_STEP = 24
export const MIN_SIZE = 10
export const HANDLE_RADIUS = 5
export const ROTATE_OFFSET = 26

export function emptyDoc(): BoardDoc {
  return { version: 1, background: '#fbfaf7', grid: 'dots', elements: [] }
}

export const uid = () => crypto.randomUUID()

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
export const rad = (degrees: number) => (degrees * Math.PI) / 180

export function rotatePoint(point: BoardPoint, center: BoardPoint, degrees: number): BoardPoint {
  if (!degrees) return { x: point.x, y: point.y }
  const angle = rad(degrees)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dx = point.x - center.x
  const dy = point.y - center.y
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos }
}

export const centerOf = (el: BoardElement): BoardPoint => ({ x: el.x + el.w / 2, y: el.y + el.h / 2 })

export const worldToScreen = (point: BoardPoint, view: View): BoardPoint => ({ x: point.x * view.zoom + view.pan.x, y: point.y * view.zoom + view.pan.y })
export const screenToWorld = (point: BoardPoint, view: View): BoardPoint => ({ x: (point.x - view.pan.x) / view.zoom, y: (point.y - view.pan.y) / view.zoom })

export function cornersOf(el: BoardElement): BoardPoint[] {
  const center = centerOf(el)
  const corners = [
    { x: el.x, y: el.y },
    { x: el.x + el.w, y: el.y },
    { x: el.x + el.w, y: el.y + el.h },
    { x: el.x, y: el.y + el.h },
  ]
  return el.angle ? corners.map((corner) => rotatePoint(corner, center, el.angle)) : corners
}

export function boundsOf(elements: BoardElement[]): Box | null {
  if (elements.length === 0) return null
  const points = elements.flatMap(cornersOf)
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

export function createElement(tool: Tool, at: BoardPoint, style: InkStyle): BoardElement {
  const base = { id: uid(), angle: 0, opacity: style.opacity, stroke: style.stroke, strokeWidth: style.strokeWidth }
  switch (tool) {
    case 'pen':
    case 'marker':
      return { ...base, kind: tool === 'pen' ? 'stroke' : 'highlight', x: at.x, y: at.y, w: 0, h: 0, fill: null, points: [at] }
    case 'text':
      return { ...base, kind: 'text', x: at.x, y: at.y, w: 340, h: Math.max(40, style.fontSize * 1.4), fill: null, strokeWidth: 0, text: '', fontSize: style.fontSize, bold: false, align: 'left' }
    case 'note':
      return {
        ...base,
        kind: 'note',
        x: at.x - 110,
        y: at.y - 78,
        w: 220,
        h: 156,
        fill: style.fill ?? '#fdf2c8',
        stroke: '#00000018',
        strokeWidth: 1,
        text: '',
        fontSize: 16,
        align: 'left',
      }
    case 'line':
    case 'arrow':
      return { ...base, kind: tool, x: at.x, y: at.y, w: 0, h: 0, fill: null, a: at, b: at }
    default:
      return { ...base, kind: tool as BoardElementKind, x: at.x, y: at.y, w: 0, h: 0, fill: style.fill, strokeWidth: style.strokeWidth }
  }
}

/** Keeps negative drag boxes positive so x/y/w/h always describe a real box. */
export function normalizeElement(el: BoardElement): BoardElement {
  const next = { ...el }
  if (next.w < 0) {
    next.x += next.w
    next.w = -next.w
  }
  if (next.h < 0) {
    next.y += next.h
    next.h = -next.h
  }
  return next
}

/** Moves an element's geometry scale with its box (strokes and lines included). */
export function applyBox(el: BoardElement, box: Box): BoardElement {
  const sx = el.w ? box.w / el.w : 1
  const sy = el.h ? box.h / el.h : 1
  const map = (point: BoardPoint): BoardPoint => ({ x: box.x + (point.x - el.x) * sx, y: box.y + (point.y - el.y) * sy })
  return {
    ...el,
    ...box,
    points: el.points?.map(map),
    a: el.a ? map(el.a) : undefined,
    b: el.b ? map(el.b) : undefined,
  }
}

export function resizeElement(el: BoardElement, handle: Handle, pointer: BoardPoint, keepRatio = false): BoardElement {
  const center = centerOf(el)
  const local = rotatePoint(pointer, center, -el.angle)
  const halfW = el.w / 2
  const halfH = el.h / 2
  let left = -halfW
  let right = halfW
  let top = -halfH
  let bottom = halfH
  if (handle.includes('w')) left = Math.min(local.x, right - MIN_SIZE)
  if (handle.includes('e')) right = Math.max(local.x, left + MIN_SIZE)
  if (handle.includes('n')) top = Math.min(local.y, bottom - MIN_SIZE)
  if (handle.includes('s')) bottom = Math.max(local.y, top + MIN_SIZE)
  let width = right - left
  let height = bottom - top
  if (keepRatio && el.w > 0 && el.h > 0) {
    const ratio = el.w / el.h
    if (width / height > ratio) width = height * ratio
    else height = width / ratio
    if (handle.includes('w')) left = right - width
    if (handle.includes('n')) top = bottom - height
  }
  const localCenter = { x: left + width / 2, y: top + height / 2 }
  const worldCenter = rotatePoint({ x: center.x + localCenter.x, y: center.y + localCenter.y }, center, el.angle)
  const box = { x: worldCenter.x - width / 2, y: worldCenter.y - height / 2, w: width, h: height }
  return applyBox(el, box)
}

function distanceToSegment(point: BoardPoint, a: BoardPoint, b: BoardPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = dx * dx + dy * dy
  if (length === 0) return Math.hypot(point.x - a.x, point.y - a.y)
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / length, 0, 1)
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
}

/** Topmost element under a world point. Hidden and locked elements are inert. */
export function elementAt(doc: BoardDoc, point: BoardPoint, zoom: number): BoardElement | null {
  for (let i = doc.elements.length - 1; i >= 0; i--) {
    const el = doc.elements[i]
    if (el.hidden || el.locked) continue
    if (hitTestElement(el, point, zoom)) return el
  }
  return null
}

export function hitTestElement(el: BoardElement, point: BoardPoint, zoom: number): boolean {
  const local = rotatePoint(point, centerOf(el), -el.angle)
  const tolerance = Math.max(6, el.strokeWidth) / Math.max(zoom, 0.15)
  if (el.kind === 'stroke' || el.kind === 'highlight') {
    const points = el.points ?? []
    if (points.length === 0) return false
    if (points.length === 1) return Math.hypot(local.x - points[0].x, local.y - points[0].y) <= tolerance + el.strokeWidth
    const reach = tolerance + (el.kind === 'highlight' ? el.strokeWidth * 1.6 : el.strokeWidth / 2)
    for (let i = 1; i < points.length; i++) {
      if (distanceToSegment(local, points[i - 1], points[i]) <= reach) return true
    }
    return false
  }
  if (el.kind === 'line' || el.kind === 'arrow') {
    if (!el.a || !el.b) return false
    return distanceToSegment(local, el.a, el.b) <= tolerance + el.strokeWidth
  }
  if (el.kind === 'ellipse') {
    const rx = Math.max(el.w / 2, 1)
    const ry = Math.max(el.h / 2, 1)
    const cx = el.x + el.w / 2
    const cy = el.y + el.h / 2
    const value = ((local.x - cx) / (rx + tolerance)) ** 2 + ((local.y - cy) / (ry + tolerance)) ** 2
    return value <= 1
  }
  return local.x >= el.x - tolerance && local.x <= el.x + el.w + tolerance && local.y >= el.y - tolerance && local.y <= el.y + el.h + tolerance
}

export function touchesBox(el: BoardElement, box: Box): boolean {
  const points = cornersOf(el)
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  return Math.min(...xs) <= box.x + box.w && Math.max(...xs) >= box.x && Math.min(...ys) <= box.y + box.h && Math.max(...ys) >= box.y
}

export function handlePoints(el: BoardElement, view: View): { handle: Handle; x: number; y: number }[] {
  const center = centerOf(el)
  const half = { x: el.w / 2, y: el.h / 2 }
  const corner = (dx: number, dy: number) => worldToScreen(rotatePoint({ x: center.x + dx * half.x, y: center.y + dy * half.y }, center, el.angle), view)
  const nw = corner(-1, -1)
  const ne = corner(1, -1)
  const se = corner(1, 1)
  const sw = corner(-1, 1)
  const mid = (a: BoardPoint, b: BoardPoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  return [
    { handle: 'nw', ...nw },
    { handle: 'n', ...mid(nw, ne) },
    { handle: 'ne', ...ne },
    { handle: 'e', ...mid(ne, se) },
    { handle: 'se', ...se },
    { handle: 's', ...mid(se, sw) },
    { handle: 'sw', ...sw },
    { handle: 'w', ...mid(sw, nw) },
  ]
}

export function rotateHandlePoint(el: BoardElement, view: View): BoardPoint {
  const center = centerOf(el)
  const angle = rad(el.angle)
  const offset = ROTATE_OFFSET / view.zoom
  const top = { x: center.x - Math.sin(angle) * (el.h / 2 + offset), y: center.y - Math.cos(angle) * (el.h / 2 + offset) }
  return worldToScreen(top, view)
}

export function handleAt(el: BoardElement, screenPoint: BoardPoint, view: View): Handle | null {
  const grab = 9
  for (const point of handlePoints(el, view)) {
    if (Math.abs(point.x - screenPoint.x) <= grab && Math.abs(point.y - screenPoint.y) <= grab) return point.handle
  }
  return null
}

export function nearRotateHandle(el: BoardElement, screenPoint: BoardPoint, view: View): boolean {
  const point = rotateHandlePoint(el, view)
  return Math.hypot(point.x - screenPoint.x, point.y - screenPoint.y) <= 11
}

export function duplicateElements(doc: BoardDoc, ids: string[], offset = 24): { doc: BoardDoc; ids: string[] } {
  const chosen = doc.elements.filter((el) => ids.includes(el.id))
  const copies = chosen.map((el) => ({ ...el, id: uid(), x: el.x + offset, y: el.y + offset, a: el.a ? { x: el.a.x + offset, y: el.a.y + offset } : undefined, b: el.b ? { x: el.b.x + offset, y: el.b.y + offset } : undefined, points: el.points?.map((p) => ({ x: p.x + offset, y: p.y + offset })) }))
  return { doc: { ...doc, elements: [...doc.elements, ...copies] }, ids: copies.map((el) => el.id) }
}

export type AlignMode = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom'

export function alignBoxes(elements: BoardElement[], mode: AlignMode): Record<string, Box> {
  const bounds = boundsOf(elements)
  const result: Record<string, Box> = {}
  if (!bounds) return result
  for (const el of elements) {
    const box = { x: el.x, y: el.y, w: el.w, h: el.h }
    if (mode === 'left') box.x = bounds.x
    if (mode === 'center-x') box.x = bounds.x + (bounds.w - el.w) / 2
    if (mode === 'right') box.x = bounds.x + bounds.w - el.w
    if (mode === 'top') box.y = bounds.y
    if (mode === 'center-y') box.y = bounds.y + (bounds.h - el.h) / 2
    if (mode === 'bottom') box.y = bounds.y + bounds.h - el.h
    result[el.id] = box
  }
  return result
}

export function zOrder(doc: BoardDoc, ids: string[], action: 'front' | 'back' | 'forward' | 'backward'): BoardDoc {
  const elements = [...doc.elements]
  const chosen = new Set(ids)
  if (chosen.size === 0) return doc
  if (action === 'front') {
    return { ...doc, elements: [...elements.filter((el) => !chosen.has(el.id)), ...elements.filter((el) => chosen.has(el.id))] }
  }
  if (action === 'back') {
    return { ...doc, elements: [...elements.filter((el) => chosen.has(el.id)), ...elements.filter((el) => !chosen.has(el.id))] }
  }
  if (action === 'forward') {
    // Walk from the top so a block of selected elements moves together.
    for (let i = elements.length - 2; i >= 0; i--) {
      if (chosen.has(elements[i].id) && !chosen.has(elements[i + 1].id)) {
        const [moved] = elements.splice(i, 1)
        elements.splice(i + 1, 0, moved)
      }
    }
  } else {
    for (let i = 1; i < elements.length; i++) {
      if (chosen.has(elements[i].id) && !chosen.has(elements[i - 1].id)) {
        const [moved] = elements.splice(i, 1)
        elements.splice(i - 1, 0, moved)
      }
    }
  }
  return { ...doc, elements }
}

export function sanitizeDoc(input: unknown): BoardDoc | null {
  if (!input || typeof input !== 'object') return null
  const candidate = input as Partial<BoardDoc>
  if (!Array.isArray(candidate.elements)) return null
  const elements = candidate.elements.filter((el): el is BoardElement => Boolean(el) && typeof el === 'object' && typeof (el as BoardElement).id === 'string' && typeof (el as BoardElement).kind === 'string')
  return {
    version: 1,
    background: typeof candidate.background === 'string' ? candidate.background : '#fbfaf7',
    grid: candidate.grid === 'lines' || candidate.grid === 'blank' ? candidate.grid : 'dots',
    elements,
  }
}
