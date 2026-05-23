"""
ai_brain_node.py
----------------
AI brain for the African Mask Balancing Robot.

Receives transcribed speech, queries Ollama (local LLM), publishes
the response to TTS and drives the emotion state machine.

Topics subscribed
  /stt/result        (std_msgs/String) – transcribed utterance from STT
  /robot/emotion     (std_msgs/String) – current emotion (for context)
  /vision/faces      (std_msgs/String) – face-detection JSON (for context)

Topics published
  /tts/text          (std_msgs/String) – LLM reply text for TTS
  /ai/emotion_cmd    (std_msgs/String) – emotion to activate
  /ai/status         (std_msgs/String) – JSON {thinking, last_query, model}

Parameters
  ollama_url      – base URL of Ollama API, default http://localhost:11434
  model           – Ollama model name,      default llama3
  max_history     – max conversation turns to keep (user+assistant pairs)
  system_prompt   – override the built-in system prompt
  request_timeout – HTTP timeout in seconds, default 30
"""

import asyncio
import json
import threading
import time
from typing import Optional

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy

from std_msgs.msg import String

try:
    import aiohttp
    _AIOHTTP_AVAILABLE = True
except ImportError:
    _AIOHTTP_AVAILABLE = False

try:
    import urllib.request as _urllib_request
    import urllib.error as _urllib_error
    _URLLIB_AVAILABLE = True
except ImportError:
    _URLLIB_AVAILABLE = False

# ---------------------------------------------------------------------------
RELIABLE_QOS = QoSProfile(
    reliability=ReliabilityPolicy.RELIABLE,
    history=HistoryPolicy.KEEP_LAST,
    depth=10,
)
BEST_EFFORT_QOS = QoSProfile(
    reliability=ReliabilityPolicy.BEST_EFFORT,
    history=HistoryPolicy.KEEP_LAST,
    depth=1,
)

# ---------------------------------------------------------------------------
DEFAULT_SYSTEM_PROMPT = """You are the spirit of an African mask — ancient,\
 wise, and curious about the modern world. You balance on two wheels and\
 can move your arms expressively. You speak in short, vivid sentences\
 (1-3 sentences per response). At the END of your response, on its own\
 line, write EMOTION:<name> where <name> is one of: neutral, happy,\
 curious, listening, thinking, excited, sleepy, sad, alert.\
 Match the emotion to the tone of your reply."""

VALID_EMOTIONS = {
    'neutral', 'happy', 'curious', 'listening',
    'thinking', 'excited', 'sleepy', 'sad', 'alert',
}


