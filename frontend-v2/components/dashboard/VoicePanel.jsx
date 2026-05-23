'use client'
import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, MicOff, Volume2, VolumeX, Send, Square } from 'lucide-react'
import useRobotStore from '../../store/robot'
import { getRosBridge, TOPICS } from '../../lib/ros-bridge'
import { EMOTIONS } from '../../lib/emotions'

// Simulation lip-sync locale (sans backend)
const GRAPHEME_MAP = [
  [/[aàâ]/i,'A'],[/[eéèê]/i,'E'],[/[iî]/i,'I'],
  [/[oô]/i,'O'],[/[uù]/i,'U'],[/[mn]/i,'M'],
  [/[fv]/i,'F'],[/[sz]/i,'S'],
]
function textToPhonemes(text) {
  const out = []
  for (const ch of text.toLowerCase()) {
    if (/\s/.test(ch)) { out.push({ ph: 'rest', ms: 80 }); continue }
    let matched = false
    for (const [re, ph] of GRAPHEME_MAP) {
      if (re.test(ch)) { out.push({ ph, ms: 110 }); matched = true; break }
    }
    if (!matched) out.push({ ph: 'M', ms: 80 })
  }
  return out
}

function WaveBar({ delay }) {
  return (
    <motion.div
      className="w-0.5 rounded-full"
      style={{ height: 16, background: '#FF9F1C' }}
      animate={{ scaleY: [0.3, 1.8, 0.3] }}
      transition={{ duration: 0.5, repeat: Infinity, delay, ease: 'easeInOut' }}
    />
  )
}

export default function VoicePanel() {
  const {
    isSpeaking, isListening, micActive,
    userTranscript, robotResponse, conversationLog,
    emotion, simulatorMode,
    setPhoneme, setSpeaking, setEmotion,
  } = useRobotStore()

  const [inputText, setInputText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const timersRef = useState([])[0]

  // Simulation TTS locale
  const simulateSpeak = useCallback((text) => {
    setSpeaking(true)
    const phonemes = textToPhonemes(text)
    let t = 0
    phonemes.forEach(({ ph, ms }) => {
      const timer = setTimeout(() => {
        setPhoneme(ph, ph === 'rest' ? 0 : 0.6 + Math.random() * 0.4)
      }, t)
      timersRef.push(timer)
      t += ms
    })
    const endTimer = setTimeout(() => {
      setPhoneme('rest', 0)
      setSpeaking(false)
    }, t + 200)
    timersRef.push(endTimer)
  }, [])

  async function handleSpeak() {
    const text = inputText.trim()
    if (!text || isSpeaking) return
    setInputText('')

    if (simulatorMode) {
      setEmotion('speaking')
      simulateSpeak(text)
      useRobotStore.getState().addToLog({ role: 'user', text, emotion })
      setTimeout(() => {
        useRobotStore.getState().addToLog({
          role: 'assistant', text: `[Simulation] ${text}`, emotion: 'neutral',
        })
        setEmotion('neutral')
      }, textToPhonemes(text).reduce((a, p) => a + p.ms, 0) + 400)
      return
    }

    // Envoyer via ROS
    getRosBridge()?.publish(TOPICS.TTS_TEXT, 'std_msgs/String', { data: text })
    useRobotStore.getState().addToLog({ role: 'user', text, emotion })
  }

  function handleStop() {
    timersRef.forEach(clearTimeout)
    timersRef.length = 0
    setPhoneme('rest', 0)
    setSpeaking(false)
    setEmotion('neutral')
  }

  const emotionColor = EMOTIONS[emotion]?.color || '#FF9F1C'

  return (
    <div className="bg-white rounded-3xl border border-surface-border p-5 shadow-card flex flex-col gap-4 h-full">
      <div className="text-xs font-semibold text-surface-muted uppercase tracking-widest">
        Voix & Conversation
      </div>

      {/* Indicateur vocal */}
      <div className="flex items-center justify-center gap-2 py-3">
        <AnimatePresence mode="wait">
          {isSpeaking ? (
            <motion.div key="speaking" className="flex items-center gap-1.5"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            >
              {[0, 0.1, 0.2, 0.1, 0].map((d, i) => <WaveBar key={i} delay={d} />)}
              <span className="text-xs text-surface-muted ml-2">Parle…</span>
            </motion.div>
          ) : isListening ? (
            <motion.div key="listening" className="flex items-center gap-2"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            >
              <motion.div className="w-3 h-3 rounded-full bg-robot-red"
                animate={{ scale: [1, 1.3, 1] }} transition={{ duration: 0.6, repeat: Infinity }}
              />
              <span className="text-xs text-surface-muted">Écoute…</span>
            </motion.div>
          ) : (
            <motion.div key="idle" className="text-xs text-surface-muted"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            >
              En attente
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Log conversation */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 pr-1">
        <AnimatePresence>
          {conversationLog.slice(-8).map((entry, i) => (
            <motion.div
              key={`${entry.ts}-${i}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex flex-col gap-0.5 ${entry.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div
                className="max-w-[88%] px-3 py-2 rounded-2xl text-sm leading-relaxed"
                style={{
                  background: entry.role === 'user' ? '#F5F3EF' : `${emotionColor}12`,
                  color:      entry.role === 'user' ? '#3A3530' : '#1A1714',
                  border:     entry.role === 'assistant' ? `1px solid ${emotionColor}30` : 'none',
                }}
              >
                {entry.text}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {conversationLog.length === 0 && (
          <div className="text-xs text-center text-surface-muted py-6">
            Dites quelque chose ou tapez un texte
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex gap-2 pt-1">
        <textarea
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handleSpeak() }}
          placeholder="Texte à dire… (Ctrl+Entrée)"
          rows={2}
          className="flex-1 resize-none bg-surface-soft border border-surface-border rounded-2xl px-3 py-2.5
            text-sm text-robot-black placeholder:text-surface-muted outline-none
            focus:border-robot-amber/60 transition-colors"
        />
        <div className="flex flex-col gap-2">
          <motion.button
            onClick={handleSpeak}
            disabled={!inputText.trim() || isSpeaking}
            whileTap={{ scale: 0.93 }}
            className="p-2.5 rounded-xl transition-all disabled:opacity-40"
            style={{
              background: isSpeaking ? '#F5F3EF' : '#FF9F1C',
              color:      isSpeaking ? '#9E9890' : '#050505',
            }}
          >
            <Send size={14} />
          </motion.button>
          <button
            onClick={handleStop}
            className="p-2.5 rounded-xl bg-surface-soft border border-surface-border text-surface-muted transition-all hover:bg-red-50 hover:text-robot-red hover:border-red-200"
          >
            <Square size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
