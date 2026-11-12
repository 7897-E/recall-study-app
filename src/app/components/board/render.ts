import type { BoardDoc, BoardElement, BoardPoint } from '../../../shared/types'
import { boundsOf, centerOf, cornersOf, handlePoints, rad, rotateHandlePoint, worldToScreen, type View } from './model'

// Canvas rendering for the studio. drawScene paints one frame for the live
// editor; renderBoardCanvas and boardThumbnail reuse the same element painter
// for PNG export and gallery previews.

const SANS = "'Plus Jakarta Sans Variable', ui-sans-serif, system-ui, sans-serif"
const ACCENT = '#5b4df0'
const GRID_STEP = 24

export function isDark(hex: string): boolean {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value.slice(0, 6)
  const r = parseInt(full.slice(0, 2), 16) || 0
  const g = parseInt(full.slice(2, 4), 16) || 0
  const b = parseInt(full.slice(4, 6), 16) || 0
  return (r * 299 + g * 587 + b * 114) / 1000 < 130
}

export const inkOn = (fill: string | null): string => (fill && isDark(fill) ? '#f7f6fb' : '#15141f')

export const fontFor = (el: BoardElement): string => `${el.bold ? 680 : 450} ${el.fontSize ?? 18}px ${SANS}`

export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, el: BoardElement): string[] {
  ctx.font = fontFor(el)
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (!paragraph.trim()) {
      lines.push('')
      continue
    }
    const words = paragraph.split(/\s+/)
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (!line || ctx.measureText(candidate).width <= maxWidth) line = candidate
      else {
        lines.push(line)
        line = word
      }
    }
    if (line) lines.push(line)
  }
  return lines
}

function arrowHead(ctx: CanvasRenderingContext2D, a: BoardPoint, b: BoardPoint, width: number) {
  const angle = Math.atan2(b.y - a.y, b.x - a.x)
  const size = 7 + width * 2.2
  ctx.beginPath()
  ctx.moveTo(b.x, b.y)
  ctx.lineTo(b.x - size * Math.cos(angle - 0.42), b.y - size * Math.sin(angle - 0.42))
  ctx.lineTo(b.x - size * Math.cos(angle + 0.42), b.y - size * Math.sin(angle + 0.42))
  ctx.closePath()
  ctx.fill()
}

