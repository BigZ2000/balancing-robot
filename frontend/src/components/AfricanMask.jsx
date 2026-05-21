import React, { useEffect, useRef } from 'react'
import { motion, useAnimation, animate } from 'framer-motion'

// Emotion configs: colors, eye/mouth shapes, expressions
const EMOTIONS = {
  neutral: {
    label: 'Neutre',
    eyeOpenness: 0.5,
    browLift: 0,
    mouthOpen: 0.1,
    mouthCurve: 0,
    pupilSize: 1,
    blinkRate: 3500,
    glowColor: '#e8a020',
    faceGlow: 0.3,
    markingPulse: false,
  },
  happy: {
    label: 'Joie',
    eyeOpenness: 0.7,
    browLift: 6,
    mouthOpen: 0.5,
    mouthCurve: 12,
    pupilSize: 1.2,
    blinkRate: 4000,
    glowColor: '#f0c030',
    faceGlow: 0.8,
    markingPulse: true,
  },
  angry: {
    label: 'Colère',
    eyeOpenness: 0.35,
    browLift: -8,
    mouthOpen: 0.3,
    mouthCurve: -8,
    pupilSize: 0.7,
    blinkRate: 6000,
    glowColor: '#c42010',
    faceGlow: 0.9,
    markingPulse: false,
  },
  sad: {
    label: 'Tristesse',
    eyeOpenness: 0.3,
    browLift: 4,
    mouthOpen: 0.15,
    mouthCurve: -10,
    pupilSize: 0.85,
    blinkRate: 2000,
    glowColor: '#2060a0',
    faceGlow: 0.5,
    markingPulse: false,
  },
  surprised: {
    label: 'Surprise',
    eyeOpenness: 1.0,
    browLift: 14,
    mouthOpen: 0.8,
    mouthCurve: 0,
    pupilSize: 1.4,
    blinkRate: 5000,
    glowColor: '#c090f0',
    faceGlow: 1.0,
    markingPulse: true,
  },
  speaking: {
    label: 'Parle',
    eyeOpenness: 0.55,
    browLift: 2,
    mouthOpen: 0.4,
    mouthCurve: 4,
    pupilSize: 1.1,
    blinkRate: 3000,
    glowColor: '#40c080',
    faceGlow: 0.6,
    markingPulse: true,
  },
}

// Mouth shapes for phonemes (lip-sync)
const PHONEME_SHAPES = {
  rest: { open: 0.05, width: 1.0 },
  A:    { open: 0.75, width: 1.1 },
  E:    { open: 0.45, width: 1.2 },
  I:    { open: 0.3,  width: 1.25 },
  O:    { open: 0.65, width: 0.9 },
  U:    { open: 0.4,  width: 0.8 },
  M:    { open: 0.0,  width: 1.0 },
  F:    { open: 0.2,  width: 1.05 },
  S:    { open: 0.15, width: 1.1 },
  TH:   { open: 0.2,  width: 1.0 },
}

function lerp(a, b, t) { return a + (b - a) * t }

