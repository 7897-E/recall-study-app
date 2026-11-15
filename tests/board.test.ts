import { expect, test } from 'bun:test'

import { smoothStroke, withSmoothedPoints } from '../src/app/components/board/model'

const points = [
  { x: 0, y: 0 },
  { x: 10, y: 20 },
  { x: 30, y: 0 },
  { x: 40, y: 10 },
]

test('smoothing keeps both ends of a freehand stroke', () => {
  const smoothed = smoothStroke(points)
  expect(smoothed[0]).toEqual(points[0])
  expect(smoothed[smoothed.length - 1]).toEqual(points[points.length - 1])
})

test('smoothing adds points and stays inside the original bounds', () => {
  const smoothed = smoothStroke(points)
  expect(smoothed.length).toBeGreaterThan(points.length)
  for (const point of smoothed) {
    expect(point.x).toBeGreaterThanOrEqual(0)
    expect(point.x).toBeLessThanOrEqual(40)
    expect(point.y).toBeGreaterThanOrEqual(0)
    expect(point.y).toBeLessThanOrEqual(20)
  }
})

test('short strokes are left alone', () => {
  const short = points.slice(0, 2)
  expect(smoothStroke(short)).toEqual(short)
})

test('smoothing a stroke refits its box', () => {
  const element = {
    id: 'stroke',
    kind: 'stroke' as const,
    x: 50,
    y: 50,
    w: 10,
    h: 10,
    angle: 0,
    opacity: 1,
    fill: null,
    stroke: '#15141f',
    strokeWidth: 3,
    points,
  }
  const next = withSmoothedPoints(element)
  const smoothed = next.points ?? []
  const xs = smoothed.map((point) => point.x)
  const ys = smoothed.map((point) => point.y)
  // The box must cover the smoothed path exactly, since hit testing uses it.
  expect(next.x).toBe(Math.min(...xs))
  expect(next.y).toBe(Math.min(...ys))
  expect(next.w).toBe(Math.max(...xs) - Math.min(...xs))
  expect(next.h).toBe(Math.max(...ys) - Math.min(...ys))
  expect(smoothed.length).toBeGreaterThan(points.length)
  expect(Math.max(...xs)).toBe(40)
  expect(Math.min(...xs)).toBe(0)
})
