'use client'
/**
 * FaceEngine — Masque africain minimaliste & premium
 *
 * Design : géométrique, symétrique, formes simples.
 * Pas de traits humains réalistes → évite la vallée de l'étrange.
 * Rendu SVG + Framer Motion pour animations fluides.
 */

import { useEffect, useRef, useState } from 'react'
import { motion, animate, useSpring, useTransform } from 'framer-motion'
import { EMOTIONS, VISEMES } from '../../lib/emotions'

function lerp(a, b, t) { return a + (b - a) * t }

// ── Géométrie ─────────────────────────────────────────────────────────────────
const VW = 400, VH = 480, CX = 200, CY = 245
const FACE_RX = 118, FACE_RY = 150

const EYE_L = { x: 143, y: 192 }
const EYE_R = { x: 257, y: 192 }
const EYE_RX_BASE = 31
const EYE_RY_BASE = 24
const MOUTH_CY = 318
const MOUTH_RX_BASE = 44
const BROW_Y_BASE = 163

// ── Hook blink ────────────────────────────────────────────────────────────────
function useBlink(blinkRate) {
  const [phase, setPhase] = useState(0)
  const timerRef = useRef(null)

  useEffect(() => {
    function schedule() {
      const jitter = (Math.random() - 0.5) * 900
      timerRef.current = setTimeout(() => {
        setPhase(1)
        setTimeout(() => setPhase(2), 65)
        setTimeout(() => setPhase(3), 130)
        setTimeout(() => { setPhase(0); schedule() }, 210)
      }, blinkRate + jitter)
    }
    schedule()
    return () => clearTimeout(timerRef.current)
  }, [blinkRate])

  const factor = phase === 1 ? 0.35 : phase === 2 ? 0.04 : phase === 3 ? 0.5 : 1.0
  return factor
}