export function drawElement(ctx: CanvasRenderingContext2D, el: BoardElement) {
  if (el.hidden) return
  ctx.save()
  ctx.globalAlpha = Math.max(0.02, Math.min(1, el.opacity))
  const center = centerOf(el)
  if (el.angle) {
    ctx.translate(center.x, center.y)
    ctx.rotate(rad(el.angle))
    ctx.translate(-center.x, -center.y)
  }
  const width = Math.max(0.5, el.strokeWidth)
  ctx.lineJoin = 'round'

  switch (el.kind) {
    case 'stroke':
    case 'highlight': {
      const points = el.points ?? []
      if (points.length === 0) break
      ctx.strokeStyle = el.stroke
      ctx.lineWidth = el.kind === 'highlight' ? width * 3 : width
      ctx.lineCap = 'round'
      if (el.kind === 'highlight') ctx.globalAlpha *= 0.32
      if (points.length === 1) {
        ctx.fillStyle = el.stroke
        ctx.beginPath()
        ctx.arc(points[0].x, points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2)
        ctx.fill()
        break
      }
      ctx.beginPath()
      ctx.moveTo(points[0].x, points[0].y)
      for (let i = 1; i < points.length - 1; i++) {
        const mid = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 }
        ctx.quadraticCurveTo(points[i].x, points[i].y, mid.x, mid.y)
      }
      const last = points[points.length - 1]
      ctx.lineTo(last.x, last.y)
      ctx.stroke()
      break
    }
    case 'rect': {
      ctx.beginPath()
      ctx.roundRect(el.x, el.y, el.w, el.h, Math.min(18, Math.max(4, Math.min(el.w, el.h) * 0.08)))
      if (el.fill) {
        ctx.fillStyle = el.fill
        ctx.fill()
      }
      if (el.strokeWidth > 0) {
        ctx.strokeStyle = el.stroke
        ctx.lineWidth = width
        if (el.dashed) ctx.setLineDash([width * 3, width * 2.2])
        ctx.stroke()
      }
      break
    }
    case 'ellipse': {
      ctx.beginPath()
      ctx.ellipse(el.x + el.w / 2, el.y + el.h / 2, Math.max(0.5, el.w / 2), Math.max(0.5, el.h / 2), 0, 0, Math.PI * 2)
      if (el.fill) {
        ctx.fillStyle = el.fill
        ctx.fill()
      }
      if (el.strokeWidth > 0) {
        ctx.strokeStyle = el.stroke
        ctx.lineWidth = width
        if (el.dashed) ctx.setLineDash([width * 3, width * 2.2])
        ctx.stroke()
      }
      break
    }
    case 'diamond':
    case 'triangle': {
      ctx.beginPath()
      if (el.kind === 'diamond') {
        ctx.moveTo(el.x + el.w / 2, el.y)
        ctx.lineTo(el.x + el.w, el.y + el.h / 2)
        ctx.lineTo(el.x + el.w / 2, el.y + el.h)
        ctx.lineTo(el.x, el.y + el.h / 2)
      } else {
        ctx.moveTo(el.x + el.w / 2, el.y)
        ctx.lineTo(el.x + el.w, el.y + el.h)
        ctx.lineTo(el.x, el.y + el.h)
      }
      ctx.closePath()
      if (el.fill) {
        ctx.fillStyle = el.fill
        ctx.fill()
      }
      if (el.strokeWidth > 0) {
        ctx.strokeStyle = el.stroke
        ctx.lineWidth = width
        if (el.dashed) ctx.setLineDash([width * 3, width * 2.2])
        ctx.stroke()
      }
      break
    }
    case 'line':
    case 'arrow': {
      if (!el.a || !el.b) break
      ctx.strokeStyle = el.stroke
      ctx.fillStyle = el.stroke
      ctx.lineWidth = width
      ctx.lineCap = 'round'
      if (el.dashed) ctx.setLineDash([width * 3.5, width * 2.5])
      ctx.beginPath()
      ctx.moveTo(el.a.x, el.a.y)
      ctx.lineTo(el.b.x, el.b.y)
      ctx.stroke()
      if (el.kind === 'arrow') arrowHead(ctx, el.a, el.b, width)
      break
    }
    case 'text': {
      const text = el.text ?? ''
      if (!text) break
      const lines = wrapLines(ctx, text, Math.max(20, el.w), el)
      const lineHeight = (el.fontSize ?? 18) * 1.32
      ctx.fillStyle = el.stroke
      ctx.textBaseline = 'top'
      ctx.textAlign = el.align === 'center' ? 'center' : el.align === 'right' ? 'right' : 'left'
      const x = el.align === 'center' ? el.x + el.w / 2 : el.align === 'right' ? el.x + el.w : el.x
      lines.forEach((line, index) => ctx.fillText(line, x, el.y + index * lineHeight))
      break
    }
    case 'note': {
      const pad = 16
      ctx.shadowColor = 'rgba(21,20,31,0.16)'
      ctx.shadowBlur = 18
      ctx.shadowOffsetY = 5
      ctx.fillStyle = el.fill ?? '#fdf2c8'
      ctx.beginPath()
      ctx.roundRect(el.x, el.y, el.w, el.h, 10)
      ctx.fill()
      ctx.shadowColor = 'transparent'
      // Folded corner.
      ctx.fillStyle = 'rgba(21,20,31,0.07)'
      ctx.beginPath()
      ctx.moveTo(el.x + el.w - 22, el.y + el.h)
      ctx.lineTo(el.x + el.w, el.y + el.h - 22)
      ctx.lineTo(el.x + el.w, el.y + el.h)
      ctx.closePath()
      ctx.fill()
      const text = el.text ?? ''
      if (text) {
        const lines = wrapLines(ctx, text, Math.max(20, el.w - pad * 2), el)
        const lineHeight = (el.fontSize ?? 16) * 1.38
        ctx.fillStyle = inkOn(el.fill)
        ctx.textBaseline = 'top'
        ctx.textAlign = 'left'
        lines.forEach((line, index) => ctx.fillText(line, el.x + pad, el.y + pad + index * lineHeight))
      }
      break
    }
  }
  ctx.restore()
}

function drawGrid(ctx: CanvasRenderingContext2D, doc: BoardDoc, view: View, width: number, height: number) {
  const step = GRID_STEP
  if (step * view.zoom < 9) return
  const start = { x: (0 - view.pan.x) / view.zoom, y: (0 - view.pan.y) / view.zoom }
  const end = { x: (width - view.pan.x) / view.zoom, y: (height - view.pan.y) / view.zoom }
  const x0 = Math.floor(start.x / step) * step
  const y0 = Math.floor(start.y / step) * step
  const columns = Math.ceil((end.x - x0) / step)
  const rows = Math.ceil((end.y - y0) / step)
  if (columns * rows > 20_000) return
  const dark = isDark(doc.background)
  ctx.save()
  if (doc.grid === 'dots') {
    ctx.fillStyle = dark ? 'rgba(255,255,255,0.16)' : 'rgba(21,20,31,0.13)'
    const size = Math.max(1.1, Math.min(2.4, view.zoom * 1.6))
    for (let x = x0; x <= end.x; x += step) {
      for (let y = y0; y <= end.y; y += step) {
        const sx = x * view.zoom + view.pan.x
        const sy = y * view.zoom + view.pan.y
        ctx.fillRect(sx, sy, size, size)
      }
    }
  } else if (doc.grid === 'lines') {
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.09)' : 'rgba(21,20,31,0.07)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = x0; x <= end.x; x += step) {
      const sx = Math.round(x * view.zoom + view.pan.x) + 0.5
      ctx.moveTo(sx, 0)
      ctx.lineTo(sx, height)
    }
    for (let y = y0; y <= end.y; y += step) {
      const sy = Math.round(y * view.zoom + view.pan.y) + 0.5
      ctx.moveTo(0, sy)
      ctx.lineTo(width, sy)
    }
    ctx.stroke()
  }
  ctx.restore()
}

