"""
emotion_node.py
---------------
Central emotion state machine for the African Mask Balancing Robot.

Nine emotions: neutral, happy, curious, listening, thinking, excited,
sleepy, sad, alert

The node coordinates:
  - Face expression via /face/expression (String)
  - Arm gesture via  /arm/gesture       (String)
  - Speech prosody hint via /speech/prosody (String JSON)

Topics subscribed
  /ai/emotion_cmd     (std_msgs/String)  – emotion name, optionally JSON
  /stt/listening      (std_msgs/Bool)    – auto → "listening" emotion
  /robot/balance_status (std_msgs/String) – watch for fault → "alert"

Topics published
  /robot/emotion      (std_msgs/String)  – current emotion name
  /face/expression    (std_msgs/String)  – forwarded to face_node
  /arm/gesture        (std_msgs/String)  – forwarded to arm_node
  /speech/prosody     (std_msgs/String)  – JSON prosody hint for TTS

Parameters
  transition_delay_s  – minimum seconds between emotion changes, default 0.8
"""

import json
import time

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy

from std_msgs.msg import String, Bool

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
# Emotion definitions
# ---------------------------------------------------------------------------
#   face        : expression name sent to face_node
#   arm         : gesture sent to arm_node
#   prosody     : TTS prosody hint (rate, pitch)  – JSON-serialisable dict
#   idle_return : auto-return to neutral after N seconds (0 = stay)
# ---------------------------------------------------------------------------
EMOTIONS: dict[str, dict] = {
    'neutral': {
        'face':        'neutral',
        'arm':         'rest',
        'prosody':     {'rate': 1.0,  'pitch': 1.0,  'energy': 0.7},
        'idle_return': 0,
    },
    'happy': {
        'face':        'happy',
        'arm':         'wave',
        'prosody':     {'rate': 1.1,  'pitch': 1.15, 'energy': 0.9},
        'idle_return': 12,
    },
    'curious': {
        'face':        'curious',
        'arm':         'nod',
        'prosody':     {'rate': 1.05, 'pitch': 1.05, 'energy': 0.75},
        'idle_return': 0,
    },
    'listening': {
        'face':        'listening',
        'arm':         'neutral',
        'prosody':     {'rate': 0.95, 'pitch': 0.95, 'energy': 0.6},
        'idle_return': 0,
    },
    'thinking': {
        'face':        'thinking',
        'arm':         'shrug',
        'prosody':     {'rate': 0.9,  'pitch': 0.9,  'energy': 0.65},
        'idle_return': 30,
    },
    'excited': {
        'face':        'excited',
        'arm':         'excited',
        'prosody':     {'rate': 1.2,  'pitch': 1.25, 'energy': 1.0},
        'idle_return': 8,
    },
    'sleepy': {
        'face':        'sleepy',
        'arm':         'rest',
        'prosody':     {'rate': 0.8,  'pitch': 0.85, 'energy': 0.5},
        'idle_return': 0,
    },
    'sad': {
        'face':        'sad',
        'arm':         'rest',
        'prosody':     {'rate': 0.85, 'pitch': 0.82, 'energy': 0.55},
        'idle_return': 20,
    },
    'alert': {
        'face':        'alert',
        'arm':         'point',
        'prosody':     {'rate': 1.15, 'pitch': 1.1,  'energy': 0.95},
        'idle_return': 5,
    },
}

VALID_EMOTIONS = set(EMOTIONS.keys())


