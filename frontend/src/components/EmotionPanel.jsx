import React from 'react'
import { motion } from 'framer-motion'

const EMOTION_CONFIG = {
  neutral:   { label: 'Neutre',   icon: '😐', color: '#e8a020' },
  happy:     { label: 'Joie',     icon: '😄', color: '#f0c030' },
  angry:     { label: 'Colère',   icon: '😠', color: '#c42010' },
  sad:       { label: 'Tristesse',icon: '😢', color: '#2060a0' },
  surprised: { label: 'Surprise', icon: '😲', color: '#c090f0' },
  speaking:  { label: 'Parole',   icon: '🗣️', color: '#40c080' },
}

export default function EmotionPanel({ current, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h3 style={{ color: '#e8a020', fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4 }}>
        Émotions
      </h3>
      {Object.entries(EMOTION_CONFIG).map(([key, { label, icon, color }]) => (
        <motion.button
          key={key}
          onClick={() => onChange(key)}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.97 }}
          style={{
            background: current === key ? `${color}22` : 'transparent',
            border: `2px solid ${current === key ? color : '#333'}`,
            borderRadius: 10,
            padding: '10px 16px',
            color: current === key ? color : '#888',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 14,
            fontWeight: current === key ? 700 : 400,
            transition: 'all 0.2s',
            cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: 20 }}>{icon}</span>
          <span>{label}</span>
          {current === key && (
            <motion.div
              layoutId="emotion-indicator"
              style={{
                marginLeft: 'auto',
                width: 8, height: 8,
                borderRadius: '50%',
                background: color,
              }}
            />
          )}
        </motion.button>
      ))}
    </div>
  )
}