export function drawScene(ctx: CanvasRenderingContext2D, doc: BoardDoc, view: View, width: number, height: number) {
  ctx.save()
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = doc.background
  ctx.fillRect(0, 0, width, height)
  if (doc.grid !== 'blank') drawGrid(ctx, doc, view, width, height)
  ctx.translate(view.pan.x, view.pan.y)
  ctx.scale(view.zoom, view.zoom)
  for (const el of doc.elements) drawElement(ctx, el)
  ctx.restore()
}

export function drawSelection(ctx: CanvasRenderingContext2D, doc: BoardDoc, selection: string[], view: View) {
  const chosen = doc.elements.filter((el) => selection.includes(el.id) && !el.hidden)
  if (chosen.length === 0) return
  ctx.save()
  ctx.strokeStyle = ACCENT
  ctx.lineWidth = 1.5
  if (chosen.length > 1) {
    const bounds = boundsOf(chosen)
    if (bounds) {
      const point = worldToScreen({ x: bounds.x, y: bounds.y }, view)
      ctx.setLineDash([6, 4])
      ctx.strokeRect(point.x - 3, point.y - 3, bounds.w * view.zoom + 6, bounds.h * view.zoom + 6)
      ctx.setLineDash([])
    }
    ctx.restore()
    return
  }

  const el = chosen[0]
  const corners = cornersOf(el).map((point) => worldToScreen(point, view))
  ctx.setLineDash([6, 4])
  ctx.beginPath()
  ctx.moveTo(corners[0].x, corners[0].y)
  for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y)
  ctx.closePath()
  ctx.stroke()
  ctx.setLineDash([])

  const handles = handlePoints(el, view)
  const topMid = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 }
  const rotate = rotateHandlePoint(el, view)
  ctx.beginPath()
  ctx.moveTo(topMid.x, topMid.y)
  ctx.lineTo(rotate.x, rotate.y)
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(rotate.x, rotate.y, 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = '#ffffff'
  for (const handle of handles) {
    ctx.beginPath()
    ctx.rect(handle.x - 4.5, handle.y - 4.5, 9, 9)
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

export function drawMarquee(ctx: CanvasRenderingContext2D, box: { x: number; y: number; w: number; h: number }, view: View) {
  const point = worldToScreen({ x: box.x, y: box.y }, view)
  ctx.save()
  ctx.fillStyle = 'rgba(91,77,240,0.10)'
  ctx.strokeStyle = ACCENT
  ctx.lineWidth = 1
  ctx.setLineDash([5, 4])
  ctx.fillRect(point.x, point.y, box.w * view.zoom, box.h * view.zoom)
  ctx.strokeRect(point.x, point.y, box.w * view.zoom, box.h * view.zoom)
  ctx.restore()
}

export function renderBoardCanvas(doc: BoardDoc, scale = 2, padding = 64): HTMLCanvasElement | null {
  const visible = doc.elements.filter((el) => !el.hidden)
  const bounds = boundsOf(visible) ?? { x: 0, y: 0, w: 960, h: 640 }
  const width = Math.max(240, bounds.w + padding * 2)
  const height = Math.max(240, bounds.h + padding * 2)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(scale, scale)
  ctx.fillStyle = doc.background
  ctx.fillRect(0, 0, width, height)
  ctx.translate(padding - bounds.x, padding - bounds.y)
  for (const el of doc.elements) drawElement(ctx, el)
  return canvas
}

export function boardThumbnail(doc: BoardDoc, width = 560, height = 350): string | null {
  try {
    const visible = doc.elements.filter((el) => !el.hidden)
    const bounds = boundsOf(visible)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = doc.background
    ctx.fillRect(0, 0, width, height)
    if (bounds && bounds.w > 0 && bounds.h > 0) {
      const scale = Math.min((width - 48) / bounds.w, (height - 48) / bounds.h, 1.4)
      ctx.translate(width / 2 - (bounds.x + bounds.w / 2) * scale, height / 2 - (bounds.y + bounds.h / 2) * scale)
      ctx.scale(scale, scale)
      for (const el of visible) drawElement(ctx, el)
    }
    return canvas.toDataURL('image/jpeg', 0.72)
  } catch {
    return null
  }
}
