"""
TTS Engine — Sprint 2
Utilise edge-tts (voix neurale Microsoft, gratuit) pour générer l'audio
et extraire les événements de frontière de mot (word boundary) avec timing précis.
Fallback sur pyttsx3 si edge-tts indisponible.
"""

import asyncio
import base64
import io
import logging
import re
from dataclasses import dataclass
from typing import List, Optional

log = logging.getLogger(__name__)

# Mapping phonème simple : graphème → shape
GRAPHEME_TO_PHONEME = [
    (re.compile(r'[aàâä]', re.I), 'A'),
    (re.compile(r'[eéèêë]', re.I), 'E'),
    (re.compile(r'[iîï]',   re.I), 'I'),
    (re.compile(r'[oôö]',   re.I), 'O'),
    (re.compile(r'[uùûü]',  re.I), 'U'),
    (re.compile(r'[mn]',    re.I), 'M'),
    (re.compile(r'[fvw]',   re.I), 'F'),
    (re.compile(r'[sz]',    re.I), 'S'),
    (re.compile(r'th',      re.I), 'TH'),
    (re.compile(r'[bp]',    re.I), 'M'),
    (re.compile(r'[lr]',    re.I), 'E'),
]


@dataclass
class PhonemeEvent:
    time_ms: float       # quand bouger la bouche
    phoneme: str         # forme de la bouche
    duration_ms: float   # durée de la forme
    word: str = ''


def word_to_phonemes(word: str, start_ms: float, duration_ms: float) -> List[PhonemeEvent]:
    """Convertit un mot en séquence de phonèmes avec timing approximatif."""
    chars = [c for c in word if not c.isspace()]
    if not chars:
        return []

    per_char = duration_ms / max(len(chars), 1)
    events = []
    t = start_ms

    for ch in chars:
        shape = 'M'
        for pattern, ph in GRAPHEME_TO_PHONEME:
            if pattern.match(ch):
                shape = ph
                break
        events.append(PhonemeEvent(time_ms=t, phoneme=shape, duration_ms=per_char, word=word))
        t += per_char

    return events


class TTSEngine:
    def __init__(self):
        self._edge_available = False
        self._check_edge()

    def _check_edge(self):
        try:
            import edge_tts  # noqa
            self._edge_available = True
            log.info("edge-tts disponible")
        except ImportError:
            log.warning("edge-tts non installé — fallback pyttsx3")

    # ── Voix par langue ──────────────────────────────────────────────────────

    VOICES = {
        'fr-FR': 'fr-FR-DeniseNeural',
        'fr':    'fr-FR-DeniseNeural',
        'en-US': 'en-US-AriaNeural',
        'en':    'en-US-AriaNeural',
        'es-ES': 'es-ES-ElviraNeural',
        'es':    'es-ES-ElviraNeural',
    }

    def _voice(self, lang: str) -> str:
        return self.VOICES.get(lang, 'fr-FR-DeniseNeural')

    # ── Synthèse principale ──────────────────────────────────────────────────

    async def synthesize(self, text: str, lang: str = 'fr-FR') -> dict:
        """
        Retourne {audio_b64, mime, phoneme_events, duration_ms}.
        audio_b64 : MP3 encodé en base64 (prêt pour <audio src="data:...">).
        phoneme_events : liste de {time_ms, phoneme, duration_ms}.
        """
        if self._edge_available:
            return await self._synthesize_edge(text, lang)
        return await self._synthesize_fallback(text, lang)

    async def _synthesize_edge(self, text: str, lang: str) -> dict:
        import edge_tts

        voice = self._voice(lang)
        communicate = edge_tts.Communicate(text, voice, rate='-5%', pitch='-10Hz')

        audio_buf = io.BytesIO()
        word_boundaries = []   # [{word, offset_ms, duration_ms}]

        async for chunk in communicate.stream():
            if chunk['type'] == 'audio':
                audio_buf.write(chunk['data'])
            elif chunk['type'] == 'WordBoundary':
                # offset est en unités 100-nanosecondes
                offset_ms  = chunk['offset']  / 10_000
                dur_ms     = chunk['duration'] / 10_000
                word_boundaries.append({
                    'word':        chunk['text'],
                    'offset_ms':   offset_ms,
                    'duration_ms': dur_ms,
                })

        audio_bytes = audio_buf.getvalue()
        total_ms = word_boundaries[-1]['offset_ms'] + word_boundaries[-1]['duration_ms'] \
                   if word_boundaries else len(audio_bytes) / 16  # estimation brute

        phoneme_events = []
        for wb in word_boundaries:
            phoneme_events.extend(
                word_to_phonemes(wb['word'], wb['offset_ms'], wb['duration_ms'])
            )

        return {
            'audio_b64':      base64.b64encode(audio_bytes).decode(),
            'mime':           'audio/mpeg',
            'phoneme_events': [
                {'time_ms': e.time_ms, 'phoneme': e.phoneme, 'duration_ms': e.duration_ms}
                for e in phoneme_events
            ],
            'duration_ms':    total_ms,
            'word_boundaries': word_boundaries,
        }

    async def _synthesize_fallback(self, text: str, lang: str) -> dict:
        """Fallback sans audio réel — génère uniquement le timing estimé."""
        words = text.split()
        # ~150 mots/minute → ~400ms par mot
        ms_per_word = 400
        phoneme_events = []
        t = 0.0
        for word in words:
            clean = re.sub(r'[^\w]', '', word)
            if clean:
                phoneme_events.extend(word_to_phonemes(clean, t, ms_per_word))
            t += ms_per_word + 80  # pause entre mots

        return {
            'audio_b64':      '',
            'mime':           '',
            'phoneme_events': [
                {'time_ms': e.time_ms, 'phoneme': e.phoneme, 'duration_ms': e.duration_ms}
                for e in phoneme_events
            ],
            'duration_ms': t,
            'word_boundaries': [],
        }


# Singleton
engine = TTSEngine()
