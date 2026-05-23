'use client'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Maximize2, Minimize2, Settings } from 'lucide-react'
import FaceEngine from '../face/FaceEngine'
import useRobotStore from '../../store/robot'
import { EMOTIONS } from '../../lib/emotions'

export default function FacePanel() {
  const [fullscreen, setFullscreen] = useState(false)
  const {
    emotion, phoneme, lipSyncValue, isSpeaking,
    isListening, isThinking, simulatorMode,
  } = useRobotStore()

  const cfg = EMOTIONS[emotion] || EMOTIONS.neutral

  if (fullscreen) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 z-50 flex items-center justify-center cursor-pointer"
        style={{ background: '#050505' }}
        onClick={() => setFullscreen(false)}
      >
        <motion.div animate={{ scale: [1, 1.008, 1] }} transition={{ duration: 3.5, repeat: Infinity }}>
          <FaceEngine
            emotion={emotion}
            phoneme={phoneme}
            lipSyncValue={lipSyncValue}
            isSpeaking={isSpeaking}
            size={Math.min(window.innerWidth * 0.7, window.innerHeight * 0.85)}
          />
        </motion.div>
        <div className="absolute bottom-8 text-xs tracking-widest uppercase opacity-20"
          style={{ color: cfg.color }}>
          Cliquer pour réduire
        </div>
      </motion.div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Face */}
      <div
        className="relative face-canvas w-full flex items-center justify-center"
        style={{ minHeight: 380, borderRadius: 24 }}
      >
        <FaceEngine
          emotion={emotion}
          phoneme={phoneme}
          lipSyncValue={lipSyncValue}
          isSpeaking={isSpeaking}
          size={340}
        />

        {/* Bouton fullscreen */}
        <button
          onClick={() => setFullscreen(true)}
          className="absolute top-4 right-4 p-2 rounded-xl text-white/30 hover:text-white/70 transition-colors"
        >
          <Maximize2 size={14} />
        </button>

        {/* Badge mode */}
        {simulatorMode && (
          <div className="absolute top-4 left-4 px-2 py-1 rounded-lg text-xs font-medium"
            style={{ background: '#FF9F1C20', color: '#FF9F1C', border: '1px solid #FF9F1C30' }}>
            Simulation
          </div>
        )}
      </div>

      {/* État émotionnel */}
      <AnimatePresence mode="wait">
        <motion.div
          key={emotion}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          className="flex items-center gap-3"
        >
          <div className="flex items-center gap-2">
            {isSpeaking && (
              <motion.div
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 0.45, repeat: Infinity }}
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: cfg.color }}
              />
            )}
            <span
              className="text-xs font-medium uppercase tracking-widest"
              style={{ color: cfg.color + 'CC' }}
            >
              {cfg.label}
            </span>
            {isSpeaking && (
              <span className="text-xs text-surface-muted">— Parle</span>
            )}
            {isListening && !isSpeaking && (
              <span className="text-xs text-robot-blue">— Écoute</span>
            )}
            {isThinking && !isSpeaking && (
              <motion.span
                className="text-xs text-surface-muted"
                animate={{ opacity: [1, 0.4, 1] }}
                transition={{ duration: 1.2, repeat: Infinity }}
              >
                — Réflexion…
              </motion.span>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
