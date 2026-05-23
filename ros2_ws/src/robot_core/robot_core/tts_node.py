"""
tts_node.py
-----------
Text-to-Speech node for the African Mask Balancing Robot.

Primary engine : Kokoro TTS (subprocess or HTTP service on port 8880)
Fallback engine: edge-tts (Microsoft Edge TTS, requires internet or local cache)

Topics subscribed
  /tts/text          (std_msgs/String) – text to synthesise

Topics published
  /tts/speaking      (std_msgs/Bool)   – True while audio is playing
  /tts/phoneme_events (std_msgs/String) – JSON array of phoneme timestamps

Parameters
  engine             – "kokoro" | "edge" | "auto"  (default "auto")
  kokoro_http_url    – if Kokoro runs as HTTP service, e.g. http://localhost:8880
  kokoro_voice       – Kokoro voice ID, default "af_bella"
  edge_voice         – edge-tts voice, default "en-US-AriaNeural"
  audio_device       – ALSA/pulse device, default "default"
  volume             – playback volume 0.0-1.0, default 0.85
  speed              – speech rate multiplier 0.5-2.0, default 1.0
"""

import asyncio
import io
import json
import os
import queue
import subprocess
import tempfile
import threading
import time
from typing import Optional

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy

from std_msgs.msg import String, Bool

RELIABLE_QOS = QoSProfile(
    reliability=ReliabilityPolicy.RELIABLE,
    history=HistoryPolicy.KEEP_LAST,
    depth=10,
)

