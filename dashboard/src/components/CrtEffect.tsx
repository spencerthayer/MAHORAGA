import { useEffect, useState } from 'react'

/**
 * CSS-based CRT overlay effect inspired by CRTFilter.js
 * (https://github.com/Ichiaka/CRTFilter)
 * 
 * Applies scanlines, vignette, animated noise, flicker,
 * and chromatic aberration to the full page using
 * performant CSS-only animations (zero per-frame JS).
 */
export function CrtEffect({ enabled }: { enabled: boolean }) {
  const [noiseUrl, setNoiseUrl] = useState<string | null>(null)

  // Generate a noise tile texture once on mount, then animate via CSS
  useEffect(() => {
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    const imageData = ctx.createImageData(size, size)
    const data = imageData.data
    for (let i = 0; i < data.length; i += 4) {
      const v = Math.random() * 255
      data[i] = v
      data[i + 1] = v
      data[i + 2] = v
      data[i + 3] = 18 // Very subtle
    }
    ctx.putImageData(imageData, 0, 0)
    setNoiseUrl(canvas.toDataURL('image/png'))
  }, [])

  // Toggle flicker + chromatic aberration on <html> when enabled
  useEffect(() => {
    const root = document.documentElement
    if (enabled) {
      root.classList.add('crt-active')
    } else {
      root.classList.remove('crt-active')
    }
    return () => root.classList.remove('crt-active')
  }, [enabled])

  if (!enabled) return null

  return (
    <>
      {/* Scanlines — repeating 2px bars */}
      <div className="crt-scanlines" aria-hidden="true" />
      {/* Vignette — dark edges */}
      <div className="crt-vignette" aria-hidden="true" />
      {/* Static noise — tiled texture animated via CSS */}
      {noiseUrl && (
        <div
          className="crt-noise"
          aria-hidden="true"
          style={{ backgroundImage: `url(${noiseUrl})` }}
        />
      )}
      {/* Chromatic aberration overlay — RGB fringe */}
      <div className="crt-aberration" aria-hidden="true" />
    </>
  )
}
