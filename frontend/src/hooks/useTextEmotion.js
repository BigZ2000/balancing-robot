/**
 * Détection automatique d'émotion à partir du texte.
 * Analyse les mots-clés français et anglais, la ponctuation et l'intensité.
 */

const KEYWORD_MAP = {
  happy: {
    fr: ['bonjour','bonsoir','joie','heureux','heureuse','magnifique','super','excellent',
         'bravo','merci','amour','bien','parfait','formidable','génial','fantastique',
         'wouah','merveil','bonheur','sourire','fête','victoire','réussi','succès'],
    en: ['hello','joy','happy','wonderful','great','excellent','bravo','thank','love',
         'perfect','amazing','fantastic','wow','marvelous','success','celebrate'],
  },
  angry: {
    fr: ['attention','colère','non','jamais','stop','danger','rage','furieux',
         'furieuse','honte','scandale','inacceptable','assez','basta','maudit',
         'énervé','frustré','grogne','menace','interdit'],
    en: ['angry','rage','never','stop','danger','shame','unacceptable','enough',
         'furious','frustrated','threat','forbidden','hate'],
  },
  sad: {
    fr: ['triste','pleure','pleurons','perdu','mort','seul','seule','douleur',
         'regret','dommage','malheureusement','hélas','souffre','peine','larme',
         'chagrin','abandon','manque','loin','nostalgique'],
    en: ['sad','cry','lost','alone','pain','regret','unfortunately','alas','suffer',
         'sorrow','tear','miss','nostalgic','grief','mourn'],
  },
  surprised: {
    fr: ['incroyable','impossible','quoi','vraiment','sérieusement','oh','ah',
         'stupéfait','choqué','étonnant','inattendu','extraordinaire','ça alors',
         'jamais vu','impensable','révélation'],
    en: ['incredible','impossible','what','really','seriously','oh','wow',
         'shocked','amazing','unexpected','extraordinary','unbelievable','revelation'],
  },
}

// Règles de ponctuation / majuscules
const PUNCT_RULES = [
  { pattern: /!{2,}/,     boost: { angry: 0.4, surprised: 0.3 } },
  { pattern: /\?{2,}/,    boost: { surprised: 0.5 } },
  { pattern: /[A-ZÀÉÈÊ]{4,}/, boost: { angry: 0.3, surprised: 0.2 } },
  { pattern: /:\)|😊|😄|🎉/, boost: { happy: 0.5 } },
  { pattern: /:\(|😢|😭/,  boost: { sad: 0.5 } },
  { pattern: /😠|🤬|👿/,   boost: { angry: 0.5 } },
  { pattern: /😲|😮|🤩/,   boost: { surprised: 0.5 } },
]

function scoreText(text) {
  const lower = text.toLowerCase()
  const words = lower.match(/\b\w+\b/g) || []
  const scores = { happy: 0, angry: 0, sad: 0, surprised: 0 }

  for (const [emotion, { fr, en }] of Object.entries(KEYWORD_MAP)) {
    const keywords = [...fr, ...en]
    for (const w of words) {
      if (keywords.some(k => w.includes(k) || k.includes(w))) {
        scores[emotion] += 1
      }
    }
  }

  // Boost ponctuation
  for (const { pattern, boost } of PUNCT_RULES) {
    if (pattern.test(text)) {
      for (const [em, v] of Object.entries(boost)) {
        scores[em] = (scores[em] || 0) + v
      }
    }
  }

  return scores
}

/**
 * Retourne l'émotion dominante et le score de confiance (0–1).
 * Si aucun mot-clé trouvé, retourne null (émotion inchangée).
 */
export function detectEmotion(text) {
  if (!text || text.trim().length < 3) return { emotion: null, confidence: 0 }
  const scores = scoreText(text)
  const total  = Object.values(scores).reduce((a, b) => a + b, 0)
  if (total < 0.3) return { emotion: null, confidence: 0 }

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]
  return {
    emotion:    best[1] > 0 ? best[0] : null,
    confidence: Math.min(1, best[1] / Math.max(total, 1)),
    scores,
  }
}

/** Hook React : met à jour l'émotion suggérée à chaque changement de texte. */
import { useState, useEffect } from 'react'

export function useTextEmotion(text, enabled = true) {
  const [suggested, setSuggested] = useState(null)
  const [confidence, setConfidence] = useState(0)

  useEffect(() => {
    if (!enabled || !text) { setSuggested(null); return }
    const { emotion, confidence: c } = detectEmotion(text)
    setSuggested(emotion)
    setConfidence(c)
  }, [text, enabled])

  return { suggested, confidence }
}
