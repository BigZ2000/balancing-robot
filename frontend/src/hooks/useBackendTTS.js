import { useState, useRef, useCallback } from 'react'

const BACKEND = 'http://localhost:5000'

/**
 * Hook TTS backend — Sprint 2.
 * Appelle /api/tts, récupère audio MP3 + timing phonèmes précis.
 * Joue l'audio via Web Audio API et schedule les events de bouche.
 */
export function useBackendTTS({ onPhoneme, onEnd } = {}) {
  const [isSpeaking, setIsSpeaking]   = useState(false)
  const [isLoading,  setIsLoading]    = useState(false)
  const [error,      setError]        = useState(null)
  const audioRef    = useRef(null)
  const timersRef   = useRef([])

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
  }, [])

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    clearTimers()
    setIsSpeaking(false)
    onPhoneme?.('rest', 0)
  }, [clearTimers, onPhoneme])

  const speak = useCallback(async (text, lang = 'fr-FR', emotion = 'neutral') => {
    if (!text?.trim()) return
    stop()
    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch(`${BACKEND}/api/tts`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text, lang, emotion }),
      })
      if (!res.ok) throw new Error(`TTS error ${res.status}`)
      const data = await res.json()

      setIsLoading(false)
      setIsSpeaking(true)

      // Jouer l'audio si disponible
      if (data.audio_b64 && data.mime) {
        const src = `data:${data.mime};base64,${data.audio_b64}`
        const audio = new Audio(src)
        audioRef.current = audio
        audio.onended = () => {
          setIsSpeaking(false)
          onPhoneme?.('rest', 0)
          onEnd?.()
        }
        audio.play().catch(e => {
          // Autoplay bloqué → on simule quand même
          console.warn('Audio autoplay blocked:', e.message)
        })
      }

      // Scheduler les événements phonèmes avec timing précis
      const events = data.phoneme_events || []
      events.forEach(({ time_ms, phoneme, duration_ms }) => {
        const t = setTimeout(() => {
          onPhoneme?.(phoneme, duration_ms)
        }, time_ms)
        timersRef.current.push(t)
      })

      // Fin de la séquence
      const totalMs = data.duration_ms || events[events.length - 1]?.time_ms + 200 || 2000
      const endTimer = setTimeout(() => {
        if (!audioRef.current || audioRef.current.ended) {
          setIsSpeaking(false)
          onPhoneme?.('rest', 0)
          onEnd?.()
        }
      }, totalMs + 400)
      timersRef.current.push(endTimer)

    } catch (err) {
      setIsLoading(false)
      setError(err.message)
      setIsSpeaking(false)
      console.error('Backend TTS failed:', err)
    }
  }, [stop, onPhoneme, onEnd])

  return { speak, stop, isSpeaking, isLoading, error }
}
