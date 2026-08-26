/**
 * A dependency-free PNG encoder, used only to generate placeholder photos for
 * the seeded demo profiles.
 *
 * Real photographs of real people are exactly what this prototype should not
 * be carrying, so the demo accounts get abstract gradients instead. Node has
 * zlib, and a truecolor PNG is just IHDR + IDAT + IEND, so this needs no
 * image library.
 */

import { deflateSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed), 0)
  return Buffer.concat([length, typed, crc])
}

export interface GradientOptions {
  width?: number
  height?: number
  /** Top-left colour, `[r, g, b]`. */
  from: [number, number, number]
  /** Bottom-right colour, `[r, g, b]`. */
  to: [number, number, number]
}

/** Render a diagonal two-stop gradient as a truecolor PNG buffer. */
export function gradientPng({
  width = 600,
  height = 800,
  from,
  to,
}: GradientOptions): Buffer {
  // Raw scanlines: one filter byte (0 = None) followed by RGB triples.
  const raw = Buffer.alloc(height * (1 + width * 3))
  let offset = 0
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0
    for (let x = 0; x < width; x++) {
      // Diagonal ramp, plus a soft radial highlight so the card has a focal point.
      const t = (x / width + y / height) / 2
      const dx = x / width - 0.5
      const dy = y / height - 0.35
      const glow = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 2.4) * 0.18
      for (let c = 0; c < 3; c++) {
        const base = from[c] + (to[c] - from[c]) * t
        raw[offset++] = Math.min(255, Math.round(base + 255 * glow))
      }
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolor
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
