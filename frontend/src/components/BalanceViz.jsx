import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'

const W = 300
const H = 180
const HISTORY = 80

function useCanvas(draw, deps) {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    draw(ctx, canvas.width, canvas.height)
  }, deps) // eslint-disable-line
  return ref
}

// ── Pendule graphique ────────────────────────────────────────────────────────
function Pendulum({ angle, motor }) {
  const cx = 80
  const cy = 120
  const L  = 90
  const rad = (angle * Math.PI) / 180

  const wx = cx + Math.sin(rad) * L
  const wy = cy + Math.cos(rad) * L   // roue en bas

  // Couleur selon inclinaison
  const danger = Math.min(1, Math.abs(angle) / 20)
  const color  = `hsl(${(1 - danger) * 120}, 80%, 50%)`

  return (
    <svg width={160} height={H} style={{ overflow: 'visible' }}>
      {/* Pivot */}
      <line x1={cx} y1={30} x2={cx} y2={cy} stroke="#333" strokeWidth={1} strokeDasharray="4 4" />
      <circle cx={cx} cy={cy} r={5} fill="#555" />

      {/* Corps du robot */}
      <line
        x1={cx} y1={cy}
        x2={wx} y2={wy}
        stroke={color}
        strokeWidth={8}
        strokeLinecap="round"
      />

      {/* Masque (tête) */}
      <ellipse cx={cx + Math.sin(rad) * 12} cy={cy + Math.cos(rad) * 12 - 8}
        rx={14} ry={16}
        fill="#5a1e06"
        stroke={color}
        strokeWidth={2}
      />

      {/* Roues */}
      <circle cx={wx} cy={wy} r={16} fill="none" stroke="#444" strokeWidth={4} />
      <circle cx={wx} cy={wy} r={6}  fill="#333" />

      {/* Axe roue - indique vitesse moteur */}
      <line
        x1={wx - 10} y1={wy}
        x2={wx + 10} y2={wy}
        stroke={motor > 0 ? '#40c080' : motor < 0 ? '#c42010' : '#555'}
        strokeWidth={3}
      />

      {/* Angle label */}
      <text x={cx + 14} y={cy - 4} fill="#888" fontSize={10}>
        {angle.toFixed(1)}°
      </text>
    </svg>
  )
}

// ── Graphe angle/moteur dans le temps ────────────────────────────────────────
function TimeChart({ history }) {
  const canvasRef = useCanvas((ctx, w, h) => {
    ctx.clearRect(0, 0, w, h)

    // Fond
    ctx.fillStyle = '#0d0d0d'
    ctx.fillRect(0, 0, w, h)

    // Grille
    ctx.strokeStyle = '#1a1a1a'
    ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const y = (h / 4) * i
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }

    if (!history.length) return

    const n = history.length
    const xStep = w / HISTORY

    function plotLine(getVal, maxVal, color) {
      ctx.beginPath()
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      history.forEach((pt, i) => {
        const x = (HISTORY - n + i) * xStep
        const y = h / 2 - (getVal(pt) / maxVal) * (h / 2 - 4)
        if (i === 0) ctx.moveTo(x, y)
        else         ctx.lineTo(x, y)
      })
      ctx.stroke()
    }

    // Zero line
    ctx.strokeStyle = '#2a2a2a'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, h / 2)
    ctx.lineTo(w, h / 2)
    ctx.stroke()

    plotLine(p => p.angle,  25,   '#e8a020')
    plotLine(p => p.motor,  100,  '#40c080')
  }, [history])

  return (
    <div style={{ position: 'relative' }}>
      <canvas ref={canvasRef} width={W} height={H}
        style={{ display: 'block', borderRadius: 8, border: '1px solid #1a1a1a' }}
      />
      <div style={{
        position: 'absolute', top: 6, left: 8,
        display: 'flex', gap: 12, fontSize: 10, color: '#555',
      }}>
        <span style={{ color: '#e8a020' }}>● angle</span>
        <span style={{ color: '#40c080' }}>● moteur</span>
      </div>
    </div>
  )
}

// ── PID Tuning knobs ─────────────────────────────────────────────────────────
function PIDTuner({ kp, ki, kd, onChange }) {
  const slider = (label, value, min, max, step, key) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <span style={{ color: '#666', width: 20 }}>{label}</span>
      <input
        type="range" min={min} max={max} step={step}
        value={value}
        onChange={e => onChange({ kp, ki, kd, [key]: parseFloat(e.target.value) })}
        style={{ flex: 1, accentColor: '#e8a020' }}
      />
      <span style={{ color: '#e8a020', width: 36, textAlign: 'right' }}>{value.toFixed(1)}</span>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h4 style={{ fontSize: 11, color: '#555', letterSpacing: 2, textTransform: 'uppercase' }}>
        PID Tuning
      </h4>
      {slider('Kp', kp, 0, 60, 0.5, 'kp')}
      {slider('Ki', ki, 0, 5,  0.1, 'ki')}
      {slider('Kd', kd, 0, 20, 0.5, 'kd')}
    </div>
  )
}

// ── Composant principal ──────────────────────────────────────────────────────
export default function BalanceViz({ robotStatus, history = [], onPIDChange }) {
  const { angle = 0, motor = 0, battery = 100, pid_kp = 28, pid_ki = 0.8, pid_kd = 4.5 } = robotStatus

  const danger = Math.abs(angle) > 20

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ fontSize: 13, letterSpacing: 2, color: '#e8a020', textTransform: 'uppercase' }}>
          Équilibre
        </h3>
        {danger && (
          <motion.span
            animate={{ opacity: [1, 0, 1] }}
            transition={{ duration: 0.4, repeat: Infinity }}
            style={{ fontSize: 11, color: '#c42010', letterSpacing: 1 }}
          >
            ⚠ INSTABLE
          </motion.span>
        )}
      </div>

      {/* Pendule + graphe côte à côte */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <Pendulum angle={angle} motor={motor} />
        <TimeChart history={history} />
      </div>

      {/* Métriques rapides */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {[
          { label: 'Angle',   value: `${angle.toFixed(1)}°`, color: '#e8a020' },
          { label: 'Moteur',  value: `${(motor || 0).toFixed(0)}%`, color: '#40c080' },
          { label: 'Batterie',value: `${battery.toFixed(0)}%`, color: battery < 20 ? '#c42010' : '#c090f0' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{
            background: '#111', border: '1px solid #1a1a1a',
            borderRadius: 8, padding: '8px 10px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
            <div style={{ fontSize: 10, color: '#444', marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      <PIDTuner kp={pid_kp} ki={pid_ki} kd={pid_kd} onChange={onPIDChange} />
    </div>
  )
}
