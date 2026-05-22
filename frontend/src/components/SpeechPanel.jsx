import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import AudioViz from './AudioViz'
import { useTextEmotion } from '../hooks/useTextEmotion'

const PRESETS = [
  { text: 'Bonjour ! Je suis le gardien de la sagesse ancestrale.', emotion: 'happy' },
  { text: 'Je vois tout. Je sais tout. Ma mémoire est infinie.', emotion: 'neutral' },
  { text: 'Attention ! Ne me provoquez pas davantage !', emotion: 'angry' },
  { text: 'Les ancêtres pleurent quand la sagesse est oubliée.', emotion: 'sad' },
  { text: 'Incroyable ! Cette découverte extraordinaire change tout !', emotion: 'surprised' },
  { text: "Mon équilibre parfait reflète l'harmonie de l'univers.", emotion: 'speaking' },
]

const EMOTION_ICONS = {
  happy: '😄', angry: '😠', sad: '😢', surprised: '😲', speaking: '🗣️', neutral: '😐',
}

const LANG_LABELS = { 'fr-FR': 'FR', 'en-US': 'EN', 'es-ES': 'ES' }

export default function SpeechPanel({
  onSpeak, onStop, isSpeaking, onEmotionChange,
  isLoading = false,
  phoneme = 'rest', lipSyncValue = 0, emotion = 'neutral',
}) {
  const [customText,   setCustomText]   = useState('')
  const [lang,         setLang]         = useState('fr-FR')
  const [autoEmotion,  setAutoEmotion]  = useState(true)
  const [ttsRate,      setTtsRate]      = useState(0.9)
  const [ttsPitch,     setTtsPitch]     = useState(0.85)
  const [showSettings, setShowSettings] = useState(false)

  // Détection d'émotion automatique
  const { suggested, confidence } = useTextEmotion(customText, autoEmotion)

  useEffect(() => {
    if (autoEmotion && suggested && confidence > 0.3) {
      onEmotionChange(suggested)
    }
  }, [suggested, confidence, autoEmotion, onEmotionChange])

  function handlePreset(preset) {
    onEmotionChange(preset.emotion)
    setTimeout(() => onSpeak(preset.text, lang, { rate: ttsRate, pitch: ttsPitch }), 120)
  }

  function handleCustomSpeak() {
    if (!customText.trim()) return
    onSpeak(customText.trim(), lang, { rate: ttsRate, pitch: ttsPitch })
  }

  const busy = isSpeaking || isLoading

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* En-tête */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ color: '#40c080', fontSize: 13, letterSpacing: 2, textTransform: 'uppercase' }}>
          Parole & Lip-sync
        </h3>
        <button
          onClick={() => setShowSettings(s => !s)}
          style={{
            background: 'transparent', border: 'none',
            color: showSettings ? '#e8a020' : '#444',
            fontSize: 16, cursor: 'pointer', lineHeight: 1,
          }}
          title="Paramètres TTS"
        >
          ⚙
        </button>
      </div>

      {/* Visualiseur audio */}
      <AudioViz
        phoneme={phoneme}
        lipSyncValue={lipSyncValue}
        emotion={emotion}
        isSpeaking={isSpeaking}
        width={240}
        height={52}
      />

      {/* Paramètres TTS */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{
              background: '#111', border: '1px solid #1e1e1e',
              borderRadius: 10, padding: '12px 14px',
              display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              <h4 style={{ fontSize: 10, color: '#555', letterSpacing: 2, textTransform: 'uppercase' }}>
                Paramètres voix
              </h4>
              {[
                { label: 'Vitesse', val: ttsRate,  set: setTtsRate,  min: 0.5, max: 2.0, step: 0.05 },
                { label: 'Tonalité', val: ttsPitch, set: setTtsPitch, min: 0.5, max: 2.0, step: 0.05 },
              ].map(({ label, val, set, min, max, step }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                  <span style={{ color: '#555', width: 55 }}>{label}</span>
                  <input
                    type="range" min={min} max={max} step={step} value={val}
                    onChange={e => set(parseFloat(e.target.value))}
                    style={{ flex: 1, accentColor: '#40c080' }}
                  />
                  <span style={{ color: '#40c080', width: 32, textAlign: 'right' }}>{val.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Langue + auto-émotion */}
      <div style={{ display: 'flex', gap: 6 }}>
        {Object.entries(LANG_LABELS).map(([code, label]) => (
          <button key={code} onClick={() => setLang(code)} style={{
            flex: 1, padding: '6px 4px', borderRadius: 8,
            border: `2px solid ${lang === code ? '#40c080' : '#252525'}`,
            background: lang === code ? '#40c08018' : 'transparent',
            color: lang === code ? '#40c080' : '#555',
            fontSize: 11, cursor: 'pointer',
          }}>
            {label}
          </button>
        ))}
        <button
          onClick={() => setAutoEmotion(v => !v)}
          title="Détection d'émotion automatique"
          style={{
            flex: 1.4, padding: '6px 6px', borderRadius: 8,
            border: `2px solid ${autoEmotion ? '#c090f0' : '#252525'}`,
            background: autoEmotion ? '#c090f018' : 'transparent',
            color: autoEmotion ? '#c090f0' : '#555',
            fontSize: 10, cursor: 'pointer',
            letterSpacing: 0.5,
          }}
        >
          🎭 Auto
        </button>
      </div>

      {/* Suggestion d'émotion */}
      <AnimatePresence>
        {autoEmotion && suggested && confidence > 0.3 && !isSpeaking && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#c090f010', border: '1px solid #c090f030',
              borderRadius: 8, padding: '6px 10px', fontSize: 11, color: '#c090f0',
            }}
          >
            <span>{EMOTION_ICONS[suggested]}</span>
            <span>Émotion détectée : <strong>{suggested}</strong></span>
            <span style={{ marginLeft: 'auto', opacity: 0.6 }}>
              {Math.round(confidence * 100)}%
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Presets */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {PRESETS.map((p, i) => (
          <motion.button key={i} onClick={() => handlePreset(p)}
            whileHover={{ x: 4 }} whileTap={{ scale: 0.98 }}
            style={{
              background: '#141414', border: '1px solid #202020',
              borderLeft: `3px solid ${busy ? '#2a2a2a' : '#40c08055'}`,
              borderRadius: 8, padding: '8px 12px',
              color: busy ? '#444' : '#999',
              fontSize: 11, textAlign: 'left', cursor: busy ? 'not-allowed' : 'pointer',
              lineHeight: 1.4, display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            <span style={{ fontSize: 14, flexShrink: 0 }}>{EMOTION_ICONS[p.emotion]}</span>
            <span>{p.text}</span>
          </motion.button>
        ))}
      </div>

      {/* Saisie libre */}
      <textarea
        value={customText}
        onChange={e => setCustomText(e.target.value)}
        placeholder="Entrez votre texte… (Ctrl+Entrée pour parler)"
        rows={3}
        style={{
          background: '#111', border: '1px solid #282828', borderRadius: 8,
          padding: '10px 12px', color: '#ddd', fontSize: 13,
          resize: 'vertical', fontFamily: 'inherit', outline: 'none',
          transition: 'border-color 0.2s',
        }}
        onFocus={e => { e.target.style.borderColor = '#40c08060' }}
        onBlur={e  => { e.target.style.borderColor = '#282828' }}
        onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handleCustomSpeak() }}
      />

      {/* Compteur de caractères */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 10, color: '#333', marginTop: -8 }}>
        {customText.length} / 500
      </div>

      {/* Boutons */}
      <div style={{ display: 'flex', gap: 8 }}>
        <motion.button
          onClick={handleCustomSpeak}
          disabled={busy || !customText.trim()}
          whileHover={!busy ? { scale: 1.03 } : {}}
          whileTap={!busy ? { scale: 0.97 } : {}}
          style={{
            flex: 2, padding: '13px', borderRadius: 10,
            background: busy ? '#112218' : '#40c080',
            color: busy ? '#40c08055' : '#000',
            fontWeight: 800, fontSize: 14,
            cursor: busy ? 'not-allowed' : 'pointer',
            transition: 'background 0.2s',
          }}
        >
          {isLoading ? '⏳ Synthèse...' : isSpeaking ? '◉ En cours...' : '▶ Parler'}
        </motion.button>
        <motion.button
          onClick={onStop}
          whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
          style={{
            flex: 1, padding: '13px', borderRadius: 10,
            background: '#1a0a0a', border: '1px solid #c4201028',
            color: '#c42010', fontWeight: 700, fontSize: 14, cursor: 'pointer',
          }}
        >
          ■ Stop
        </motion.button>
      </div>

      {/* Statut */}
      <AnimatePresence>
        {isSpeaking && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#40c080', fontSize: 11 }}
          >
            <motion.div
              animate={{ scaleY: [1, 1.8, 1] }}
              transition={{ duration: 0.45, repeat: Infinity }}
              style={{ width: 3, height: 12, background: '#40c080', borderRadius: 2 }}
            />
            <motion.div
              animate={{ scaleY: [1, 2.4, 1] }}
              transition={{ duration: 0.45, repeat: Infinity, delay: 0.1 }}
              style={{ width: 3, height: 12, background: '#40c080', borderRadius: 2 }}
            />
            <motion.div
              animate={{ scaleY: [1, 1.5, 1] }}
              transition={{ duration: 0.45, repeat: Infinity, delay: 0.2 }}
              style={{ width: 3, height: 12, background: '#40c080', borderRadius: 2 }}
            />
            <span style={{ marginLeft: 4 }}>En train de parler…</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
