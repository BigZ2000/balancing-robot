'use client'
/**
 * Face Simulator — test le visage sans robot physique.
 * Permet de tester émotions, TTS, lip-sync, phonèmes.
 */

import { useState, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Play, Square, Zap } from 'lucide-react'
import useRobotStore from '../../store/robot'
import { EMOTION_ORDER, EMOTIONS } from '../../lib/emotions'

const PHONEME_LIST = ['rest','A','E','I','O','U','M','F','S','TH']

const QUICK_DEMOS = [
  { label: 'Bonjour !',     text: 'Bonjour ! Je suis votre compagnon robot.', emotion: 'happy' },
  { label: 'Curiosité',     text: "Qu'est-ce que c'est ? Intéressant !", emotion: 'curious' },
  { label: 'Réflexion',     text: 'Laissez-moi analyser cette situation…', emotion: 'thinking' },
  { label: 'Alerte',        text: 'Attention ! Obstacle détecté.', emotion: 'alert' },
  { label: 'Bonne nuit',    text: 'Je suis fatigué. Bonne nuit.', emotion: 'sleepy' },
]

const GRAPHEME_MAP = [
  [/[aàâ]/i,'A'],[/[eéèê]/i,'E'],[/[iî]/i,'I'],
  [/[oô]/i,'O'],[/[uù]/i,'U'],[/[mn]/i,'M'],[/[fv]/i,'F'],[/[sz]/i,'S'],
]
function textToPhonemes(text) {
  return [...text.toLowerCase()].map(ch => {
    if (/\s/.test(ch)) return { ph: 'rest', ms: 80 }
    for (const [re, ph] of GRAPHEME_MAP) if (re.test(ch)) return { ph, ms: 110 }
    return { ph: 'M', ms: 80 }
  })
}

export default function SimulatorPanel() {
  const [open, setOpen] = useState(false)
  const timerRefs = useRef([])

  const {
    setEmotion, setPhoneme, setSpeaking, emotion,
  } = useRobotStore()

  function clearTimers() {
    timerRefs.current.forEach(clearTimeout)
    timerRefs.current = []
    setPhoneme('rest', 0)
    setSpeaking(false)
  }

  function simulateSpeak(text, em) {
    clearTimers()
    if (em) setEmotion(em)
    setSpeaking(true)
    const phonemes = textToPhonemes(text)
    let t = 0
    phonemes.forEach(({ ph, ms }) => {
      timerRefs.current.push(setTimeout(() => {
        setPhoneme(ph, ph === 'rest' ? 0 : 0.55 + Math.random() * 0.45)
      }, t))
      t += ms
    })
    timerRefs.current.push(setTimeout(() => {
      setPhoneme('rest', 0)
      setSpeaking(false)
      if (em) setTimeout(() => setEmotion('neutral'), 800)
    }, t + 300))
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-medium
          bg-white border border-surface-border shadow-card text-surface-muted
          hover:border-robot-amber/40 hover:text-robot-amber transition-all"
      >
        <Zap size={12} />
        Simulateur
      </button>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-3xl border border-surface-border shadow-card p-5 flex flex-col gap-5"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap size={13} className="text-robot-amber" />
          <span className="text-xs font-semibold text-robot-black">Simulateur Visage</span>
        </div>
        <button onClick={() => setOpen(false)}
          className="text-xs text-surface-muted hover:text-robot-black transition-colors">
          Fermer
        </button>
      </div>

      {/* Démos rapides */}
      <div className="flex flex-col gap-2">
        <div className="text-xs text-surface-muted mb-1">Scénarios rapides</div>
        <div className="flex flex-wrap gap-2">
          {QUICK_DEMOS.map(demo => (
            <button
              key={demo.label}
              onClick={() => simulateSpeak(demo.text, demo.emotion)}
              className="px-3 py-1.5 rounded-xl text-xs font-medium bg-surface-soft border border-surface-border
                text-surface-muted hover:border-robot-amber/50 hover:text-robot-amber transition-all"
            >
              {demo.label}
            </button>
          ))}
        </div>
      </div>

      {/* Phonèmes manuels */}
      <div>
        <div className="text-xs text-surface-muted mb-2">Phonèmes</div>
        <div className="flex flex-wrap gap-1.5">
          {PHONEME_LIST.map(ph => (
            <button
              key={ph}
              onMouseDown={() => setPhoneme(ph, ph === 'rest' ? 0 : 0.8)}
              onMouseUp={() => setPhoneme('rest', 0)}
              className="w-10 h-9 rounded-xl text-xs font-mono font-semibold bg-surface-soft
                border border-surface-border text-surface-muted hover:border-robot-amber/50
                hover:text-robot-amber transition-all active:scale-95"
            >
              {ph}
            </button>
          ))}
        </div>
      </div>

      {/* Émotions directes */}
      <div>
        <div className="text-xs text-surface-muted mb-2">Émotions</div>
        <div className="flex flex-wrap gap-1.5">
          {EMOTION_ORDER.map(em => {
            const cfg = EMOTIONS[em]
            return (
              <button
                key={em}
                onClick={() => setEmotion(em)}
                className="px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all"
                style={{
                  background: emotion === em ? `${cfg.color}15` : 'transparent',
                  border:     `1px solid ${emotion === em ? cfg.color + '50' : '#E8E4DC'}`,
                  color:      emotion === em ? cfg.color : '#9E9890',
                }}
              >
                {cfg.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Stop */}
      <button
        onClick={clearTimers}
        className="flex items-center justify-center gap-2 py-2 rounded-2xl text-xs font-medium
          bg-red-50 border border-red-100 text-robot-red hover:bg-red-100 transition-all"
      >
        <Square size={12} />
        Arrêter
      </button>
    </motion.div>
  )
}