# ---------------------------------------------------------------------------
class AIBrainNode(Node):

    def __init__(self):
        super().__init__('ai_brain_node')

        # ---- Parameters ----
        self.declare_parameter('ollama_url',      'http://localhost:11434')
        self.declare_parameter('model',           'llama3')
        self.declare_parameter('max_history',     10)
        self.declare_parameter('system_prompt',   DEFAULT_SYSTEM_PROMPT)
        self.declare_parameter('request_timeout', 30.0)

        self._ollama_url      = self.get_parameter('ollama_url').value
        self._model           = self.get_parameter('model').value
        self._max_history     = self.get_parameter('max_history').value
        self._system_prompt   = self.get_parameter('system_prompt').value
        self._request_timeout = self.get_parameter('request_timeout').value

        # ---- Conversation history ----
        # Each entry: {"role": "user"|"assistant", "content": "..."}
        self._history: list[dict] = []
        self._history_lock = threading.Lock()

        # ---- State ----
        self._thinking     = False
        self._last_query   = ''
        self._current_emotion = 'neutral'
        self._faces_count  = 0

        # Asyncio event loop running in a background thread
        self._loop = asyncio.new_event_loop()
        self._loop_thread = threading.Thread(
            target=self._run_loop, daemon=True, name='ai_async_loop')
        self._loop_thread.start()

        # ---- Publishers ----
        self._tts_pub     = self.create_publisher(String, '/tts/text',       RELIABLE_QOS)
        self._emotion_pub = self.create_publisher(String, '/ai/emotion_cmd', RELIABLE_QOS)
        self._status_pub  = self.create_publisher(String, '/ai/status',      RELIABLE_QOS)

        # ---- Subscribers ----
        self.create_subscription(
            String, '/stt/result',    self._stt_cb,     RELIABLE_QOS)
        self.create_subscription(
            String, '/robot/emotion', self._emotion_cb, BEST_EFFORT_QOS)
        self.create_subscription(
            String, '/vision/faces',  self._faces_cb,   BEST_EFFORT_QOS)

        # ---- Status timer: 1 Hz ----
        self.create_timer(1.0, self._publish_status)

        self.get_logger().info(
            f'AIBrainNode started – model={self._model} url={self._ollama_url}')

    # ------------------------------------------------------------------
    # Async event loop (background thread)
    # ------------------------------------------------------------------
    def _run_loop(self):
        asyncio.set_event_loop(self._loop)
        self._loop.run_forever()

    def _schedule(self, coro):
        """Schedule a coroutine on the background loop (thread-safe)."""
        asyncio.run_coroutine_threadsafe(coro, self._loop)

    # ------------------------------------------------------------------
    # Callbacks
    # ------------------------------------------------------------------
    def _stt_cb(self, msg: String):
        text = msg.data.strip()
        if not text:
            return
        if self._thinking:
            self.get_logger().warn('Already thinking – ignoring new input')
            return
        self.get_logger().info(f'STT: "{text}"')
        self._schedule(self._process_query(text))

    def _emotion_cb(self, msg: String):
        self._current_emotion = msg.data.strip()

    def _faces_cb(self, msg: String):
        try:
            data = json.loads(msg.data)
            self._faces_count = int(data.get('count', 0))
        except (json.JSONDecodeError, ValueError):
            pass

    # ------------------------------------------------------------------
    # Core async query pipeline
    # ------------------------------------------------------------------
    async def _process_query(self, user_text: str):
        self._thinking  = True
        self._last_query = user_text

        # Signal "thinking" emotion immediately
        self._publish_emotion('thinking')

        # Build messages list
        messages = self._build_messages(user_text)

        try:
            if _AIOHTTP_AVAILABLE:
                reply = await self._query_ollama_aiohttp(messages)
            else:
                reply = await asyncio.get_event_loop().run_in_executor(
                    None, self._query_ollama_urllib, messages)
        except Exception as exc:
            self.get_logger().error(f'Ollama error: {exc}')
            reply = 'My thoughts wander like smoke in the wind. Please try again.'

        # Parse out EMOTION tag
        clean_reply, emotion = self._extract_emotion(reply)

        # Update history
        with self._history_lock:
            self._history.append({'role': 'user',      'content': user_text})
            self._history.append({'role': 'assistant', 'content': clean_reply})
            # Trim: keep last max_history user+assistant pairs
            max_messages = self._max_history * 2
            if len(self._history) > max_messages:
                self._history = self._history[-max_messages:]

        # Publish reply to TTS
        tts_msg = String()
        tts_msg.data = clean_reply
        self._tts_pub.publish(tts_msg)

        # Publish emotion
        self._publish_emotion(emotion)

        self.get_logger().info(f'AI reply: "{clean_reply}" | emotion={emotion}')
        self._thinking = False

    # ------------------------------------------------------------------
    # Build Ollama messages array
    # ------------------------------------------------------------------
    def _build_messages(self, user_text: str) -> list[dict]:
        # Inject live context into the system prompt
        context_note = (
            f' [Context: current emotion={self._current_emotion}, '
            f'faces visible={self._faces_count}]'
        )
        system = self._system_prompt + context_note

        messages = [{'role': 'system', 'content': system}]
        with self._history_lock:
            messages.extend(self._history)
        messages.append({'role': 'user', 'content': user_text})
        return messages

    # ------------------------------------------------------------------
    # HTTP: aiohttp (preferred)
    # ------------------------------------------------------------------
    async def _query_ollama_aiohttp(self, messages: list[dict]) -> str:
        url     = f'{self._ollama_url}/api/chat'
        payload = {
            'model':    self._model,
            'messages': messages,
            'stream':   False,
            'options':  {'temperature': 0.75, 'top_p': 0.9},
        }
        timeout = aiohttp.ClientTimeout(total=self._request_timeout)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(url, json=payload) as resp:
                resp.raise_for_status()
                data = await resp.json()
        return data['message']['content']

    # ------------------------------------------------------------------
    # HTTP: urllib fallback (synchronous, run in executor)
    # ------------------------------------------------------------------
    def _query_ollama_urllib(self, messages: list[dict]) -> str:
        import urllib.request
        import urllib.error

        url     = f'{self._ollama_url}/api/chat'
        payload = json.dumps({
            'model':    self._model,
            'messages': messages,
            'stream':   False,
            'options':  {'temperature': 0.75, 'top_p': 0.9},
        }).encode()

        req = urllib.request.Request(
            url,
            data=payload,
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        with urllib.request.urlopen(req, timeout=self._request_timeout) as resp:
            data = json.loads(resp.read())
        return data['message']['content']

    # ------------------------------------------------------------------
    # Parse EMOTION tag from reply
    # ------------------------------------------------------------------
    @staticmethod
    def _extract_emotion(text: str) -> tuple[str, str]:
        """
        Look for a trailing line "EMOTION:<name>" and strip it.
        Returns (clean_text, emotion_name).
        """
        emotion = 'neutral'
        lines = text.strip().splitlines()
        clean_lines = []
        for line in lines:
            stripped = line.strip()
            if stripped.upper().startswith('EMOTION:'):
                candidate = stripped.split(':', 1)[1].strip().lower()
                if candidate in VALID_EMOTIONS:
                    emotion = candidate
                # Don't include this line in the TTS output
            else:
                clean_lines.append(line)
        clean_text = '\n'.join(clean_lines).strip()
        return clean_text, emotion

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _publish_emotion(self, emotion: str):
        msg = String()
        msg.data = emotion
        self._emotion_pub.publish(msg)

    def _publish_status(self):
        with self._history_lock:
            hist_len = len(self._history) // 2
        status = {
            'thinking':     self._thinking,
            'last_query':   self._last_query,
            'model':        self._model,
            'history_turns': hist_len,
            'emotion':      self._current_emotion,
        }
        msg = String()
        msg.data = json.dumps(status)
        self._status_pub.publish(msg)

    def clear_history(self):
        with self._history_lock:
            self._history.clear()
        self.get_logger().info('Conversation history cleared')

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    def destroy_node(self):
        self._loop.call_soon_threadsafe(self._loop.stop)
        self._loop_thread.join(timeout=2.0)
        super().destroy_node()


# ---------------------------------------------------------------------------
def main(args=None):
    rclpy.init(args=args)
    node = AIBrainNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
