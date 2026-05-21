import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const PRESETS = [
  { text: 'Bonjour ! Je suis le gardien de la sagesse ancestrale.', emotion: 'happy' },
  { text: 'Je vois tout. Je sais tout. Ma mémoire est infinie.', emotion: 'neutral' },
  { text: 'Attention ! Ne me provoquez pas !', emotion: 'angry' },
  { text: 'Les ancêtres pleurent quand la sagesse est oubliée.', emotion: 'sad' },
  { text: 'Incroyable ! Cette découverte change tout !', emotion: 'surprised' },
  { text: 'Mon équilibre parfait reflète l\'harmonie de l\'univers.', emotion: 'speaking' },
]

export default function SpeechPanel({ onSpeak, onStop, isSpeaking, onEmotionChange }) {
  const [customText, setCustomText] = useState('')
  const [lang, setLang] = useState('fr-FR')

  function handlePreset(preset) {
    onEmotionChange(preset.emotion)
    setTimeout(() => onSpeak(preset.text, lang), 150)
  }

  function handleCustomSpeak() {
    if (customText.trim()) {
      onSpeak(customText.trim(), lang)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h3 style={{ color: '#40c080', fontSize: 13, letterSpacing: 2, textTransform: 'uppercase' }}>
        Parole & Lip-sync
      </h3>

      {/* Language selector */}
      <div style={{ display: 'flex', gap: 8 }}>
        {['fr-FR', 'en-US', 'es-ES'].map(l => (
          <button
            key={l}
            onClick={() => setLang(l)}
            style={{
              flex: 1,
              padding: '6px 4px',
              borderRadius: 8,
              border: `2px solid ${lang === l ? '#40c080' : '#333'}`,
              background: lang === l ? '#40c08022' : 'transparent',
              color: lang === l ? '#40c080' : '#666',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {l.split('-')[0].toUpperCase()}
          </button>
        ))}
      </div>

      {/* Presets */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {PRESETS.map((p, i) => (
          <motion.button
            key={i}
            onClick={() => handlePreset(p)}
            whileHover={{ x: 4 }}
            whileTap={{ scale: 0.98 }}
            style={{
              background: '#1a1a1a',
              border: '1px solid #2a2a2a',
              borderLeft: '3px solid #40c08060',
              borderRadius: 8,
              padding: '8px 12px',
              color: '#aaa',
              fontSize: 12,
              textAlign: 'left',
              cursor: 'pointer',
              lineHeight: 1.4,
            }}
          >
            {p.text}
          </motion.button>
        ))}
      </div>

      {/* Custom input */}
      <textarea
        value={customText}
        onChange={e => setCustomText(e.target.value)}
        placeholder="Entrez votre texte..."
        rows={3}
        style={{
          background: '#1a1a1a',
          border: '1px solid #333',
          borderRadius: 8,
          padding: '10px 12px',
          color: '#ddd',
          fontSize: 13,
          resize: 'vertical',
          fontFamily: 'inherit',
          outline: 'none',
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' && e.ctrlKey) handleCustomSpeak()
        }}
      />

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8 }}>
        <motion.button
          onClick={handleCustomSpeak}
          disabled={isSpeaking || !customText.trim()}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.97 }}
          style={{
            flex: 2,
            padding: '12px',
            borderRadius: 10,
            background: isSpeaking ? '#1a3a2a' : '#40c080',
            color: isSpeaking ? '#40c08066' : '#000',
            fontWeight: 700,
            fontSize: 14,
            cursor: isSpeaking ? 'not-allowed' : 'pointer',
          }}
        >
          {isSpeaking ? '...' : '▶ Parler'}
        </motion.button>
        <motion.button
          onClick={onStop}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.97 }}
          style={{
            flex: 1,
            padding: '12px',
            borderRadius: 10,
            background: '#2a1a1a',
            border: '1px solid #c4201030',
            color: '#c42010',
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          ■ Stop
        </motion.button>
      </div>

      <AnimatePresence>
        {isSpeaking && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              color: '#40c080',
              fontSize: 12,
            }}
          >
            <motion.div
              animate={{ scale: [1, 1.3, 1] }}
              transition={{ duration: 0.5, repeat: Infinity }}
              style={{ width: 8, height: 8, borderRadius: '50%', background: '#40c080' }}
            />
            En train de parler...
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