class EmotionNode(Node):

    def __init__(self):
        super().__init__('emotion_node')

        # ---- Parameters ----
        self.declare_parameter('transition_delay_s', 0.8)
        self._transition_delay = self.get_parameter('transition_delay_s').value

        # ---- State ----
        self._emotion          = 'neutral'
        self._previous_emotion = 'neutral'
        self._last_change_t    = 0.0
        self._idle_deadline    = 0.0   # 0 means no auto-return
        self._stt_listening    = False
        self._balance_faulted  = False

        # ---- Publishers ----
        self._emotion_pub  = self.create_publisher(String, '/robot/emotion',   RELIABLE_QOS)
        self._face_pub     = self.create_publisher(String, '/face/expression', RELIABLE_QOS)
        self._arm_pub      = self.create_publisher(String, '/arm/gesture',     RELIABLE_QOS)
        self._prosody_pub  = self.create_publisher(String, '/speech/prosody',  RELIABLE_QOS)

        # ---- Subscribers ----
        self.create_subscription(
            String, '/ai/emotion_cmd', self._emotion_cmd_cb, RELIABLE_QOS)
        self.create_subscription(
            Bool, '/stt/listening', self._stt_listening_cb, BEST_EFFORT_QOS)
        self.create_subscription(
            String, '/robot/balance_status', self._balance_status_cb, BEST_EFFORT_QOS)

        # ---- Timers ----
        # 2 Hz housekeeping (idle-return, keep-alive publish)
        self.create_timer(0.5, self._housekeeping)

        # Boot: broadcast initial state
        self.create_timer(1.0, self._boot_broadcast)
        self._boot_done = False

        self.get_logger().info('EmotionNode started – state=neutral')

    # ------------------------------------------------------------------
    # Public transition API
    # ------------------------------------------------------------------
    def transition_to(self, emotion: str, force: bool = False) -> bool:
        """
        Request a state transition.  Returns True if the transition was
        accepted (False if rate-limited or already in that state).
        """
        emotion = emotion.strip().lower()
        if emotion not in VALID_EMOTIONS:
            self.get_logger().warn(f'Unknown emotion: "{emotion}"')
            return False
        if emotion == self._emotion:
            return False

        now = time.monotonic()
        if not force and (now - self._last_change_t) < self._transition_delay:
            return False

        self._previous_emotion = self._emotion
        self._emotion          = emotion
        self._last_change_t    = now

        # Set idle-return deadline
        idle_s = EMOTIONS[emotion]['idle_return']
        self._idle_deadline = (now + idle_s) if idle_s > 0 else 0.0

        self.get_logger().info(
            f'Emotion: {self._previous_emotion} → {self._emotion}')
        self._broadcast_emotion()
        return True

    # ------------------------------------------------------------------
    # Callbacks
    # ------------------------------------------------------------------
    def _emotion_cmd_cb(self, msg: String):
        """
        Accept either a bare emotion name ("happy") or JSON
        {"emotion":"happy", "force":false}.
        """
        text = msg.data.strip()
        try:
            data = json.loads(text)
            emotion = data.get('emotion', '').lower()
            force   = bool(data.get('force', False))
        except (json.JSONDecodeError, AttributeError):
            emotion = text.lower()
            force   = False
        self.transition_to(emotion, force=force)

    def _stt_listening_cb(self, msg: Bool):
        if msg.data and not self._stt_listening:
            self._stt_listening = True
            self.transition_to('listening', force=True)
        elif not msg.data and self._stt_listening:
            self._stt_listening = False
            if self._emotion == 'listening':
                self.transition_to('neutral')

    def _balance_status_cb(self, msg: String):
        try:
            data = json.loads(msg.data)
            faulted = bool(data.get('fault', False))
        except json.JSONDecodeError:
            return

        if faulted and not self._balance_faulted:
            self._balance_faulted = True
            self.transition_to('alert', force=True)
        elif not faulted and self._balance_faulted:
            self._balance_faulted = False
            if self._emotion == 'alert':
                self.transition_to('neutral', force=True)

    # ------------------------------------------------------------------
    # Housekeeping timer (2 Hz)
    # ------------------------------------------------------------------
    def _housekeeping(self):
        # Idle-return to neutral
        now = time.monotonic()
        if (self._idle_deadline > 0
                and now >= self._idle_deadline
                and not self._balance_faulted
                and not self._stt_listening):
            self._idle_deadline = 0.0
            self.transition_to('neutral')

    # ------------------------------------------------------------------
    # Boot broadcast (one-shot, 1 s after start)
    # ------------------------------------------------------------------
    def _boot_broadcast(self):
        if not self._boot_done:
            self._boot_done = True
            self._broadcast_emotion()

    # ------------------------------------------------------------------
    # Publish all emotion-related outputs
    # ------------------------------------------------------------------
    def _broadcast_emotion(self):
        defn = EMOTIONS[self._emotion]

        # /robot/emotion
        e_msg = String()
        e_msg.data = self._emotion
        self._emotion_pub.publish(e_msg)

        # /face/expression
        f_msg = String()
        f_msg.data = defn['face']
        self._face_pub.publish(f_msg)

        # /arm/gesture
        a_msg = String()
        a_msg.data = defn['arm']
        self._arm_pub.publish(a_msg)

        # /speech/prosody
        p_msg = String()
        p_msg.data = json.dumps(defn['prosody'])
        self._prosody_pub.publish(p_msg)


# ---------------------------------------------------------------------------
def main(args=None):
    rclpy.init(args=args)
    node = EmotionNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
