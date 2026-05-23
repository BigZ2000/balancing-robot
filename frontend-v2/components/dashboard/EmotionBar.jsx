'use client'
import { motion } from 'framer-motion'
import { EMOTIONS, EMOTION_ORDER } from '../../lib/emotions'
import useRobotStore from '../../store/robot'
import { getRosBridge, TOPICS } from '../../lib/ros-bridge'

const EMOTION_ICONS = {
  neutral:   '◎',  happy:    '◉',  curious:  '◈',
  listening: '◐',  thinking: '◑',  excited:  '✦',
  sleepy:    '◌',  sad:      '◍',  alert:    '◆',
}

export default function EmotionBar() {
  const { emotion, setEmotion, simulatorMode } = useRobotStore()

  function handleEmotion(em) {
    setEmotion(em)
    if (!simulatorMode) {
      getRosBridge()?.publish(TOPICS.EMOTION, 'std_msgs/String', { data: em })
    }
  }

  return (
    <div className="bg-white rounded-3xl border border-surface-border p-5 shadow-card">
      <div className="text-xs font-semibold text-surface-muted uppercase tracking-widest mb-4">
        Émotions
      </div>

      <div className="flex flex-col gap-2">
        {EMOTION_ORDER.map(em => {
          const cfg    = EMOTIONS[em]
          const active = emotion === em

          return (
            <motion.button
              key={em}
              onClick={() => handleEmotion(em)}
              whileHover={{ x: 3 }}
              whileTap={{ scale: 0.97 }}
              className="flex items-center gap-3 px-3 py-2.5 rounded-2xl text-left transition-all w-full"
              style={{
                background: active ? `${cfg.color}12` : 'transparent',
                border:     `1.5px solid ${active ? cfg.color + '60' : 'transparent'}`,
              }}
            >
              <span
                className="text-base w-5 text-center leading-none"
                style={{ color: active ? cfg.color : '#C4BDB4' }}
              >
                {EMOTION_ICONS[em]}
              </span>
              <span
                className="text-sm font-medium"
                style={{ color: active ? cfg.color : '#6B6560' }}
              >
                {cfg.label}
              </span>
              {active && (
                <motion.div
                  layoutId="emotion-dot"
                  className="ml-auto w-1.5 h-1.5 rounded-full"
                  style={{ background: cfg.color }}
                />
              )}
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
