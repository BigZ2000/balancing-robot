import React, { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import AfricanMask from './components/AfricanMask'
import EmotionPanel from './components/EmotionPanel'
import SpeechPanel from './components/SpeechPanel'
import StatusBar from './components/StatusBar'
import { useLipSync } from './hooks/useLipSync'
import { useRobotWS } from './hooks/useRobotWS'

// Ambient idle animation for the mask (breathing effect)
function useIdleAnimation(isActive) {
  const [scale, setScale] = useState(1)
  const rafRef = useRef(null)
  const startRef = useRef(null)

  useEffect(() => {
    if (!isActive) { setScale(1); return }
    function tick(t) {
      if (!startRef.current) startRef.current = t
      const elapsed = (t - startRef.current) / 1000
      setScale(1 + Math.sin(elapsed * 0.8) * 0.012)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [isActive])

  return scale
}

export default function App() {
  const [emotion, setEmotion] = useState('neutral')
  const [displayMode, setDisplayMode] = useState('dashboard') // 'dashboard' | 'fullscreen'
  const { phoneme, lipSyncValue, isSpeaking, speak, stop } = useLipSync()
  const { connected, robotStatus, send } = useRobotWS(null) // set ws URL when robot is ready

  // When speaking starts/stops, sync emotion
  useEffect(() => {
    if (isSpeaking && emotion !== 'speaking') {
      // Keep the current emotion but layer speech animation
    }
  }, [isSpeaking, emotion])

  const idleScale = useIdleAnimation(!isSpeaking)

  const effectiveEmotion = isSpeaking ? (emotion === 'neutral' ? 'speaking' : emotion) : emotion

  function handleSpeak(text, lang) {
    speak(text, lang)
    send({ type: 'speak', text, emotion })
  }

  function handleStop() {
    stop()
    send({ type: 'stop' })
  }

  function handleEmotionChange(em) {
    setEmotion(em)
    send({ type: 'emotion', emotion: em })
  }

  if (displayMode === 'fullscreen') {
    return (
      <div
        onClick={() => setDisplayMode('dashboard')}
        style={{
          width: '100vw', height: '100vh',
          background: '#050502',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          overflow: 'hidden',
        }}
      >
        <motion.div
          style={{ scale: idleScale }}
          animate={{ scale: idleScale }}
        >
          <AfricanMask
            emotion={effectiveEmotion}
            phoneme={phoneme}
            lipSyncValue={lipSyncValue}
            size={Math.min(window.innerWidth * 0.85, window.innerHeight * 0.85)}
          />
        </motion.div>
        <div style={{
          position: 'absolute',
          bottom: 24,
          color: '#e8a02044',
          fontSize: 12,
          letterSpacing: 3,
        }}>
          CLIQUEZ POUR REVENIR
        </div>
      </div>
    )
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '260px 1fr 260px',
      gridTemplateRows: 'auto 1fr auto',
      minHeight: '100vh',
      gap: 0,
    }}>
      {/* Header */}
      <header style={{
        gridColumn: '1 / -1',
        padding: '16px 28px',
        borderBottom: '1px solid #1a1a1a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <h1 style={{
            fontSize: 20,
            fontWeight: 700,
            color: '#e8a020',
            letterSpacing: 3,
            textTransform: 'uppercase',
          }}>
            ◈ African Mask Robot
          </h1>
          <p style={{ fontSize: 11, color: '#555', marginTop: 2, letterSpacing: 1 }}>
            Balancing Robot — Interface de contrôle
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <motion.button
            onClick={() => setDisplayMode('fullscreen')}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.97 }}
            style={{
              padding: '8px 18px',
              background: 'transparent',
              border: '1px solid #e8a02060',
              borderRadius: 8,
              color: '#e8a020',
              fontSize: 12,
              cursor: 'pointer',
              letterSpacing: 1,
            }}
          >
            ⛶ Plein écran
          </motion.button>
          <div style={{
            padding: '6px 14px',
            borderRadius: 8,
            background: '#1a1a1a',
            fontSize: 11,
            color: connected ? '#40c080' : '#555',
          }}>
            {connected ? '● Robot connecté' : '○ Simulation'}
          </div>
        </div>
      </header>

      {/* Left Panel — Emotions */}
      <aside style={{
        borderRight: '1px solid #1a1a1a',
        padding: '24px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
      }}>
        <EmotionPanel current={effectiveEmotion} onChange={handleEmotionChange} />
        <div style={{ marginTop: 'auto' }}>
          <StatusBar robotStatus={robotStatus} connected={connected} />
        </div>
      </aside>

      {/* Center — Mask */}
      <main style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 20px',
        gap: 24,
        background: 'radial-gradient(ellipse at center, #120800 0%, #050502 70%)',
      }}>
        <motion.div
          animate={{ scale: idleScale }}
          style={{ filter: 'drop-shadow(0 0 60px rgba(232,160,32,0.15))' }}
        >
          <AfricanMask
            emotion={effectiveEmotion}
            phoneme={phoneme}
            lipSyncValue={lipSyncValue}
            size={420}
          />
        </motion.div>

        {/* Emotion label */}
        <AnimatePresence mode="wait">
          <motion.div
            key={effectiveEmotion}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            style={{
              fontSize: 12,
              letterSpacing: 4,
              textTransform: 'uppercase',
              color: '#e8a02080',
            }}
          >
            {effectiveEmotion}
            {isSpeaking && (
              <motion.span
                animate={{ opacity: [1, 0, 1] }}
                transition={{ duration: 0.6, repeat: Infinity }}
                style={{ marginLeft: 12 }}
              >
                ◉
              </motion.span>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Phoneme debug */}
        <div style={{ fontSize: 11, color: '#333', letterSpacing: 2 }}>
          {isSpeaking ? `phonème: ${phoneme}` : ''}
        </div>
      </main>

      {/* Right Panel — Speech */}
      <aside style={{
        borderLeft: '1px solid #1a1a1a',
        padding: '24px 20px',
      }}>
        <SpeechPanel
          onSpeak={handleSpeak}
          onStop={handleStop}
          isSpeaking={isSpeaking}
          onEmotionChange={handleEmotionChange}
        />
      </aside>

      {/* Footer */}
      <footer style={{
        gridColumn: '1 / -1',
        borderTop: '1px solid #1a1a1a',
        padding: '12px 28px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: 11,
        color: '#333',
      }}>
        <span>Sprint 1 — Masque Animé ✓</span>
        <span>Sprint 2 — Backend TTS (à venir)</span>
        <span>Sprint 3 — Intégration Pi (à venir)</span>
      </footer>
    </div>
  )
}