// ── Hook idle breath ──────────────────────────────────────────────────────────
function useBreath(active) {
  const [scale, setScale] = useState(1)
  const rafRef = useRef(null)
  const t0Ref  = useRef(null)

  useEffect(() => {
    if (!active) { setScale(1); return }
    function tick(t) {
      if (!t0Ref.current) t0Ref.current = t
      setScale(1 + Math.sin(((t - t0Ref.current) / 1000) * 0.55) * 0.011)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [active])

  return scale
}

// ── Oeil ──────────────────────────────────────────────────────────────────────
function Eye({ cx, cy, openness, glow, blinkFactor, color, pupilOffset, side }) {
  const ry     = EYE_RY_BASE * openness * blinkFactor
  const lidRy  = EYE_RY_BASE * (1 - openness * blinkFactor) + 3
  const px     = cx + (pupilOffset?.x ?? 0) * (side === 'l' ? 1 : -1)
  const py     = cy + (pupilOffset?.y ?? 0)

  return (
    <g>
      {/* Fond de l'orbite */}
      <ellipse cx={cx} cy={cy} rx={EYE_RX_BASE + 8} ry={EYE_RY_BASE + 10} fill="#050505" />

      {/* Iris */}
      <motion.ellipse
        cx={cx} cy={cy}
        rx={EYE_RX_BASE} ry={ry}
        fill="#0E0805"
        stroke={color}
        strokeWidth="1.5"
        animate={{ ry, stroke: color }}
        transition={{ duration: blinkFactor < 0.5 ? 0.065 : 0.22, ease: 'easeOut' }}
      />

      {/* Glow intérieur */}
      <motion.ellipse
        cx={px} cy={py}
        rx={12} ry={12 * Math.min(1, openness * blinkFactor)}
        fill={color}
        animate={{ rx: 12, fill: color, fillOpacity: glow * 0.85 }}
        transition={{ duration: 0.3 }}
        style={{ filter: `blur(2px)` }}
      />

      {/* Point pupille */}
      <motion.circle
        cx={px} cy={py} r={5}
        fill="#050505"
        animate={{ cx: px, cy: py }}
        transition={{ type: 'spring', stiffness: 280, damping: 28 }}
      />

      {/* Reflet */}
      <circle cx={cx - 10} cy={cy - 7} r={3.5} fill="rgba(255,246,233,0.55)" />

      {/* Paupière */}
      <motion.ellipse
        cx={cx} cy={cy - EYE_RY_BASE + 1}
        rx={EYE_RX_BASE + 2} ry={lidRy}
        fill="#0D0805"
        animate={{ ry: lidRy }}
        transition={{ duration: blinkFactor < 0.5 ? 0.065 : 0.22 }}
      />
    </g>
  )
}

// ── Sourcil ───────────────────────────────────────────────────────────────────
function Brow({ cx, browY, angle, side, color }) {
  const dir   = side === 'l' ? 1 : -1
  const tilt  = angle * 0.45 * dir
  const x0    = cx - 28
  const x2    = cx + 28
  const qx    = cx
  const qy    = browY - 5 - tilt

  return (
    <motion.path
      d={`M ${x0} ${browY + tilt * 0.5} Q ${qx} ${qy} ${x2} ${browY - tilt * 0.5}`}
      fill="none"
      stroke={color}
      strokeWidth="5"
      strokeLinecap="round"
      animate={{ stroke: color, d: `M ${x0} ${browY + tilt * 0.5} Q ${qx} ${qy} ${x2} ${browY - tilt * 0.5}` }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
    />
  )
}

// ── Bouche ────────────────────────────────────────────────────────────────────
function Mouth({ curve, open, viseme, color, lipSyncValue, isSpeaking }) {
  const v   = VISEMES[viseme] || VISEMES.rest
  const eff = isSpeaking
    ? lerp(open, v.open, Math.max(lipSyncValue, 0.6))
    : open

  const rx  = MOUTH_RX_BASE * (isSpeaking ? v.wide : 1.0)
  const ryT = 7  + eff * 26
  const ryB = 5  + eff * 20
  const lip = curve

  const path =
    `M ${CX - rx} ${MOUTH_CY + lip * 0.5}` +
    ` Q ${CX - rx * 0.5} ${MOUTH_CY - ryT + lip} ${CX} ${MOUTH_CY - ryT}` +
    ` Q ${CX + rx * 0.5} ${MOUTH_CY - ryT + lip} ${CX + rx} ${MOUTH_CY + lip * 0.5}` +
    ` Q ${CX + rx * 0.5} ${MOUTH_CY + ryB - lip} ${CX} ${MOUTH_CY + ryB}` +
    ` Q ${CX - rx * 0.5} ${MOUTH_CY + ryB - lip} ${CX - rx} ${MOUTH_CY + lip * 0.5} Z`

  return (
    <g>
      <motion.path
        d={path}
        fill="#100602"
        stroke={color}
        strokeWidth="2"
        animate={{ d: path, stroke: color }}
        transition={{ duration: 0.08, ease: 'linear' }}
      />
      {/* Intérieur bouche ouverte */}
      {eff > 0.18 && (
        <motion.ellipse
          cx={CX}
          cy={MOUTH_CY + (ryB - ryT) / 2}
          rx={rx * 0.72}
          ry={(ryT + ryB) * 0.4}
          fill="#050505"
          animate={{ ry: (ryT + ryB) * 0.4 }}
          transition={{ duration: 0.08 }}
        />
      )}
    </g>
  )
}

// ── Composant principal ────────────────────────────────────────────────────────
export default function FaceEngine({
  emotion    = 'neutral',
  phoneme    = 'rest',
  lipSyncValue = 0,
  isSpeaking = false,
  size       = 380,
}) {
  const cfg         = EMOTIONS[emotion] || EMOTIONS.neutral
  const blinkFactor = useBlink(cfg.blinkRate)
  const breathScale = useBreath(!isSpeaking)

  const browLift = cfg.browAngle
  const browY_L  = BROW_Y_BASE - browLift * 0.9
  const browY_R  = BROW_Y_BASE - browLift * 0.9

  const glowPx = cfg.glowIntensity * 52

  return (
    <motion.div
      animate={{ scale: breathScale }}
      style={{ display: 'inline-block', lineHeight: 0 }}
    >
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        width={size}
        height={size * (VH / VW)}
        xmlns="http://www.w3.org/2000/svg"
        style={{
          display: 'block',
          filter: `drop-shadow(0 0 ${glowPx}px ${cfg.color}55)`,
          transition: 'filter 0.6s ease',
        }}
      >
        <defs>
          <radialGradient id="face-bg" cx="50%" cy="42%" r="58%">
            <stop offset="0%"   stopColor="#160C05" />
            <stop offset="55%"  stopColor="#0D0703" />
            <stop offset="100%" stopColor="#050505" />
          </radialGradient>
          <radialGradient id={`eye-glow-${emotion}`} cx="40%" cy="35%" r="60%">
            <stop offset="0%"   stopColor={cfg.color} stopOpacity="0.9" />
            <stop offset="100%" stopColor={cfg.color} stopOpacity="0.05" />
          </radialGradient>
        </defs>

        {/* Halo ambiant */}
        {cfg.ambientPulse && (
          <motion.ellipse
            cx={CX} cy={CY}
            rx={FACE_RX + 28} ry={FACE_RY + 28}
            fill="none"
            stroke={cfg.color}
            strokeWidth="1"
            animate={{ opacity: [0.12, 0.32, 0.12], rx: [FACE_RX + 24, FACE_RX + 32, FACE_RX + 24] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}

        {/* Contour visage */}
        <motion.ellipse
          cx={CX} cy={CY}
          rx={FACE_RX + 10} ry={FACE_RY + 10}
          fill="none"
          stroke={cfg.color}
          strokeWidth="1.2"
          animate={{ stroke: cfg.color, opacity: 0.55 }}
          transition={{ duration: 0.5 }}
        />

        {/* Corps du visage */}
        <ellipse cx={CX} cy={CY} rx={FACE_RX} ry={FACE_RY} fill="url(#face-bg)" />

        {/* Ligne de front — marque subtile */}
        <motion.path
          d={`M ${CX - 26} ${CY - FACE_RY + 38} L ${CX + 26} ${CY - FACE_RY + 38}`}
          stroke={cfg.color}
          strokeWidth="3"
          strokeLinecap="round"
          animate={{ stroke: cfg.color, opacity: 0.6 }}
          transition={{ duration: 0.4 }}
        />

        {/* Sourcils */}
        <Brow cx={EYE_L.x} browY={browY_L} angle={browLift} side="l" color={cfg.color} />
        <Brow cx={EYE_R.x} browY={browY_R} angle={browLift} side="r" color={cfg.color} />

        {/* Yeux */}
        <Eye
          cx={EYE_L.x} cy={EYE_L.y}
          openness={cfg.eyeOpenness}
          glow={cfg.eyeGlow}
          blinkFactor={blinkFactor}
          color={cfg.color}
          pupilOffset={cfg.pupilOffset}
          side="l"
        />
        <Eye
          cx={EYE_R.x} cy={EYE_R.y}
          openness={cfg.eyeOpenness}
          glow={cfg.eyeGlow}
          blinkFactor={blinkFactor}
          color={cfg.color}
          pupilOffset={cfg.pupilOffset}
          side="r"
        />

        {/* Bouche */}
        <Mouth
          curve={cfg.mouthCurve}
          open={cfg.mouthOpen}
          viseme={phoneme}
          color={cfg.color}
          lipSyncValue={lipSyncValue}
          isSpeaking={isSpeaking}
        />

        {/* Indicateur parole */}
        {isSpeaking && (
          <motion.circle
            cx={CX} cy={VH - 20}
            r={4}
            fill={cfg.color}
            animate={{ opacity: [0.4, 1, 0.4], r: [3.5, 5, 3.5] }}
            transition={{ duration: 0.4, repeat: Infinity }}
          />
        )}
      </svg>
    </motion.div>
  )
}