# ---------------------------------------------------------------------------
# Audio playback helper (uses aplay / ffplay)
# ---------------------------------------------------------------------------
def _play_audio_file(path: str, volume: float = 0.85):
    """Block until audio file has finished playing."""
    # Try aplay first (ALSA), then ffplay, then paplay
    for cmd in [
        ['aplay', '-q', path],
        ['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet', path],
        ['paplay', path],
    ]:
        try:
            subprocess.run(cmd, check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
        except (FileNotFoundError, subprocess.CalledProcessError):
            continue
    # Last resort: python sounddevice
    try:
        import sounddevice as sd
        import soundfile as sf
        data, samplerate = sf.read(path)
        sd.play(data * volume, samplerate)
        sd.wait()
    except ImportError:
        pass


# ---------------------------------------------------------------------------
class TTSNode(Node):

    def __init__(self):
        super().__init__('tts_node')

        # ---- Parameters ----
        self.declare_parameter('engine',          'auto')
        self.declare_parameter('kokoro_http_url', 'http://localhost:8880')
        self.declare_parameter('kokoro_voice',    'af_bella')
        self.declare_parameter('edge_voice',      'en-US-AriaNeural')
        self.declare_parameter('audio_device',    'default')
        self.declare_parameter('volume',          0.85)
        self.declare_parameter('speed',           1.0)

        self._engine         = self.get_parameter('engine').value
        self._kokoro_url     = self.get_parameter('kokoro_http_url').value
        self._kokoro_voice   = self.get_parameter('kokoro_voice').value
        self._edge_voice     = self.get_parameter('edge_voice').value
        self._volume         = self.get_parameter('volume').value
        self._speed          = self.get_parameter('speed').value

        # ---- State ----
        self._speaking   = False
        self._tts_queue: queue.Queue[str] = queue.Queue()

        # Auto-detect engine
        if self._engine == 'auto':
            self._engine = self._detect_engine()
        self.get_logger().info(f'TTS engine: {self._engine}')

        # ---- Publishers ----
        self._speaking_pub  = self.create_publisher(Bool,   '/tts/speaking',       RELIABLE_QOS)
        self._phoneme_pub   = self.create_publisher(String, '/tts/phoneme_events', RELIABLE_QOS)

        # ---- Subscribers ----
        self.create_subscription(
            String, '/tts/text', self._tts_cb, RELIABLE_QOS)

        # Prosody hints from emotion node
        self._prosody: dict = {'rate': 1.0, 'pitch': 1.0, 'energy': 0.8}
        self.create_subscription(
            String, '/speech/prosody', self._prosody_cb, RELIABLE_QOS)

        # ---- Background synthesis / playback thread ----
        self._worker = threading.Thread(
            target=self._worker_loop, daemon=True, name='tts_worker')
        self._worker.start()

        self.get_logger().info('TTSNode started')

    # ------------------------------------------------------------------
    # Engine detection
    # ------------------------------------------------------------------
    def _detect_engine(self) -> str:
        # 1. Kokoro HTTP service
        try:
            import urllib.request
            urllib.request.urlopen(
                f'{self._kokoro_url}/health', timeout=1).read()
            return 'kokoro_http'
        except Exception:
            pass
        # 2. Kokoro Python package
        try:
            import kokoro  # noqa: F401
            return 'kokoro_py'
        except ImportError:
            pass
        # 3. edge-tts
        try:
            subprocess.run(['edge-tts', '--version'],
                           capture_output=True, check=True)
            return 'edge'
        except (FileNotFoundError, subprocess.CalledProcessError):
            pass
        self.get_logger().warn('No TTS engine found – TTS disabled')
        return 'none'

    # ------------------------------------------------------------------
    # Callbacks
    # ------------------------------------------------------------------
    def _tts_cb(self, msg: String):
        text = msg.data.strip()
        if text:
            self._tts_queue.put(text)

    def _prosody_cb(self, msg: String):
        try:
            self._prosody = json.loads(msg.data)
        except json.JSONDecodeError:
            pass

    # ------------------------------------------------------------------
    # Worker thread
    # ------------------------------------------------------------------
    def _worker_loop(self):
        while True:
            text = self._tts_queue.get()
            if text is None:
                break
            self._synthesise_and_play(text)

    def _synthesise_and_play(self, text: str):
        self._set_speaking(True)
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
            tmp_path = f.name
        try:
            synth_ok = False
            if self._engine == 'kokoro_http':
                synth_ok = self._synth_kokoro_http(text, tmp_path)
            elif self._engine == 'kokoro_py':
                synth_ok = self._synth_kokoro_py(text, tmp_path)
            elif self._engine == 'edge':
                synth_ok = self._synth_edge(text, tmp_path)

            if synth_ok and os.path.exists(tmp_path):
                # Emit simple phoneme event list (timing based on word count)
                self._publish_phoneme_events(text)
                _play_audio_file(tmp_path, self._volume)
        except Exception as exc:
            self.get_logger().error(f'TTS synthesis/playback error: {exc}')
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            self._set_speaking(False)

    # ------------------------------------------------------------------
    # Synthesis backends
    # ------------------------------------------------------------------
    def _synth_kokoro_http(self, text: str, out_path: str) -> bool:
        """POST to Kokoro HTTP service."""
        import urllib.request
        payload = json.dumps({
            'text':  text,
            'voice': self._kokoro_voice,
            'speed': self._speed * self._prosody.get('rate', 1.0),
        }).encode()
        req = urllib.request.Request(
            f'{self._kokoro_url}/tts',
            data=payload,
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                audio_data = resp.read()
            with open(out_path, 'wb') as f:
                f.write(audio_data)
            return True
        except Exception as exc:
            self.get_logger().error(f'Kokoro HTTP error: {exc}')
            return False

    def _synth_kokoro_py(self, text: str, out_path: str) -> bool:
        """Use installed kokoro Python package."""
        try:
            from kokoro import KPipeline  # type: ignore
            import soundfile as sf
            import numpy as np

            rate = self._speed * self._prosody.get('rate', 1.0)
            pipeline = KPipeline(lang_code='a')
            generator = pipeline(text, voice=self._kokoro_voice, speed=rate)
            audio_chunks = []
            for _, _, audio in generator:
                audio_chunks.append(audio)
            if audio_chunks:
                combined = np.concatenate(audio_chunks)
                sf.write(out_path, combined, 24000)
                return True
        except Exception as exc:
            self.get_logger().error(f'Kokoro py error: {exc}')
        return False

    def _synth_edge(self, text: str, out_path: str) -> bool:
        """Use edge-tts CLI (subprocess)."""
        rate_pct = int((self._speed * self._prosody.get('rate', 1.0) - 1.0) * 100)
        rate_str = f'{rate_pct:+d}%'
        cmd = [
            'edge-tts',
            '--voice', self._edge_voice,
            '--rate',  rate_str,
            '--text',  text,
            '--write-media', out_path,
        ]
        try:
            subprocess.run(cmd, check=True, timeout=30,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            # edge-tts outputs MP3 – rename and let aplay/ffplay handle it
            return True
        except Exception as exc:
            self.get_logger().error(f'edge-tts error: {exc}')
            return False

    # ------------------------------------------------------------------
    # Phoneme events (simplified word-level timing)
    # ------------------------------------------------------------------
    def _publish_phoneme_events(self, text: str):
        """
        Publish a JSON array of word-onset events with estimated timestamps.
        Real phoneme data requires Kokoro phoneme output; this is a reasonable
        approximation for driving mouth/eye animations.
        """
        words  = text.split()
        speed  = self._speed * self._prosody.get('rate', 1.0)
        events = []
        t = 0.0
        for word in words:
            # ~100 ms per syllable at normal speed, ~3 syllables per word avg
            syllables = max(1, len(word) // 3)
            duration  = (syllables * 0.12) / speed
            events.append({'word': word, 't': round(t, 3), 'dur': round(duration, 3)})
            t += duration + 0.05  # 50 ms gap between words

        msg = String()
        msg.data = json.dumps(events)
        self._phoneme_pub.publish(msg)

    # ------------------------------------------------------------------
    # Speaking state helper
    # ------------------------------------------------------------------
    def _set_speaking(self, state: bool):
        self._speaking = state
        msg = Bool()
        msg.data = state
        self._speaking_pub.publish(msg)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    def destroy_node(self):
        self._tts_queue.put(None)  # sentinel
        self._worker.join(timeout=2.0)
        super().destroy_node()


# ---------------------------------------------------------------------------
def main(args=None):
    rclpy.init(args=args)
    node = TTSNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
