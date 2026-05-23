"""
stt_node.py
-----------
Speech-to-Text node using faster-whisper for fully local inference.
Microphone input via PyAudio with energy-based VAD.

Pipeline
  1. Continuously sample microphone in a background thread
  2. Energy VAD: accumulate audio while RMS energy > threshold
  3. On silence after speech: pass buffer to faster-whisper
  4. Publish transcription on /stt/result

Topics published
  /stt/result    (std_msgs/String) – transcribed text
  /stt/listening (std_msgs/Bool)   – True while recording live speech

Parameters
  model_size       – whisper model: tiny, base, small, medium (default "small")
  device           – "cpu" | "cuda" | "auto"  (default "cpu")
  compute_type     – "int8" | "float16" | "float32" (default "int8")
  sample_rate      – microphone sample rate Hz, default 16000
  chunk_ms         – audio chunk size in ms,     default 30
  energy_threshold – RMS energy threshold (0-32767), default 500
  silence_ms       – ms of silence to end utterance, default 800
  min_speech_ms    – minimum ms of speech to trigger recognition, default 300
  audio_device     – PyAudio device index, -1 = system default
  language         – Whisper language code, "" = auto-detect (default "en")
"""

import queue
import threading
import time
import audioop
import math
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
_PYAUDIO_AVAILABLE  = False
_WHISPER_AVAILABLE  = False

try:
    import pyaudio
    _PYAUDIO_AVAILABLE = True
except ImportError:
    pass

try:
    from faster_whisper import WhisperModel  # type: ignore
    _WHISPER_AVAILABLE = True
except ImportError:
    pass


