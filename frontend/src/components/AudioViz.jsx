import React, { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'

// Forme de barre par phonème (hauteurs relatives des 8 bandes)
const PHONEME_BARS = {
  rest: [0.05, 0.04, 0.04, 0.03, 0.03, 0.04, 0.04, 0.03],
  A:    [0.85, 0.90, 0.75, 0.60, 0.50, 0.40, 0.30, 0.20],
  E:    [0.50, 0.75, 0.85, 0.70, 0.60, 0.45, 0.35, 0.25],
  I:    [0.30, 0.55, 0.80, 0.90, 0.75, 0.60, 0.40, 0.30],
  O:    [0.80, 0.70, 0.55, 0.45, 0.50, 0.60, 0.45, 0.30],
  U:    [0.70, 0.60, 0.45, 0.35, 0.40, 0.55, 0.65, 0.50],
  M:    [0.10, 0.08, 0.06, 0.05, 0.05, 0.06, 0.07, 0.08],
  F:    [0.20, 0.35, 0.50, 0.60, 0.65, 0.55, 0.40, 0.25],
  S:    [0.15, 0.25, 0.40, 0.70, 0.85, 0.75, 0.55, 0.35],
  TH:   [0.18, 0.28, 0.45, 0.60, 0.55, 0.42, 0.30, 0.20],
}

const EMOTION_COLORS = {
  neutral:   '#e8a020',
  happy:     '#f0c030',
  angry:     '#c42010',
  sad:       '#2060a0',
  surprised: '#c090f0',
  speaking:  '#40c080',
}

export default function AudioViz({
  phoneme = 'rest',
  lipSyncValue = 0,
  emotion = 'neutral',
  isSpeaking = false,
  width = 260,
  height = 60,
}) {
  const canvasRef = useRef(null)
  const rafRef    = useRef(null)
  const stateRef  = useRef({ bars: Array(8).fill(0.04), phoneme: 'rest', lipValue: 0 })

  const color = EMOTION_COLORS[emotion] || EMOTION_COLORS.neutral

  useEffect(() => {
    stateRef.current.phoneme  = phoneme
    stateRef.current.lipValue = lipSyncValue
  }, [phoneme, lipSyncValue])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    function draw() {
      const { bars, phoneme: ph, lipValue } = stateRef.current
      const target = PHONEME_BARS[ph] || PHONEME_BARS.rest

      // Lerp bars vers la cible
      stateRef.current.bars = bars.map((b, i) => {
        const t = isSpeaking ? target[i] * (0.6 + lipValue * 0.4) : 0.04
        const noise = isSpeaking ? (Math.random() - 0.5) * 0.06 : 0
        return b + (Math.max(0.02, t + noise) - b) * 0.25
      })

      // Dessin
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const W = canvas.width, H = canvas.height
      const barW = W / bars.length - 3
      const pad  = 3

      bars.forEach((h, i) => {
        const barH = Math.max(3, h * H * 0.9)
        const x    = i * (barW + pad) + pad / 2
        const y    = H - barH

        const grad = ctx.createLinearGradient(x, y, x, H)
        grad.addColorStop(0, color + 'ff')
        grad.addColorStop(1, color + '30')
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.roundRect(x, y, barW, barH, 3)
        ctx.fill()
      })

      // Ligne de base
      ctx.strokeStyle = color + '20'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, H - 1)
      ctx.lineTo(W, H - 1)
      ctx.stroke()

      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [isSpeaking, color])

  return (
    <div style={{ position: 'relative' }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          display: 'block',
          borderRadius: 8,
          background: '#0a0a0a',
          border: `1px solid ${color}22`,
          transition: 'border-color 0.4s',
        }}
      />
      {/* Label phonème courant */}
      <div style={{
        position: 'absolute', top: 4, right: 8,
        fontSize: 10, color: color + '80',
        fontFamily: 'monospace', letterSpacing: 1,
      }}>
        {isSpeaking ? phoneme : ''}
      </div>

      {/* Indicateur de niveau global */}
      {isSpeaking && (
        <motion.div
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 0.3, repeat: Infinity }}
          style={{
            position: 'absolute', top: 4, left: 8,
            width: 6, height: 6, borderRadius: '50%',
            background: color,
          }}
        />
      )}
    </div>
  )
}
