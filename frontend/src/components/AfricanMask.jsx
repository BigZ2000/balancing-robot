import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'

const EMOTIONS = {
  neutral: {
    label: 'Neutre',
    eyeOpenness: 0.5,
    browLift: 0,
    mouthOpen: 0.1,
    mouthCurve: 0,
    pupilSize: 1,
    blinkRate: 3800,
    glowColor: '#e8a020',
    faceGlow: 0.3,
    markingPulse: false,
  },
  happy: {
    label: 'Joie',
    eyeOpenness: 0.72,
    browLift: 6,
    mouthOpen: 0.5,
    mouthCurve: 12,
    pupilSize: 1.2,
    blinkRate: 4200,
    glowColor: '#f0c030',
    faceGlow: 0.8,
    markingPulse: true,
  },
  angry: {
    label: 'Colère',
    eyeOpenness: 0.3,
    browLift: -10,
    mouthOpen: 0.3,
    mouthCurve: -8,
    pupilSize: 0.65,
    blinkRate: 7000,
    glowColor: '#c42010',
    faceGlow: 0.9,
    markingPulse: false,
  },
  sad: {
    label: 'Tristesse',
    eyeOpenness: 0.28,
    browLift: 5,
    mouthOpen: 0.12,
    mouthCurve: -11,
    pupilSize: 0.85,
    blinkRate: 2200,
    glowColor: '#2060a0',
    faceGlow: 0.5,
    markingPulse: false,
  },
  surprised: {
    label: 'Surprise',
    eyeOpenness: 1.0,
    browLift: 16,
    mouthOpen: 0.82,
    mouthCurve: 0,
    pupilSize: 1.45,
    blinkRate: 5500,
    glowColor: '#c090f0',
    faceGlow: 1.0,
    markingPulse: true,
  },
  speaking: {
    label: 'Parle',
    eyeOpenness: 0.58,
    browLift: 2,
    mouthOpen: 0.42,
    mouthCurve: 4,
    pupilSize: 1.1,
    blinkRate: 3200,
    glowColor: '#40c080',
    faceGlow: 0.6,
    markingPulse: true,
  },
}

const PHONEME_SHAPES = {
  rest: { open: 0.05, width: 1.0 },
  A:    { open: 0.78, width: 1.1 },
  E:    { open: 0.46, width: 1.22 },
  I:    { open: 0.28, width: 1.28 },
  O:    { open: 0.68, width: 0.88 },
  U:    { open: 0.42, width: 0.78 },
  M:    { open: 0.0,  width: 1.0 },
  F:    { open: 0.18, width: 1.05 },
  S:    { open: 0.14, width: 1.12 },
  TH:   { open: 0.22, width: 1.0 },
}

function lerp(a, b, t) { return a + (b - a) * t }

