import React from 'react'
import { motion } from 'framer-motion'

function Bar({ label, value, max = 100, color, unit = '%' }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#666' }}>
        <span>{label}</span>
        <span style={{ color }}>{value}{unit}</span>
      </div>
      <div style={{ background: '#1a1a1a', borderRadius: 4, height: 6, overflow: 'hidden' }}>
        <motion.div
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5 }}
          style={{ height: '100%', background: color, borderRadius: 4 }}
        />
      </div>
    </div>
  )
}

export default function StatusBar({ robotStatus, connected }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ color: '#e8a020', fontSize: 13, letterSpacing: 2, textTransform: 'uppercase' }}>
          Statut Robot
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
          <motion.div
            animate={{ opacity: connected ? [1, 0.3, 1] : 0.3 }}
            transition={{ duration: 1.5, repeat: Infinity }}
            style={{ width: 8, height: 8, borderRadius: '50%', background: connected ? '#40c080' : '#666' }}
          />
          <span style={{ color: connected ? '#40c080' : '#666' }}>
            {connected ? 'Connecté' : 'Hors ligne'}
          </span>
        </div>
      </div>

      <Bar label="Batterie" value={robotStatus.battery} color="#40c080" />
      <Bar label="Équilibre" value={Math.abs(robotStatus.balance)} max={45} color="#e8a020" unit="°" />
      <Bar label="Vitesse" value={Math.abs(robotStatus.speed)} max={100} color="#c090f0" />

      {robotStatus.lastMessage && (
        <div style={{
          background: '#1a1a1a',
          border: '1px solid #2a2a2a',
          borderRadius: 8,
          padding: '8px 12px',
          color: '#888',
          fontSize: 11,
          fontStyle: 'italic',
        }}>
          "{robotStatus.lastMessage}"
        </div>
      )}
    </div>
  )
}
