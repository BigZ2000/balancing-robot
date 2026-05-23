"""
arm_node.py
-----------
Controls the 60 kg·cm servo arm through slow, expressive lerped movements.

The servo is driven by the Teensy (JSON cmd:"arm", pos:-100…+100 which maps
to 500–2500 µs pulse width via the Servo library).

Topics subscribed
  /arm_cmd        (std_msgs/Float32)   – target position -100 … +100
  /arm/gesture    (std_msgs/String)    – named gesture, e.g. "wave", "greet"

Topics published
  /arm/status     (std_msgs/String)    – JSON {pos, target, moving, gesture}
  /teensy/arm_raw (std_msgs/Float32)   – position forwarded to serial_bridge

Parameters
  lerp_rate       – fraction to move per 50 ms tick (0.0–1.0), default 0.12
  speed_scale     – overall speed multiplier, default 1.0
"""

import json
import math

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy

from std_msgs.msg import String, Float32

# ---------------------------------------------------------------------------
RELIABLE_QOS = QoSProfile(
    reliability=ReliabilityPolicy.RELIABLE,
    history=HistoryPolicy.KEEP_LAST,
    depth=10,
)

# Named gesture definitions: list of (position, hold_ticks) tuples
# position is -100…+100; hold_ticks at 20 Hz
GESTURES: dict[str, list[tuple[float, int]]] = {
    'neutral': [(0.0, 10)],
    'wave':    [(60.0, 5), (-60.0, 5), (60.0, 5), (-60.0, 5), (0.0, 8)],
    'greet':   [(80.0, 15), (0.0, 10)],
    'shrug':   [(40.0, 8), (-40.0, 8), (0.0, 6)],
    'nod':     [(30.0, 6), (-30.0, 6), (0.0, 4)],
    'excited': [(90.0, 4), (-90.0, 4), (90.0, 4), (-90.0, 4), (0.0, 8)],
    'point':   [(100.0, 20), (0.0, 10)],
    'rest':    [(-100.0, 20)],
}


class ArmNode(Node):

    def __init__(self):
        super().__init__('arm_node')

        # ---- Parameters ----
        self.declare_parameter('lerp_rate',   0.12)
        self.declare_parameter('speed_scale', 1.0)

        self._lerp_rate   = self.get_parameter('lerp_rate').value
        self._speed_scale = self.get_parameter('speed_scale').value

        # ---- Arm state ----
        self._current_pos = 0.0      # actual (smoothed) position
        self._target_pos  = 0.0      # commanded position
        self._moving      = False
        self._current_gesture = 'neutral'

        # Gesture playback state
        self._gesture_queue: list[tuple[float, int]] = []
        self._gesture_hold_remaining = 0

        # ---- Publishers ----
        self._status_pub = self.create_publisher(
            String, '/arm/status', RELIABLE_QOS)
        self._raw_pub = self.create_publisher(
            Float32, '/teensy/arm_raw', RELIABLE_QOS)

        # ---- Subscribers ----
        self.create_subscription(
            Float32, '/arm_cmd', self._arm_cmd_cb, RELIABLE_QOS)
        self.create_subscription(
            String, '/arm/gesture', self._gesture_cb, RELIABLE_QOS)

        # ---- Timer: 20 Hz update loop ----
        self.create_timer(0.05, self._update)

        self.get_logger().info('ArmNode started')

    # ------------------------------------------------------------------
    # Callbacks
    # ------------------------------------------------------------------
    def _arm_cmd_cb(self, msg: Float32):
        """Direct position command – clears any active gesture."""
        pos = max(-100.0, min(100.0, float(msg.data)))
        self._target_pos = pos
        self._gesture_queue = []
        self._gesture_hold_remaining = 0
        self._current_gesture = 'direct'

    def _gesture_cb(self, msg: String):
        """Named gesture command."""
        name = msg.data.strip().lower()
        if name not in GESTURES:
            self.get_logger().warn(f'Unknown gesture: "{name}"')
            return
        self._current_gesture = name
        # Queue a fresh copy of the gesture steps
        self._gesture_queue = list(GESTURES[name])
        self._gesture_hold_remaining = 0
        self.get_logger().info(f'Playing gesture: {name}')

    # ------------------------------------------------------------------
    # 20 Hz update loop
    # ------------------------------------------------------------------
    def _update(self):
        # Advance gesture playback
        if self._gesture_queue or self._gesture_hold_remaining > 0:
            self._step_gesture()

        # Smooth lerp toward target
        delta = self._target_pos - self._current_pos
        if abs(delta) > 0.2:
            step = delta * self._lerp_rate * self._speed_scale
            # Clamp step to avoid overshoot on large lerp_rate values
            max_step = abs(delta) * 0.5
            step = math.copysign(min(abs(step), max_step), step)
            self._current_pos += step
            self._moving = True
        else:
            self._current_pos = self._target_pos
            self._moving = False

        # Clamp final value
        self._current_pos = max(-100.0, min(100.0, self._current_pos))

        # Send to Teensy via serial_bridge
        raw_msg = Float32()
        raw_msg.data = float(self._current_pos)
        self._raw_pub.publish(raw_msg)

        # Publish status
        status = {
            'pos':     round(self._current_pos, 1),
            'target':  round(self._target_pos, 1),
            'moving':  self._moving,
            'gesture': self._current_gesture,
        }
        s_msg = String()
        s_msg.data = json.dumps(status)
        self._status_pub.publish(s_msg)

    # ------------------------------------------------------------------
    # Gesture step machine
    # ------------------------------------------------------------------
    def _step_gesture(self):
        """Advance gesture playback by one tick (50 ms)."""
        if self._gesture_hold_remaining > 0:
            self._gesture_hold_remaining -= 1
            return

        if not self._gesture_queue:
            return

        # Move to next keyframe
        pos, hold_ticks = self._gesture_queue.pop(0)
        self._target_pos = max(-100.0, min(100.0, pos))
        self._gesture_hold_remaining = max(0, hold_ticks - 1)


# ---------------------------------------------------------------------------
def main(args=None):
    rclpy.init(args=args)
    node = ArmNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