class STTNode(Node):

    def __init__(self):
        super().__init__('stt_node')

        # ---- Parameters ----
        self.declare_parameter('model_size',       'small')
        self.declare_parameter('device',           'cpu')
        self.declare_parameter('compute_type',     'int8')
        self.declare_parameter('sample_rate',      16000)
        self.declare_parameter('chunk_ms',         30)
        self.declare_parameter('energy_threshold', 500)
        self.declare_parameter('silence_ms',       800)
        self.declare_parameter('min_speech_ms',    300)
        self.declare_parameter('audio_device',     -1)
        self.declare_parameter('language',         'en')

        self._model_size       = self.get_parameter('model_size').value
        self._device           = self.get_parameter('device').value
        self._compute_type     = self.get_parameter('compute_type').value
        self._sample_rate      = self.get_parameter('sample_rate').value
        self._chunk_ms         = self.get_parameter('chunk_ms').value
        self._energy_threshold = self.get_parameter('energy_threshold').value
        self._silence_ms       = self.get_parameter('silence_ms').value
        self._min_speech_ms    = self.get_parameter('min_speech_ms').value
        self._audio_device_idx = self.get_parameter('audio_device').value
        self._language         = self.get_parameter('language').value or None

        self._chunk_frames = int(self._sample_rate * self._chunk_ms / 1000)
        self._silence_chunks   = int(self._silence_ms  / self._chunk_ms)
        self._min_speech_chunks = int(self._min_speech_ms / self._chunk_ms)

        # ---- State ----
        self._listening   = False
        self._enabled     = True
        self._model: Optional[object] = None

        # Raw audio queue between mic thread and VAD thread
        self._audio_queue: queue.Queue[bytes] = queue.Queue(maxsize=500)
        # Transcription queue between VAD thread and ROS publish thread
        self._result_queue: queue.Queue[str] = queue.Queue()

        # ---- Publishers ----
        self._result_pub    = self.create_publisher(String, '/stt/result',    RELIABLE_QOS)
        self._listening_pub = self.create_publisher(Bool,   '/stt/listening', RELIABLE_QOS)

        # Pause STT while robot is talking (to avoid feedback)
        self.create_subscription(
            Bool, '/tts/speaking', self._tts_speaking_cb, RELIABLE_QOS)

        # ---- Load Whisper model ----
        if not _WHISPER_AVAILABLE:
            self.get_logger().error(
                'faster-whisper not installed. STT disabled.')
            return
        if not _PYAUDIO_AVAILABLE:
            self.get_logger().error('pyaudio not installed. STT disabled.')
            return

        # Load model in a thread to avoid blocking ROS spin
        threading.Thread(target=self._load_model, daemon=True).start()

    # ------------------------------------------------------------------
    # Model loading
    # ------------------------------------------------------------------
    def _load_model(self):
        self.get_logger().info(
            f'Loading Whisper model "{self._model_size}" on {self._device}…')
        try:
            self._model = WhisperModel(
                self._model_size,
                device=self._device,
                compute_type=self._compute_type,
            )
            self.get_logger().info('Whisper model loaded – starting mic')
            self._start_audio_pipeline()
        except Exception as exc:
            self.get_logger().error(f'Failed to load Whisper: {exc}')

    # ------------------------------------------------------------------
    # Audio pipeline startup
    # ------------------------------------------------------------------
    def _start_audio_pipeline(self):
        threading.Thread(
            target=self._mic_thread, daemon=True, name='stt_mic').start()
        threading.Thread(
            target=self._vad_thread, daemon=True, name='stt_vad').start()
        threading.Thread(
            target=self._publish_thread, daemon=True, name='stt_pub').start()

    # ------------------------------------------------------------------
    # Microphone capture thread
    # ------------------------------------------------------------------
    def _mic_thread(self):
        pa = pyaudio.PyAudio()
        device_idx = self._audio_device_idx if self._audio_device_idx >= 0 else None

        try:
            stream = pa.open(
                format=pyaudio.paInt16,
                channels=1,
                rate=self._sample_rate,
                input=True,
                input_device_index=device_idx,
                frames_per_buffer=self._chunk_frames,
            )
            self.get_logger().info(
                f'Mic open: rate={self._sample_rate} chunk={self._chunk_ms}ms')

            while True:
                try:
                    data = stream.read(self._chunk_frames, exception_on_overflow=False)
                    if self._enabled:
                        try:
                            self._audio_queue.put_nowait(data)
                        except queue.Full:
                            pass  # drop oldest if full
                except OSError as exc:
                    self.get_logger().warn(f'Mic read error: {exc}')
                    time.sleep(0.1)
        except Exception as exc:
            self.get_logger().error(f'Mic open failed: {exc}')
        finally:
            try:
                pa.terminate()
            except Exception:
                pass

    # ------------------------------------------------------------------
    # VAD + buffering thread
    # ------------------------------------------------------------------
    def _vad_thread(self):
        """
        Simple energy-based VAD:
        - Accumulate chunks while energy > threshold
        - After silence_chunks of quiet, send buffer to transcription
        """
        speech_buffer:  list[bytes] = []
        silence_count = 0
        in_speech     = False

        while True:
            try:
                chunk = self._audio_queue.get(timeout=0.5)
            except queue.Empty:
                continue

            # RMS energy
            rms = audioop.rms(chunk, 2)

            if rms > self._energy_threshold:
                speech_buffer.append(chunk)
                silence_count = 0
                if not in_speech:
                    in_speech = True
                    self._set_listening(True)
            else:
                if in_speech:
                    speech_buffer.append(chunk)  # pad trailing silence
                    silence_count += 1
                    if silence_count >= self._silence_chunks:
                        in_speech = False
                        self._set_listening(False)
                        if len(speech_buffer) >= self._min_speech_chunks:
                            audio_bytes = b''.join(speech_buffer)
                            threading.Thread(
                                target=self._transcribe,
                                args=(audio_bytes,),
                                daemon=True,
                            ).start()
                        speech_buffer  = []
                        silence_count  = 0

    # ------------------------------------------------------------------
    # Transcription (runs in executor thread to avoid blocking VAD)
    # ------------------------------------------------------------------
    def _transcribe(self, audio_bytes: bytes):
        import io
        import struct
        import wave

        # Write WAV to memory buffer
        buf = io.BytesIO()
        with wave.open(buf, 'wb') as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(self._sample_rate)
            wf.writeframes(audio_bytes)
        buf.seek(0)

        try:
            segments, info = self._model.transcribe(
                buf,
                language=self._language,
                beam_size=5,
                vad_filter=True,
                vad_parameters={'min_silence_duration_ms': 200},
            )
            text = ' '.join(seg.text.strip() for seg in segments).strip()
            if text:
                self.get_logger().info(f'STT: "{text}"')
                self._result_queue.put(text)
        except Exception as exc:
            self.get_logger().error(f'Transcription error: {exc}')

    # ------------------------------------------------------------------
    # Publish thread (keeps ROS publish on the main thread side)
    # ------------------------------------------------------------------
    def _publish_thread(self):
        while True:
            try:
                text = self._result_queue.get(timeout=1.0)
                msg  = String()
                msg.data = text
                self._result_pub.publish(msg)
            except queue.Empty:
                continue
            except Exception as exc:
                self.get_logger().error(f'STT publish error: {exc}')

    # ------------------------------------------------------------------
    # Listening state helper
    # ------------------------------------------------------------------
    def _set_listening(self, state: bool):
        self._listening = state
        msg = Bool()
        msg.data = state
        self._listening_pub.publish(msg)

    # ------------------------------------------------------------------
    # Callbacks
    # ------------------------------------------------------------------
    def _tts_speaking_cb(self, msg: Bool):
        """Mute microphone while TTS is playing to avoid self-feedback."""
        self._enabled = not msg.data
        if not self._enabled and self._listening:
            self._set_listening(False)


# ---------------------------------------------------------------------------
def main(args=None):
    rclpy.init(args=args)
    node = STTNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
