import React, { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import AfricanMask from './components/AfricanMask'
import EmotionPanel from './components/EmotionPanel'
import SpeechPanel from './components/SpeechPanel'
import StatusBar from './components/StatusBar'
import BalanceViz from './components/BalanceViz'
import RobotControl from './components/RobotControl'
import { useLipSync } from './hooks/useLipSync'
import { useBackendTTS } from './hooks/useBackendTTS'
import { useRobotWS } from './hooks/useRobotWS'

const BACKEND_WS = 'ws://localhost:5000/ws'
const BACKEND_API = 'http://localhost:5000'

// ── Breathing idle ───────────────────────────────────────────────────────────
function useIdleBreath(active) {
  const [scale, setScale] = useState(1)
  const rafRef  = useRef(null)
  const t0Ref   = useRef(null)

  useEffect(() => {
    if (!active) { setScale(1); return }
    function tick(t) {
      if (!t0Ref.current) t0Ref.current = t
      setScale(1 + Math.sin(((t - t0Ref.current) / 1000) * 0.75) * 0.013)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [active])

  return scale
}

// ── Tabs ─────────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'face',    label: 'Visage' },
  { id: 'robot',   label: 'Équilibre' },
  { id: 'control', label: 'Contrôle' },
]

export default function App() {
  const [emotion,      setEmotion]     = useState('neutral')
  const [phoneme,      setPhoneme]     = useState('rest')
  const [lipValue,     setLipValue]    = useState(0)
  const [isSpeaking,   setIsSpeaking]  = useState(false)
  const [displayMode,  setDisplayMode] = useState('dashboard')
  const [activeTab,    setActiveTab]   = useState('face')
  const [pidHistory,   setPidHistory]  = useState([])
  const [backendMode,  setBackendMode] = useState(false) // true = edge-tts, false = Web Speech

  // ── WebSocket robot ──────────────────────────────────────────────────────
  const { connected, robotStatus, send } = useRobotWS(BACKEND_WS)

  // Récupérer l'historique PID périodiquement
  useEffect(() => {
    if (!connected) return
    const id = setInterval(async () => {
      try {
        const r = await fetch(`${BACKEND_API}/api/pid_history`)
        const d = await r.json()
        setPidHistory(d.history || [])
      } catch {}
    }, 500)
    return () => clearInterval(id)
  }, [connected])

  // ── TTS Web Speech (fallback local) ─────────────────────────────────────
  const localTTS = useLipSync()

  // ── TTS Backend (edge-tts) ───────────────────────────────────────────────
  const backendTTS = useBackendTTS({
    onPhoneme: useCallback((ph, dur) => {
      setPhoneme(ph)
      setLipValue(ph === 'rest' ? 0 : 0.65 + Math.random() * 0.35)
    }, []),
    onEnd: useCallback(() => {
      setIsSpeaking(false)
      setPhoneme('rest')
      setLipValue(0)
    }, []),
  })

  // Sync phonème local TTS → état
  useEffect(() => {
    if (!backendMode) {
      setPhoneme(localTTS.phoneme)
      setLipValue(localTTS.lipSyncValue)
    }
  }, [localTTS.phoneme, localTTS.lipSyncValue, backendMode])

  useEffect(() => {
    setIsSpeaking(backendMode ? backendTTS.isSpeaking : localTTS.isSpeaking)
  }, [backendTTS.isSpeaking, localTTS.isSpeaking, backendMode])

  // ── Handlers ─────────────────────────────────────────────────────────────
  function handleSpeak(text, lang) {
    const em = emotion
    if (backendMode) {
      backendTTS.speak(text, lang, em)
    } else {
      localTTS.speak(text, lang)
    }
    send({ type: 'speak', text, emotion: em })
  }

  function handleStop() {
    localTTS.stop()
    backendTTS.stop()
    setIsSpeaking(false)
    setPhoneme('rest')
    setLipValue(0)
    send({ type: 'stop_speak' })
  }

  function handleEmotionChange(em) {
    setEmotion(em)
    send({ type: 'emotion', emotion: em })
  }

  function handleRobotCommand(cmd) {
    send({ type: 'control', ...cmd })
    fetch(`${BACKEND_API}/api/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    }).catch(() => {})
  }

  function handlePIDChange({ kp, ki, kd }) {
    send({ type: 'pid', kp, ki, kd })
    fetch(`${BACKEND_API}/api/pid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kp, ki, kd }),
    }).catch(() => {})
  }

  const effectiveEmotion = isSpeaking && emotion === 'neutral' ? 'speaking' : emotion
  const idleScale = useIdleBreath(!isSpeaking)

  // ── Mode plein écran (pour l'écran Pi) ──────────────────────────────────
  if (displayMode === 'fullscreen') {
    return (
      <div
        onClick={() => setDisplayMode('dashboard')}
        style={{
          width: '100vw', height: '100vh',
          background: '#050502',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', overflow: 'hidden',
        }}
      >
        <motion.div animate={{ scale: idleScale }}>
          <AfricanMask
            emotion={effectiveEmotion}
            phoneme={phoneme}
            lipSyncValue={lipValue}
            size={Math.min(window.innerWidth * 0.88, window.innerHeight * 0.88)}
          />
        </motion.div>
        <div style={{
          position: 'absolute', bottom: 20,
          color: '#e8a02030', fontSize: 11, letterSpacing: 4,
        }}>
          CLIQUEZ POUR REVENIR
        </div>
      </div>
    )
  }

  // ── Dashboard ────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '240px 1fr 280px',
      gridTemplateRows: 'auto 1fr auto',
      minHeight: '100vh',
    }}>

      {/* ── Header ── */}
      <header style={{
        gridColumn: '1 / -1',
        padding: '14px 24px',
        borderBottom: '1px solid #161616',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 800, color: '#e8a020', letterSpacing: 3, textTransform: 'uppercase' }}>
            ◈ African Mask Robot
          </h1>
          <p style={{ fontSize: 10, color: '#444', marginTop: 1, letterSpacing: 2 }}>
            SPRINT 2 — TTS PRÉCIS + PID BALANCE
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {/* Toggle TTS mode */}
          <button
            onClick={() => setBackendMode(m => !m)}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              border: `1px solid ${backendMode ? '#40c080' : '#333'}`,
              background: backendMode ? '#40c08015' : 'transparent',
              color: backendMode ? '#40c080' : '#555',
              fontSize: 11, cursor: 'pointer',
            }}
          >
            {backendMode ? '🎙 edge-tts' : '🔊 Web Speech'}
          </button>
          <button
            onClick={() => setDisplayMode('fullscreen')}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              border: '1px solid #e8a02040',
              background: 'transparent',
              color: '#e8a020',
              fontSize: 11, cursor: 'pointer',
            }}
          >
            ⛶ Plein écran Pi
          </button>
          <div style={{
            padding: '5px 12px', borderRadius: 8, background: '#111',
            fontSize: 10, color: connected ? '#40c080' : '#444',
          }}>
            {connected ? '● Backend connecté' : '○ Hors ligne'}
          </div>
        </div>
      </header>

      {/* ── Panneau gauche : émotions + statut ── */}
      <aside style={{
        borderRight: '1px solid #161616',
        padding: '20px 16px',
        display: 'flex', flexDirection: 'column', gap: 20,
        overflowY: 'auto',
      }}>
        <EmotionPanel current={effectiveEmotion} onChange={handleEmotionChange} />
        <div style={{ marginTop: 'auto' }}>
          <StatusBar robotStatus={robotStatus} connected={connected} />
        </div>
      </aside>

      {/* ── Centre : masque + onglets ── */}
      <main style={{
        display: 'flex', flexDirection: 'column',
        background: 'radial-gradient(ellipse at 50% 40%, #100600 0%, #050402 65%)',
        overflowY: 'auto',
      }}>
        {/* Masque toujours visible en haut */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 16px 12px' }}>
          <motion.div animate={{ scale: idleScale }}>
            <AfricanMask
              emotion={effectiveEmotion}
              phoneme={phoneme}
              lipSyncValue={lipValue}
              size={320}
            />
          </motion.div>

          <AnimatePresence mode="wait">
            <motion.div
              key={effectiveEmotion}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              style={{ fontSize: 11, letterSpacing: 4, textTransform: 'uppercase', color: '#e8a02060', marginTop: 10 }}
            >
              {effectiveEmotion}
              {isSpeaking && (
                <motion.span
                  animate={{ opacity: [1, 0, 1] }}
                  transition={{ duration: 0.5, repeat: Infinity }}
                  style={{ marginLeft: 10 }}
                >◉</motion.span>
              )}
            </motion.div>
          </AnimatePresence>

          {backendTTS.error && (
            <div style={{ fontSize: 10, color: '#c42010', marginTop: 6 }}>
              ⚠ TTS: {backendTTS.error}
            </div>
          )}
        </div>

        {/* Onglets */}
        <div style={{ borderTop: '1px solid #161616', borderBottom: '1px solid #161616' }}>
          <div style={{ display: 'flex' }}>
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1, padding: '10px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: `2px solid ${activeTab === tab.id ? '#e8a020' : 'transparent'}`,
                  color: activeTab === tab.id ? '#e8a020' : '#444',
                  fontSize: 11, letterSpacing: 2, textTransform: 'uppercase',
                  cursor: 'pointer', transition: 'all 0.2s',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Contenu onglet */}
        <div style={{ padding: '16px', flex: 1 }}>
          <AnimatePresence mode="wait">
            {activeTab === 'face' && (
              <motion.div key="face"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              >
                <SpeechPanel
                  onSpeak={handleSpeak}
                  onStop={handleStop}
                  isSpeaking={isSpeaking}
                  onEmotionChange={handleEmotionChange}
                  isLoading={backendTTS.isLoading}
                />
              </motion.div>
            )}
            {activeTab === 'robot' && (
              <motion.div key="robot"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              >
                <BalanceViz
                  robotStatus={robotStatus}
                  history={pidHistory}
                  onPIDChange={handlePIDChange}
                />
              </motion.div>
            )}
            {activeTab === 'control' && (
              <motion.div key="control"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              >
                <RobotControl
                  onCommand={handleRobotCommand}
                  robotStatus={robotStatus}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* ── Panneau droit : parole ── */}
      <aside style={{
        borderLeft: '1px solid #161616',
        padding: '20px 16px',
        overflowY: 'auto',
      }}>
        <SpeechPanel
          onSpeak={handleSpeak}
          onStop={handleStop}
          isSpeaking={isSpeaking}
          onEmotionChange={handleEmotionChange}
          isLoading={backendTTS.isLoading}
        />
      </aside>

      {/* ── Footer ── */}
      <footer style={{
        gridColumn: '1 / -1',
        borderTop: '1px solid #161616',
        padding: '10px 24px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 10, color: '#2a2a2a',
      }}>
        <span style={{ color: '#3a3a3a' }}>Sprint 1 ✓ Masque SVG animé</span>
        <span style={{ color: '#e8a02060' }}>Sprint 2 ✓ TTS précis + PID + Contrôle</span>
        <span>Sprint 3 — Intégration Raspberry Pi</span>
      </footer>
    </div>
  )
}
