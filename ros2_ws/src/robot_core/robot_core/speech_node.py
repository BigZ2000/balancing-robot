"""
speech_node.py
--------------
High-level speech coordinator.  Bridges the gap between the AI brain,
TTS, and prosody/emotion system.

Responsibilities
  - Queues TTS requests so they play sequentially (no interrupts mid-sentence)
  - Applies prosody hints from /speech/prosody before forwarding to /tts/text
  - Exposes /speech/say for direct speech from other nodes (bypasses AI)
  - Tracks whether speech is currently active via /tts/speaking

Topics subscribed
  /ai/speech          (std_msgs/String) – text from AI brain
  /speech/say         (std_msgs/String) – direct speech request
  /speech/prosody     (std_msgs/String) – JSON prosody override {rate, pitch}
  /tts/speaking       (std_msgs/Bool)   – current TTS play state

Topics published
  /tts/text           (std_msgs/String) – text forwarded to TTS node
  /speech/status      (std_msgs/String) – JSON {speaking, queue_len}
"""

import json
import queue
import threading

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy

from std_msgs.msg import String, Bool

RELIABLE_QOS = QoSProfile(
    reliability=ReliabilityPolicy.RELIABLE,
    history=HistoryPolicy.KEEP_LAST,
    depth=10,
)


class SpeechNode(Node):

    def __init__(self):
        super().__init__('speech_node')

        self._speaking  = False
        self._prosody   = {'rate': 1.0, 'pitch': 1.0}
        self._speech_q: queue.Queue[str] = queue.Queue(maxsize=5)

        # ---- Publishers ----
        self._tts_pub    = self.create_publisher(String, '/tts/text',      RELIABLE_QOS)
        self._status_pub = self.create_publisher(String, '/speech/status', RELIABLE_QOS)

        # ---- Subscribers ----
        self.create_subscription(String, '/ai/speech',      self._ai_speech_cb,  RELIABLE_QOS)
        self.create_subscription(String, '/speech/say',     self._say_cb,        RELIABLE_QOS)
        self.create_subscription(String, '/speech/prosody', self._prosody_cb,    RELIABLE_QOS)
        self.create_subscription(Bool,   '/tts/speaking',   self._speaking_cb,   RELIABLE_QOS)

        # ---- Status timer ----
        self.create_timer(1.0, self._publish_status)

        # ---- Queue drain thread ----
        self._drain = threading.Thread(
            target=self._drain_loop, daemon=True, name='speech_drain')
        self._drain.start()

        self.get_logger().info('SpeechNode started')

    # ------------------------------------------------------------------
    def _ai_speech_cb(self, msg: String):
        self._enqueue(msg.data)

    def _say_cb(self, msg: String):
        self._enqueue(msg.data, priority=True)

    def _prosody_cb(self, msg: String):
        try:
            self._prosody = json.loads(msg.data)
        except json.JSONDecodeError:
            pass

    def _speaking_cb(self, msg: Bool):
        self._speaking = msg.data

    # ------------------------------------------------------------------
    def _enqueue(self, text: str, priority: bool = False):
        text = text.strip()
        if not text:
            return
        try:
            if priority:
                # Put at front: rebuild queue with this item first
                items = [text]
                while not self._speech_q.empty():
                    try:
                        items.append(self._speech_q.get_nowait())
                    except queue.Empty:
                        break
                for item in items:
                    try:
                        self._speech_q.put_nowait(item)
                    except queue.Full:
                        break
            else:
                self._speech_q.put_nowait(text)
        except queue.Full:
            self.get_logger().warn('Speech queue full — dropping utterance')

    def _drain_loop(self):
        """Send queued text to TTS, waiting until each finishes."""
        import time
        while True:
            try:
                text = self._speech_q.get(timeout=1.0)
            except queue.Empty:
                continue

            msg = String()
            msg.data = text
            self._tts_pub.publish(msg)

            # Wait for TTS to signal it started, then wait for completion
            time.sleep(0.3)
            deadline = time.monotonic() + 30.0
            while self._speaking and time.monotonic() < deadline:
                time.sleep(0.1)

    def _publish_status(self):
        status = {
            'speaking':   self._speaking,
            'queue_len':  self._speech_q.qsize(),
            'prosody':    self._prosody,
        }
        msg = String()
        msg.data = json.dumps(status)
        self._status_pub.publish(msg)


def main(args=None):
    rclpy.init(args=args)
    node = SpeechNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
