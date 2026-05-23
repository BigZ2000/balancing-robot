"""
AI Engine — Sprint 4
Pipeline IA moderne : Faster-Whisper STT → Ollama LLM → Kokoro TTS
Chaque composant est optionnel avec fallback.
"""

import asyncio
import base64
import io
import json
import logging
import re
import subprocess
import tempfile
from pathlib import Path
from typing import AsyncGenerator

import httpx

log = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────

OLLAMA_URL    = "http://localhost:11434"
OLLAMA_MODEL  = "llama3.2:3b"   # léger, tourne sur Pi 5
KOKORO_URL    = "http://localhost:8880"  # si Kokoro tourne comme service

SYSTEM_PROMPT = """Tu es le robot africain Kwame, une IA incarnée dans un masque africain animé.
Tu es curieux, chaleureux, sage et légèrement espiègle.
Tu réponds TOUJOURS en moins de 2 phrases courtes.
Tu analyses ton état émotionnel et tu l'exprimes à travers ta façon de parler.
Format de réponse JSON : {"text": "...", "emotion": "neutral|happy|curious|listening|thinking|excited|sleepy|sad|alert"}"""

EMOTION_KEYWORDS = {
    'happy':    ['super','génial','parfait','bravo','joie','heureux','merci','excellent'],
    'sad':      ['triste','dommage','malheureusement','désolé','perdu'],
    'angry':    ['non','stop','jamais','inacceptable','assez'],
    'curious':  ['intéressant','vraiment','comment','pourquoi','quoi','?'],
    'excited':  ['incroyable','wow','fantastique','extraordinaire'],
    'thinking': ['laissez','analyser','réfléchis','hmm','voyons'],
    'alert':    ['attention','danger','alerte','urgent','problème'],
    'sleepy':   ['fatigué','sommeil','nuit','repos','dormir'],
    'listening':['je vous écoute','dites','oui','bien sûr'],
}


# ── STT : Faster-Whisper ──────────────────────────────────────────────────────

class WhisperSTT:
    def __init__(self, model_size: str = "small"):
        self._model = None
        self._model_size = model_size

    def _load(self):
        if self._model is not None:
            return
        try:
            from faster_whisper import WhisperModel
            self._model = WhisperModel(self._model_size, device="cpu", compute_type="int8")
            log.info("Faster-Whisper chargé : %s", self._model_size)
        except ImportError:
            log.warning("faster-whisper non installé")

    def transcribe(self, audio_path: str) -> str:
        self._load()
        if self._model is None:
            return ""
        segments, _ = self._model.transcribe(audio_path, language="fr")
        return " ".join(s.text.strip() for s in segments)


# ── LLM : Ollama ─────────────────────────────────────────────────────────────

class OllamaLLM:
    def __init__(self):
        self._history = []   # [{"role": "user"|"assistant", "content": "..."}]

    async def chat(self, user_text: str) -> dict:
        """
        Envoie le texte à Ollama, retourne {"text": ..., "emotion": ...}.
        """
        self._history.append({"role": "user", "content": user_text})

        payload = {
            "model":    OLLAMA_MODEL,
            "messages": [{"role": "system", "content": SYSTEM_PROMPT}] + self._history[-10:],
            "stream":   False,
            "format":   "json",
        }

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(f"{OLLAMA_URL}/api/chat", json=payload)
                resp.raise_for_status()
                content = resp.json()["message"]["content"]
                data    = json.loads(content)
                result  = {
                    "text":    data.get("text", content),
                    "emotion": data.get("emotion", "neutral"),
                }
        except Exception as e:
            log.error("Ollama error: %s", e)
            result = self._fallback(user_text)

        self._history.append({"role": "assistant", "content": result["text"]})
        return result

    def _fallback(self, text: str) -> dict:
        """Réponse locale si Ollama indisponible."""
        responses = [
            "Je réfléchis à votre question.",
            "Intéressant, continuez.",
            "Je suis là, je vous écoute.",
        ]
        import random
        return {"text": random.choice(responses), "emotion": "thinking"}

    def reset(self):
        self._history.clear()