export default function AfricanMask({ emotion = 'neutral', phoneme = 'rest', lipSyncValue = 0, size = 600 }) {
  const cfg = EMOTIONS[emotion] || EMOTIONS.neutral
  const ph  = PHONEME_SHAPES[phoneme] || PHONEME_SHAPES.rest

  // ── Blink state ────────────────────────────────────────────────────────────
  const [blinkPhase, setBlinkPhase] = useState(0) // 0=open 1=closing 2=closed 3=opening
  const blinkTimerRef = useRef(null)

  useEffect(() => {
    function scheduleBlink() {
      // Jitter autour du blinkRate pour naturel
      const jitter = (Math.random() - 0.5) * 800
      blinkTimerRef.current = setTimeout(() => {
        setBlinkPhase(1)                                       // fermeture
        setTimeout(() => setBlinkPhase(2), 70)                 // fermé
        setTimeout(() => setBlinkPhase(3), 140)               // ouverture
        setTimeout(() => { setBlinkPhase(0); scheduleBlink() }, 230) // ouvert
      }, cfg.blinkRate + jitter)
    }
    scheduleBlink()
    return () => clearTimeout(blinkTimerRef.current)
  }, [cfg.blinkRate])

  // Openness réelle : blink override sur l'émotion
  const blinkFactor = blinkPhase === 1 ? 0.4 : blinkPhase === 2 ? 0.02 : blinkPhase === 3 ? 0.5 : 1.0
  const eyeOpennessReal = cfg.eyeOpenness * blinkFactor

  // ── Géométrie SVG ──────────────────────────────────────────────────────────
  const vw = 400, vh = 500, cx = 200
  const faceRx = 130, faceRy = 170, faceCy = 250
  const eyeY = 210, eyeOffX = 55, eyeRx = 36, eyeRyBase = 20
  const eyeRy = eyeRyBase * eyeOpennessReal

  const browY = eyeY - 30 - cfg.browLift
  const browH = 8

  const mouthOpenFinal = (emotion === 'speaking' || lipSyncValue > 0)
    ? lerp(cfg.mouthOpen, ph.open, Math.max(lipSyncValue, 0.65))
    : cfg.mouthOpen
  const mouthWidthScale = ph.width
  const mouthCx = cx, mouthCy = 340
  const mouthRx  = 40 * mouthWidthScale
  const mouthRyT = 10 + mouthOpenFinal * 28
  const mouthRyB = 8  + mouthOpenFinal * 22
  const lipCurve = cfg.mouthCurve

  const mouthPath = (ryT, ryB) =>
    `M ${mouthCx - mouthRx} ${mouthCy + lipCurve * 0.5}` +
    ` Q ${mouthCx - mouthRx * 0.5} ${mouthCy - ryT + lipCurve} ${mouthCx} ${mouthCy - ryT}` +
    ` Q ${mouthCx + mouthRx * 0.5} ${mouthCy - ryT + lipCurve} ${mouthCx + mouthRx} ${mouthCy + lipCurve * 0.5}` +
    ` Q ${mouthCx + mouthRx * 0.5} ${mouthCy + ryB - lipCurve} ${mouthCx} ${mouthCy + ryB}` +
    ` Q ${mouthCx - mouthRx * 0.5} ${mouthCy + ryB - lipCurve} ${mouthCx - mouthRx} ${mouthCy + lipCurve * 0.5} Z`

  const lidRy = eyeRyBase * (1 - eyeOpennessReal) + 2

  return (
    <svg
      viewBox={`0 0 ${vw} ${vh}`}
      width={size}
      height={size * (vh / vw)}
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block', filter: `drop-shadow(0 0 ${cfg.faceGlow * 38}px ${cfg.glowColor}80)` }}
    >
      <defs>
        <radialGradient id="face-grad" cx="50%" cy="44%" r="62%">
          <stop offset="0%"   stopColor="#9b4218" />
          <stop offset="55%"  stopColor="#5a1e06" />
          <stop offset="100%" stopColor="#220800" />
        </radialGradient>
        <radialGradient id="eye-grad" cx="35%" cy="30%" r="65%">
          <stop offset="0%"   stopColor="#a0e0c0" />
          <stop offset="100%" stopColor="#1a5a4a" />
        </radialGradient>
        <filter id="inner-shadow">
          <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#00000088" />
        </filter>
      </defs>

      {/* BORDURE EXTÉRIEURE */}
      <motion.ellipse
        cx={cx} cy={faceCy} rx={faceRx + 14} ry={faceRy + 14}
        fill="none" stroke={cfg.glowColor} strokeWidth="8"
        animate={{ stroke: cfg.glowColor, opacity: cfg.markingPulse ? [0.65, 1, 0.65] : 1 }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* CORPS */}
      <ellipse cx={cx} cy={faceCy} rx={faceRx} ry={faceRy} fill="url(#face-grad)" />

      {/* BANDE FRONT */}
      <motion.path
        d={`M ${cx - faceRx + 20} ${faceCy - faceRy + 52} Q ${cx} ${faceCy - faceRy + 30} ${cx + faceRx - 20} ${faceCy - faceRy + 52}`}
        fill="none" stroke={cfg.glowColor} strokeWidth="7" strokeLinecap="round"
        animate={{ stroke: cfg.glowColor }} transition={{ duration: 0.4 }}
      />

      {/* CERCLE COURONNE */}
      <motion.circle cx={cx} cy={faceCy - faceRy + 18} r={14} fill={cfg.glowColor}
        animate={{ fill: cfg.glowColor, r: cfg.markingPulse ? [14, 16.5, 14] : 14 }}
        transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
      />
      {[-36, -20, 20, 36].map((dx, i) => (
        <motion.circle key={i} cx={cx + dx} cy={faceCy - faceRy + 40} r={5} fill={cfg.glowColor}
          animate={{ fill: cfg.glowColor, opacity: cfg.markingPulse ? [0.55, 1, 0.55] : 0.8 }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.1 }}
        />
      ))}

      {/* NEZ CENTRAL */}
      <rect x={cx - 6} y={faceCy - faceRy + 56} width={12} height={98} rx={5}
        fill={cfg.glowColor} opacity={0.82} />

      {/* SOURCILS */}
      {[-1, 1].map(side => (
        <motion.path key={side}
          d={`M ${cx + side*(eyeOffX - eyeRx - 4)} ${browY + (side === -1 ? cfg.browLift*0.3 : 0)} Q ${cx + side*eyeOffX} ${browY - browH} ${cx + side*(eyeOffX + eyeRx + 4)} ${browY + (side === 1 ? cfg.browLift*0.3 : 0)}`}
          fill="none" stroke={cfg.glowColor} strokeWidth="9" strokeLinecap="round"
          animate={{ d: `M ${cx + side*(eyeOffX - eyeRx - 4)} ${browY + (side === -1 ? cfg.browLift*0.3 : 0)} Q ${cx + side*eyeOffX} ${browY - browH} ${cx + side*(eyeOffX + eyeRx + 4)} ${browY + (side === 1 ? cfg.browLift*0.3 : 0)}`, stroke: cfg.glowColor }}
          transition={{ duration: 0.3 }}
        />
      ))}

      {/* YEUX */}
      {[-1, 1].map(side => (
        <g key={side}>
          <ellipse cx={cx + side*eyeOffX} cy={eyeY} rx={eyeRx + 6} ry={eyeRyBase + 9} fill="#180600" />
          <motion.ellipse cx={cx + side*eyeOffX} cy={eyeY} rx={eyeRx} ry={eyeRy}
            fill="url(#eye-grad)"
            animate={{ ry: eyeRy }}
            transition={{ duration: blinkPhase !== 0 ? 0.07 : 0.25 }}
          />
          <motion.circle cx={cx + side*eyeOffX} cy={eyeY} r={10 * cfg.pupilSize}
            fill="#060202"
            animate={{ r: 10 * cfg.pupilSize }}
            transition={{ duration: 0.25 }}
          />
          {/* Reflet */}
          <circle cx={cx + side*eyeOffX - 9} cy={eyeY - 7} r={4} fill="rgba(255,255,255,0.65)" />
          {/* Paupière supérieure — s'abaisse au clin d'œil */}
          <motion.ellipse
            cx={cx + side*eyeOffX} cy={eyeY - eyeRyBase}
            rx={eyeRx + 2} ry={lidRy}
            fill="#5a1e06"
            animate={{ ry: lidRy }}
            transition={{ duration: blinkPhase !== 0 ? 0.07 : 0.25 }}
          />
        </g>
      ))}

      {/* MARQUAGES JOUES */}
      {[-1, 1].map(side => (
        <g key={side}>
          <motion.rect x={cx + side*80 - (side===1?20:0)} y={280} width={20} height={7} rx={3}
            fill="#2d7a6b"
            animate={{ opacity: cfg.markingPulse ? [0.65, 1, 0.65] : 0.85 }}
            transition={{ duration: 1.4, repeat: Infinity }}
          />
          <motion.rect x={cx + side*78 - (side===1?18:0)} y={292} width={16} height={7} rx={3}
            fill="#2d7a6b"
            animate={{ opacity: cfg.markingPulse ? [0.45, 0.9, 0.45] : 0.7 }}
            transition={{ duration: 1.4, repeat: Infinity, delay: 0.3 }}
          />
        </g>
      ))}

      {/* OREILLES */}
      {[-1, 1].map(side => (
        <g key={side}>
          <ellipse cx={cx + side*(faceRx + 8)} cy={eyeY + 20} rx={18} ry={28} fill="#7a2a0a" />
          <motion.circle cx={cx + side*(faceRx + 8)} cy={eyeY + 28} r={9} fill={cfg.glowColor}
            animate={{ fill: cfg.glowColor, r: cfg.markingPulse ? [9, 11.5, 9] : 9 }}
            transition={{ duration: 1.6, repeat: Infinity }}
          />
        </g>
      ))}

      {/* BOUCHE */}
      <g filter="url(#inner-shadow)">
        <motion.path
          d={mouthPath(mouthRyT, mouthRyB)}
          fill="#8b2200" stroke={cfg.glowColor} strokeWidth="3"
          animate={{ d: mouthPath(mouthRyT, mouthRyB), stroke: cfg.glowColor }}
          transition={{ duration: 0.08, ease: 'linear' }}
        />
        <motion.ellipse
          cx={mouthCx} cy={mouthCy + (mouthRyB - mouthRyT) / 2}
          rx={mouthRx * 0.74} ry={(mouthRyT + mouthRyB) * 0.42}
          fill="#160300"
          animate={{ ry: (mouthRyT + mouthRyB) * 0.42 }}
          transition={{ duration: 0.08 }}
        />
        {mouthOpenFinal > 0.28 && (
          <motion.rect
            x={mouthCx - mouthRx * 0.54} y={mouthCy - mouthRyT + 5}
            width={mouthRx * 1.08}
            height={Math.max(0, (mouthRyT - 7) * mouthOpenFinal * 0.58)}
            rx={3} fill="#ead8a8"
            opacity={Math.min(1, (mouthOpenFinal - 0.28) * 3.5)}
            animate={{ height: Math.max(0, (mouthRyT - 7) * mouthOpenFinal * 0.58) }}
            transition={{ duration: 0.08 }}
          />
        )}
      </g>

      {/* TRIANGLE MENTON */}
      <motion.path
        d={`M ${cx-14} ${faceCy+faceRy-42} L ${cx} ${faceCy+faceRy-20} L ${cx+14} ${faceCy+faceRy-42} Z`}
        fill="none" stroke={cfg.glowColor} strokeWidth="4"
        animate={{ stroke: cfg.glowColor }} transition={{ duration: 0.4 }}
      />

      {/* POINTS JOUES */}
      {[[-70,240],[-50,253],[50,240],[70,253]].map(([dx,dy], i) => (
        <motion.circle key={i} cx={cx+dx} cy={dy} r={5} fill={cfg.glowColor}
          animate={{ fill: cfg.glowColor, opacity: cfg.markingPulse ? [0.45,1,0.45] : 0.7 }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i*0.15 }}
        />
      ))}
    </svg>
  )
}
