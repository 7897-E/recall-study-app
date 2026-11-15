/** Stable hue for a deck title, so colours survive reloads. */
export function hueFor(text: string): number {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

export const newId = () => crypto.randomUUID()
