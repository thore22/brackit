import { useLayoutEffect } from 'react'
import type { TournamentColors } from '../data/types.ts'

export const defaultColors: TournamentColors = { primary: '#244a78', background: '#edf0f4' }

function readableColor(hex: string, background: boolean) {
  const rgb = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16))
  const luminance = () => rgb.reduce((sum, channel, index) => {
    const s = channel / 255
    return sum + [0.2126, 0.7152, 0.0722][index] * (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4)
  }, 0)
  // Keep the brand readable against both white and the light canvas.
  while (background ? luminance() < 0.8 : luminance() > 0.12) {
    for (let i = 0; i < rgb.length; i++) {
      rgb[i] = background ? Math.ceil(rgb[i] + (255 - rgb[i]) * 0.1) : Math.floor(rgb[i] * 0.9)
    }
  }
  return '#' + rgb.map(channel => channel.toString(16).padStart(2, '0')).join('')
}

export function useTournamentColors(colors?: TournamentColors | null) {
  const primary = colors?.primary
  const background = colors?.background
  useLayoutEffect(() => {
    const root = document.documentElement
    const meta = document.querySelector('meta[name="theme-color"]')
    if (primary && /^#[0-9a-f]{6}$/i.test(primary)) {
      const brand = readableColor(primary, false)
      root.style.setProperty('--brand', brand)
      meta?.setAttribute('content', brand)
    }
    if (background && /^#[0-9a-f]{6}$/i.test(background)) {
      root.style.setProperty('--canvas', readableColor(background, true))
      root.style.setProperty('--canvas-source', background)
    }
    return () => {
      root.style.removeProperty('--brand')
      root.style.removeProperty('--canvas')
      root.style.removeProperty('--canvas-source')
      meta?.setAttribute('content', defaultColors.primary)
    }
  }, [primary, background])
}