export default function AfricanMask({ emotion = 'neutral', phoneme = 'rest', lipSyncValue = 0, size = 600 }) {
  const cfg = EMOTIONS[emotion] || EMOTIONS.neutral
  const ph = PHONEME_SHAPES[phoneme] || PHONEME_SHAPES.rest
  const blinkRef = useRef(null)
  const blinkAnimRef = useRef(null)

  // Combine emotion mouth + phoneme during speech
  const mouthOpenFinal = emotion === 'speaking' || lipSyncValue > 0
    ? lerp(cfg.mouthOpen, ph.open, Math.max(lipSyncValue, 0.7))
    : cfg.mouthOpen

  const mouthWidthScale = ph.width

  // SVG viewport
  const vw = 400
  const vh = 500
  const cx = vw / 2

  // Face shape
  const faceRx = 130
  const faceRy = 170
  const faceCy = 250

  // Eyes
  const eyeY = 210
  const eyeOffX = 55
  const eyeRx = 36
  const eyeRyBase = 20
  const eyeRy = eyeRyBase * cfg.eyeOpenness

  // Brow
  const browY = eyeY - 30 - cfg.browLift
  const browH = 8

  // Mouth
  const mouthCx = cx
  const mouthCy = 340
  const mouthRx = 40 * mouthWidthScale
  const mouthRyTop = 10 + mouthOpenFinal * 28
  const mouthRyBot = 8 + mouthOpenFinal * 22

  // Lip curve (smile/frown)
  const lipCurve = cfg.mouthCurve

  const glowId = `mask-glow-${emotion}`

  return (
    <svg
      viewBox={`0 0 ${vw} ${vh}`}
      width={size}
      height={size * (vh / vw)}
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block', filter: `drop-shadow(0 0 ${cfg.faceGlow * 40}px ${cfg.glowColor}88)` }}
    >
      <defs>
        <radialGradient id="face-grad" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="#8b3a12" />
          <stop offset="60%" stopColor="#5a1e06" />
          <stop offset="100%" stopColor="#2a0c02" />
        </radialGradient>
        <radialGradient id="eye-grad" cx="35%" cy="35%" r="60%">
          <stop offset="0%" stopColor="#90d0b0" />
          <stop offset="100%" stopColor="#1a5a4a" />
        </radialGradient>
        <filter id={glowId}>
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
        <filter id="inner-shadow">
          <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#00000088" />
        </filter>
        {/* Animated glow filter */}
        <filter id="gold-glow">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* ── OUTER BORDER (gold) ── */}
      <motion.ellipse
        cx={cx} cy={faceCy} rx={faceRx + 14} ry={faceRy + 14}
        fill="none"
        stroke={cfg.glowColor}
        strokeWidth="8"
        animate={{ stroke: cfg.glowColor, opacity: cfg.markingPulse ? [0.7, 1, 0.7] : 1 }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* ── FACE BODY ── */}
      <ellipse cx={cx} cy={faceCy} rx={faceRx} ry={faceRy} fill="url(#face-grad)" />

      {/* ── FOREHEAD BAND ── */}
      <motion.path
        d={`M ${cx - faceRx + 20} ${faceCy - faceRy + 50} Q ${cx} ${faceCy - faceRy + 30} ${cx + faceRx - 20} ${faceCy - faceRy + 50}`}
        fill="none"
        stroke={cfg.glowColor}
        strokeWidth="7"
        strokeLinecap="round"
        animate={{ stroke: cfg.glowColor }}
        transition={{ duration: 0.4 }}
      />

      {/* ── CROWN CIRCLE ── */}
      <motion.circle
        cx={cx} cy={faceCy - faceRy + 18}
        r={14}
        fill={cfg.glowColor}
        animate={{
          fill: cfg.glowColor,
          r: cfg.markingPulse ? [14, 16, 14] : 14
        }}
        transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
      />
      {/* Crown dots */}
      {[-36, -20, 20, 36].map((dx, i) => (
        <motion.circle
          key={i}
          cx={cx + dx} cy={faceCy - faceRy + 40}
          r={5}
          fill={cfg.glowColor}
          animate={{ fill: cfg.glowColor, opacity: cfg.markingPulse ? [0.6, 1, 0.6] : 0.8 }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.1 }}
        />
      ))}

      {/* ── NOSE BRIDGE (center line) ── */}
      <rect
        x={cx - 6} y={faceCy - faceRy + 55}
        width={12} height={100}
        rx={5}
        fill={cfg.glowColor}
        opacity={0.85}
      />

      {/* ── BROWS ── */}
      {[-1, 1].map(side => (
        <motion.path
          key={side}
          d={`M ${cx + side * (eyeOffX - eyeRx - 5)} ${browY + (side === -1 ? cfg.browLift * 0.3 : 0)}
              Q ${cx + side * eyeOffX} ${browY - browH}
              ${cx + side * (eyeOffX + eyeRx + 5)} ${browY + (side === 1 ? cfg.browLift * 0.3 : 0)}`}
          fill="none"
          stroke={cfg.glowColor}
          strokeWidth="9"
          strokeLinecap="round"
          animate={{ d: `M ${cx + side * (eyeOffX - eyeRx - 5)} ${browY + (side === -1 ? cfg.browLift * 0.3 : 0)} Q ${cx + side * eyeOffX} ${browY - browH} ${cx + side * (eyeOffX + eyeRx + 5)} ${browY + (side === 1 ? cfg.browLift * 0.3 : 0)}` }}
          transition={{ duration: 0.3 }}
        />
      ))}

      {/* ── EYES ── */}
      {[-1, 1].map(side => (
        <g key={side}>
          {/* Eye socket */}
          <ellipse
            cx={cx + side * eyeOffX} cy={eyeY}
            rx={eyeRx + 6} ry={eyeRyBase + 8}
            fill="#1a0800"
          />
          {/* Iris */}
          <motion.ellipse
            cx={cx + side * eyeOffX} cy={eyeY}
            rx={eyeRx}
            ry={eyeRy}
            fill="url(#eye-grad)"
            animate={{ ry: eyeRy }}
            transition={{ duration: 0.25 }}
          />
          {/* Pupil */}
          <motion.circle
            cx={cx + side * eyeOffX} cy={eyeY}
            r={10 * cfg.pupilSize}
            fill="#0a0505"
            animate={{ r: 10 * cfg.pupilSize }}
            transition={{ duration: 0.25 }}
          />
          {/* Eye shine */}
          <circle
            cx={cx + side * eyeOffX - 8} cy={eyeY - 6}
            r={4}
            fill="rgba(255,255,255,0.7)"
          />
          {/* Upper eyelid */}
          <motion.ellipse
            cx={cx + side * eyeOffX} cy={eyeY - eyeRyBase}
            rx={eyeRx + 2}
            ry={eyeRyBase * (1 - cfg.eyeOpenness) + 2}
            fill="#5a1e06"
            animate={{ ry: eyeRyBase * (1 - cfg.eyeOpenness) + 2 }}
            transition={{ duration: 0.25 }}
          />
        </g>
      ))}

      {/* ── CHEEK MARKINGS ── */}
      {[-1, 1].map(side => (
        <g key={side}>
          <motion.rect
            x={cx + side * 80 - (side === 1 ? 20 : 0)} y={280}
            width={20} height={7} rx={3}
            fill="#2d7a6b"
            animate={{ opacity: cfg.markingPulse ? [0.7, 1, 0.7] : 0.85 }}
            transition={{ duration: 1.4, repeat: Infinity }}
          />
          <motion.rect
            x={cx + side * 78 - (side === 1 ? 18 : 0)} y={292}
            width={16} height={7} rx={3}
            fill="#2d7a6b"
            animate={{ opacity: cfg.markingPulse ? [0.5, 0.9, 0.5] : 0.7 }}
            transition={{ duration: 1.4, repeat: Infinity, delay: 0.3 }}
          />
        </g>
      ))}

      {/* ── EARS ── */}
      {[-1, 1].map(side => (
        <g key={side}>
          <ellipse
            cx={cx + side * (faceRx + 8)} cy={eyeY + 20}
            rx={18} ry={28}
            fill="#7a2a0a"
          />
          {/* Ear ornament */}
          <motion.circle
            cx={cx + side * (faceRx + 8)} cy={eyeY + 28}
            r={9}
            fill={cfg.glowColor}
            animate={{ fill: cfg.glowColor, r: cfg.markingPulse ? [9, 11, 9] : 9 }}
            transition={{ duration: 1.6, repeat: Infinity }}
          />
        </g>
      ))}

      {/* ── MOUTH ── */}
      <g filter="url(#inner-shadow)">
        {/* Mouth outline / lips */}
        <motion.path
          d={`
            M ${mouthCx - mouthRx} ${mouthCy + lipCurve * 0.5}
            Q ${mouthCx - mouthRx * 0.5} ${mouthCy - mouthRyTop + lipCurve}
              ${mouthCx} ${mouthCy - mouthRyTop}
            Q ${mouthCx + mouthRx * 0.5} ${mouthCy - mouthRyTop + lipCurve}
              ${mouthCx + mouthRx} ${mouthCy + lipCurve * 0.5}
            Q ${mouthCx + mouthRx * 0.5} ${mouthCy + mouthRyBot - lipCurve}
              ${mouthCx} ${mouthCy + mouthRyBot}
            Q ${mouthCx - mouthRx * 0.5} ${mouthCy + mouthRyBot - lipCurve}
              ${mouthCx - mouthRx} ${mouthCy + lipCurve * 0.5}
            Z
          `}
          fill="#8b2200"
          stroke={cfg.glowColor}
          strokeWidth="3"
          animate={{
            d: `M ${mouthCx - mouthRx} ${mouthCy + lipCurve * 0.5} Q ${mouthCx - mouthRx * 0.5} ${mouthCy - mouthRyTop + lipCurve} ${mouthCx} ${mouthCy - mouthRyTop} Q ${mouthCx + mouthRx * 0.5} ${mouthCy - mouthRyTop + lipCurve} ${mouthCx + mouthRx} ${mouthCy + lipCurve * 0.5} Q ${mouthCx + mouthRx * 0.5} ${mouthCy + mouthRyBot - lipCurve} ${mouthCx} ${mouthCy + mouthRyBot} Q ${mouthCx - mouthRx * 0.5} ${mouthCy + mouthRyBot - lipCurve} ${mouthCx - mouthRx} ${mouthCy + lipCurve * 0.5} Z`
          }}
          transition={{ duration: 0.1, ease: 'linear' }}
        />
        {/* Inner mouth (dark) */}
        <motion.ellipse
          cx={mouthCx} cy={mouthCy + (mouthRyBot - mouthRyTop) / 2}
          rx={mouthRx * 0.75}
          ry={(mouthRyTop + mouthRyBot) * 0.42}
          fill="#1a0400"
          animate={{ ry: (mouthRyTop + mouthRyBot) * 0.42 }}
          transition={{ duration: 0.1 }}
        />
        {/* Teeth (visible when open) */}
        {mouthOpenFinal > 0.3 && (
          <motion.rect
            x={mouthCx - mouthRx * 0.55}
            y={mouthCy - mouthRyTop + 4}
            width={mouthRx * 1.1}
            height={Math.max(0, (mouthRyTop - 6) * mouthOpenFinal * 0.6)}
            rx={3}
            fill="#e8d8b0"
            opacity={Math.min(1, (mouthOpenFinal - 0.3) * 3)}
            animate={{ height: Math.max(0, (mouthRyTop - 6) * mouthOpenFinal * 0.6) }}
            transition={{ duration: 0.1 }}
          />
        )}
      </g>

      {/* ── CHIN TRIANGLE ── */}
      <motion.path
        d={`M ${cx - 14} ${faceCy + faceRy - 40} L ${cx} ${faceCy + faceRy - 20} L ${cx + 14} ${faceCy + faceRy - 40} Z`}
        fill="none"
        stroke={cfg.glowColor}
        strokeWidth="4"
        animate={{ stroke: cfg.glowColor }}
        transition={{ duration: 0.4 }}
      />

      {/* ── FACE DOTS (cheeks upper) ── */}
      {[[-70, 240], [-50, 252], [50, 240], [70, 252]].map(([dx, dy], i) => (
        <motion.circle
          key={i}
          cx={cx + dx} cy={dy}
          r={5}
          fill={cfg.glowColor}
          animate={{ fill: cfg.glowColor, opacity: cfg.markingPulse ? [0.5, 1, 0.5] : 0.7 }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </svg>
  )
}
