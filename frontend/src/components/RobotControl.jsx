import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'

// ── Joystick virtuel ──────────────────────────────────────────────────────────
function Joystick({ onChange }) {
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const dragging = useRef(false)
  const centerRef = useRef({ x: 0, y: 0 })
  const containerRef = useRef(null)

  const RADIUS = 52
  const THUMB  = 20

  function toNorm(raw) {
    return Math.max(-1, Math.min(1, raw / RADIUS))
  }

  function onStart(e) {
    dragging.current = true
    const rect = containerRef.current.getBoundingClientRect()
    centerRef.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }

  const onMove = useCallback((e) => {
    if (!dragging.current) return
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    const dx = clientX - centerRef.current.x
    const dy = clientY - centerRef.current.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    const factor = dist > RADIUS ? RADIUS / dist : 1
    const nx = dx * factor
    const ny = dy * factor
    setPos({ x: nx, y: ny })
    onChange({ speed: -toNorm(ny) * 100, turn: toNorm(nx) * 100 })
  }, [onChange])

  const onEnd = useCallback(() => {
    dragging.current = false
    setPos({ x: 0, y: 0 })
    onChange({ speed: 0, turn: 0 })
  }, [onChange])

  useEffect(() => {
    window.addEventListener('mousemove',  onMove)
    window.addEventListener('mouseup',   onEnd)
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend',  onEnd)
    return () => {
      window.removeEventListener('mousemove',  onMove)
      window.removeEventListener('mouseup',   onEnd)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend',  onEnd)
    }
  }, [onMove, onEnd])

  return (
    <div
      ref={containerRef}
      onMouseDown={onStart}
      onTouchStart={onStart}
      style={{
        width:  RADIUS * 2 + 8,
        height: RADIUS * 2 + 8,
        borderRadius: '50%',
        background: '#111',
        border: '2px solid #2a2a2a',
        position: 'relative',
        cursor: 'grab',
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      {/* Réticule */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none',
      }}>
        <div style={{ position: 'absolute', width: 1, height: '80%', background: '#1e1e1e' }} />
        <div style={{ position: 'absolute', width: '80%', height: 1, background: '#1e1e1e' }} />
      </div>

      {/* Thumb */}
      <motion.div
        animate={{ x: pos.x, y: pos.y }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        style={{
          position:  'absolute',
          width:     THUMB * 2,
          height:    THUMB * 2,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 35% 35%, #c4620a, #3d1a08)',
          border:    '2px solid #e8a020',
          top:  '50%',
          left: '50%',
          marginTop:  -THUMB,
          marginLeft: -THUMB,
          cursor: 'grabbing',
          boxShadow: '0 0 10px #e8a02040',
        }}
      />
    </div>
  )
}

// ── Boutons directionnels (clavier) ─────────────────────────────────────────
const KEY_MAP = {
  ArrowUp:    { speed:  80, turn:   0 },
  ArrowDown:  { speed: -80, turn:   0 },
  ArrowLeft:  { speed:   0, turn: -60 },
  ArrowRight: { speed:   0, turn:  60 },
  w: { speed:  80, turn:   0 },
  s: { speed: -80, turn:   0 },
  a: { speed:   0, turn: -60 },
  d: { speed:   0, turn:  60 },
}

function useKeyboard(onCommand) {
  useEffect(() => {
    const active = new Set()

    function apply() {
      let speed = 0, turn = 0
      for (const k of active) {
        const cmd = KEY_MAP[k]
        if (cmd) { speed += cmd.speed; turn += cmd.turn }
      }
      onCommand({ speed: Math.max(-100, Math.min(100, speed)), turn: Math.max(-100, Math.min(100, turn)) })
    }

    function down(e) { if (KEY_MAP[e.key]) { e.preventDefault(); active.add(e.key); apply() } }
    function up(e)   { active.delete(e.key); apply() }

    window.addEventListener('keydown', down)
    window.addEventListener('keyup',   up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [onCommand])
}

// ── Composant principal ──────────────────────────────────────────────────────
export default function RobotControl({ onCommand, robotStatus }) {
  const [cmd, setCmd] = useState({ speed: 0, turn: 0 })
  const [emergencyStop, setEmergencyStop] = useState(false)

  const handleCommand = useCallback((newCmd) => {
    if (emergencyStop) return
    setCmd(newCmd)
    onCommand?.(newCmd)
  }, [emergencyStop, onCommand])

  useKeyboard(handleCommand)

  function triggerStop() {
    setEmergencyStop(true)
    setCmd({ speed: 0, turn: 0 })
    onCommand?.({ speed: 0, turn: 0 })
    setTimeout(() => setEmergencyStop(false), 2000)
  }

  const speedPct = Math.abs(cmd.speed)
  const turnPct  = Math.abs(cmd.turn)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h3 style={{ fontSize: 13, letterSpacing: 2, color: '#c090f0', textTransform: 'uppercase' }}>
        Contrôle Robot
      </h3>

      {/* Joystick + aide */}
      <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
        <Joystick onChange={handleCommand} />
        <div style={{ fontSize: 11, color: '#444', lineHeight: 2 }}>
          <div>↑↓ Avancer/Reculer</div>
          <div>←→ Virer</div>
          <div style={{ color: '#333' }}>ou WASD / flèches</div>
        </div>
      </div>

      {/* Barres de commande */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[
          { label: 'Vitesse',  value: speedPct, dir: cmd.speed > 0 ? '▲' : cmd.speed < 0 ? '▼' : '●', color: '#c090f0' },
          { label: 'Virage',   value: turnPct,  dir: cmd.turn > 0  ? '▶' : cmd.turn  < 0 ? '◀' : '●', color: '#40c080' },
        ].map(({ label, value, dir, color }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
            <span style={{ color: '#555', width: 48 }}>{label}</span>
            <span style={{ color, width: 12 }}>{dir}</span>
            <div style={{ flex: 1, background: '#1a1a1a', borderRadius: 4, height: 5, overflow: 'hidden' }}>
              <motion.div
                animate={{ width: `${value}%` }}
                transition={{ duration: 0.08 }}
                style={{ height: '100%', background: color, borderRadius: 4 }}
              />
            </div>
            <span style={{ color, width: 30, textAlign: 'right' }}>{value.toFixed(0)}%</span>
          </div>
        ))}
      </div>

      {/* STOP d'urgence */}
      <motion.button
        onClick={triggerStop}
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.96 }}
        animate={emergencyStop ? { scale: [1, 1.05, 1] } : {}}
        transition={{ duration: 0.3, repeat: emergencyStop ? Infinity : 0 }}
        style={{
          padding: '14px',
          borderRadius: 10,
          background: emergencyStop ? '#3a0000' : '#c42010',
          border: `2px solid ${emergencyStop ? '#c42010' : 'transparent'}`,
          color: '#fff',
          fontWeight: 900,
          fontSize: 14,
          letterSpacing: 2,
          cursor: 'pointer',
        }}
      >
        {emergencyStop ? '■ ARRÊTÉ' : '⚠ ARRÊT URGENCE'}
      </motion.button>

      {/* Info touches */}
      <div style={{
        background: '#0d0d0d',
        border: '1px solid #1a1a1a',
        borderRadius: 8,
        padding: '10px 12px',
        fontSize: 10,
        color: '#444',
        lineHeight: 1.8,
      }}>
        <div style={{ color: '#333', marginBottom: 4 }}>Raccourcis clavier</div>
        <div><kbd style={{ color: '#666' }}>W/S</kbd> — avant/arrière</div>
        <div><kbd style={{ color: '#666' }}>A/D</kbd> — gauche/droite</div>
        <div><kbd style={{ color: '#666' }}>Espace</kbd> — arrêt</div>
      </div>
    </div>
  )
}