# ── TTS : Kokoro → edge-tts fallback ─────────────────────────────────────────

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
]


def _word_phonemes(word: str, t0: float, duration: float) -> list:
    chars = [c for c in word if not c.isspace()]
    if not chars:
        return []
    per_char = duration / max(len(chars), 1)
    events, t = [], t0
    for ch in chars:
        ph = 'M'
        for pat, p in GRAPHEME_TO_PHONEME:
            if pat.match(ch):
                ph = p
                break
        events.append({"time_ms": t, "phoneme": ph, "duration_ms": per_char})
        t += per_char
    return events


class KokoroTTS:
    """
    Kokoro TTS via API HTTP (si kokoro-serve est lancé) ou via CLI.
    Fallback: edge-tts.
    """

    async def synthesize(self, text: str, lang: str = "fr-FR") -> dict:
        # Tentative Kokoro HTTP
        result = await self._try_kokoro_http(text)
        if result:
            return result

        # Tentative edge-tts
        result = await self._try_edge_tts(text, lang)
        if result:
            return result

        # Fallback sans audio
        return self._estimate_only(text)

    async def _try_kokoro_http(self, text: str) -> dict | None:
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                resp = await client.post(f"{KOKORO_URL}/v1/audio/speech", json={
                    "model":  "kokoro",
                    "input":  text,
                    "voice":  "af_bella",   # voix féminine naturelle
                    "speed":  0.92,
                    "response_format": "mp3",
                })
                if resp.status_code != 200:
                    return None
                audio_b64 = base64.b64encode(resp.content).decode()
                return {
                    "audio_b64":      audio_b64,
                    "mime":           "audio/mpeg",
                    "phoneme_events": self._estimate_phonemes(text),
                    "duration_ms":    len(resp.content) / 16.0,
                }
        except Exception:
            return None

    async def _try_edge_tts(self, text: str, lang: str) -> dict | None:
        try:
            import edge_tts
            voice_map = {
                "fr-FR": "fr-FR-DeniseNeural",
                "en-US": "en-US-AriaNeural",
            }
            voice = voice_map.get(lang, "fr-FR-DeniseNeural")
            communicate = edge_tts.Communicate(text, voice, rate="-5%", pitch="-10Hz")
            buf = io.BytesIO()
            word_boundaries = []
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    buf.write(chunk["data"])
                elif chunk["type"] == "WordBoundary":
                    word_boundaries.append({
                        "word":      chunk["text"],
                        "offset_ms": chunk["offset"] / 10_000,
                        "dur_ms":    chunk["duration"] / 10_000,
                    })
            audio = buf.getvalue()
            if not audio:
                return None
            phonemes = []
            for wb in word_boundaries:
                phonemes.extend(_word_phonemes(wb["word"], wb["offset_ms"], wb["dur_ms"]))
            total_ms = (word_boundaries[-1]["offset_ms"] + word_boundaries[-1]["dur_ms"]
                        if word_boundaries else len(audio) / 16.0)
            return {
                "audio_b64":      base64.b64encode(audio).decode(),
                "mime":           "audio/mpeg",
                "phoneme_events": phonemes,
                "duration_ms":    total_ms,
            }
        except Exception as e:
            log.warning("edge-tts failed: %s", e)
            return None

    def _estimate_phonemes(self, text: str) -> list:
        words = text.split()
        events, t = [], 0.0
        for w in words:
            events.extend(_word_phonemes(re.sub(r'[^\w]', '', w), t, 380))
            t += 380 + 80
        return events

    def _estimate_only(self, text: str) -> dict:
        return {
            "audio_b64":      "",
            "mime":           "",
            "phoneme_events": self._estimate_phonemes(text),
            "duration_ms":    len(text.split()) * 460.0,
        }


# ── Singletons ────────────────────────────────────────────────────────────────
stt = WhisperSTT(model_size="small")
llm = OllamaLLM()
tts = KokoroTTS()
