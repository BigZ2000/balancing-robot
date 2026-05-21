import { useState, useRef, useCallback } from 'react'

// Map text phonemes roughly to mouth shapes
const TEXT_TO_PHONEME = [
  [/[aàâä]/gi, 'A'],
  [/[eéèêë]/gi, 'E'],
  [/[iîï]/gi, 'I'],
  [/[oôö]/gi, 'O'],
  [/[uùûü]/gi, 'U'],
  [/[mn]/gi,   'M'],
  [/[fs]/gi,   'F'],
  [/th/gi,     'TH'],
]

function textToPhonemes(text) {
  // Simplified: split text into words, generate phoneme sequence per character
  const sequence = []
  for (const char of text.toLowerCase()) {
    if (/\s/.test(char)) {
      sequence.push({ phoneme: 'rest', duration: 80 })
      continue
    }
    let matched = false
    for (const [re, ph] of TEXT_TO_PHONEME) {
      if (re.test(char)) {
        sequence.push({ phoneme: ph, duration: 110 })
        matched = true
        re.lastIndex = 0
        break
      }
    }
    if (!matched) sequence.push({ phoneme: 'M', duration: 80 })
  }
  return sequence
}

export function useLipSync() {
  const [phoneme, setPhoneme] = useState('rest')
  const [lipSyncValue, setLipSyncValue] = useState(0)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const timeoutRef = useRef(null)
  const utteranceRef = useRef(null)

  const stop = useCallback(() => {
    if (utteranceRef.current) window.speechSynthesis?.cancel()
    clearTimeout(timeoutRef.current)
    setPhoneme('rest')
    setLipSyncValue(0)
    setIsSpeaking(false)
  }, [])

  const speak = useCallback((text, lang = 'fr-FR', onEnd) => {
    stop()
    setIsSpeaking(true)

    const sequence = textToPhonemes(text)
    let idx = 0

    function nextPhoneme() {
      if (idx >= sequence.length) {
        setPhoneme('rest')
        setLipSyncValue(0)
        setIsSpeaking(false)
        onEnd?.()
        return
      }
      const { phoneme: ph, duration } = sequence[idx++]
      setPhoneme(ph)
      setLipSyncValue(ph === 'rest' ? 0 : 0.6 + Math.random() * 0.4)
      timeoutRef.current = setTimeout(nextPhoneme, duration)
    }

    // Use Web Speech API for actual audio
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = lang
      utterance.rate = 0.9
      utterance.pitch = 0.85
      utteranceRef.current = utterance
      utterance.onend = () => {
        setPhoneme('rest')
        setLipSyncValue(0)
        setIsSpeaking(false)
        onEnd?.()
      }
      window.speechSynthesis.speak(utterance)
    }

    // Animate mouth regardless
    nextPhoneme()
  }, [stop])

  return { phoneme, lipSyncValue, isSpeaking, speak, stop }
}
