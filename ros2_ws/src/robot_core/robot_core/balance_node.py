"""
balance_node.py
---------------
Monitors balance state from Teensy telemetry and provides PID tuning
and high-level drive coordination.

Topics subscribed
  /teensy/telemetry  (std_msgs/String)  – JSON from Teensy
  /cmd_vel           (geometry_msgs/Twist)

Topics published
  /robot/balance_status  (std_msgs/String)  – JSON status

Parameters
  kp, ki, kd         – PID gains forwarded to Teensy on startup / change
  max_angle          – tilt angle (deg) beyond which we declare fault
"""

import json
import time

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy

from std_msgs.msg import String
from geometry_msgs.msg import Twist

# ---------------------------------------------------------------------------
TELEM_QOS = QoSProfile(
    reliability=ReliabilityPolicy.BEST_EFFORT,
    history=HistoryPolicy.KEEP_LAST,
    depth=1,
)
STATUS_QOS = QoSProfile(
    reliability=ReliabilityPolicy.RELIABLE,
    history=HistoryPolicy.KEEP_LAST,
    depth=5,
)


class BalanceNode(Node):

    # default PID gains – match Teensy firmware defaults
    DEFAULT_KP = 25.0
    DEFAULT_KI =  0.5
    DEFAULT_KD =  8.0
    DEFAULT_MAX_ANGLE = 35.0   # degrees, safety cut-off mirrors firmware

    def __init__(self):
        super().__init__('balance_node')

        # ---- Parameters ----
        self.declare_parameter('kp',        self.DEFAULT_KP)
        self.declare_parameter('ki',        self.DEFAULT_KI)
        self.declare_parameter('kd',        self.DEFAULT_KD)
        self.declare_parameter('max_angle', self.DEFAULT_MAX_ANGLE)

        self._kp        = self.get_parameter('kp').value
        self._ki        = self.get_parameter('ki').value
        self._kd        = self.get_parameter('kd').value
        self._max_angle = self.get_parameter('max_angle').value

        # ---- State ----
        self._angle     = 0.0
        self._gyro      = 0.0
        self._battery   = 100.0
        self._arm_pos   = 0.0
        self._fault     = False
        self._last_telem_t = 0.0
        self._telem_timeout_s = 1.0   # declare lost if no telem for 1 s

        # ---- Telemetry cache for status message ----
        self._status_seq = 0

        # ---- Publishers ----
        self._status_pub = self.create_publisher(
            String, '/robot/balance_status', STATUS_QOS)

        # ---- Subscribers ----
        self.create_subscription(
            String, '/teensy/telemetry', self._telem_cb, TELEM_QOS)

        # cmd_vel is re-published straight to Teensy via serial_bridge,
        # but we monitor it here so we can gate it when faulted.
        self.create_subscription(
            Twist, '/cmd_vel', self._cmd_vel_cb,
            QoSProfile(reliability=ReliabilityPolicy.RELIABLE,
                       history=HistoryPolicy.KEEP_LAST, depth=5))

        # Publisher to send (gated) drive commands onward to serial bridge
        self._drive_pub = self.create_publisher(
            Twist, '/cmd_vel_safe',
            QoSProfile(reliability=ReliabilityPolicy.RELIABLE,
                       history=HistoryPolicy.KEEP_LAST, depth=5))

        # Publisher for PID tuning commands (serial_bridge listens indirectly
        # via the /pid_tune topic which we handle locally)
        self._pid_pub = self.create_publisher(
            String, '/teensy/pid_cmd', STATUS_QOS)

        self.create_subscription(
            String, '/balance/pid_tune', self._pid_tune_cb, STATUS_QOS)

        # ---- Timers ----
        # 10 Hz status publisher
        self.create_timer(0.1, self._publish_status)
        # Push PID gains to Teensy shortly after startup
        self.create_timer(2.0, self._push_pid_once)
        self._pid_pushed = False

        self.get_logger().info(
            f'BalanceNode started – PID kp={self._kp} ki={self._ki} kd={self._kd}')

    # ------------------------------------------------------------------
    # Callbacks
    # ------------------------------------------------------------------
    def _telem_cb(self, msg: String):
        try:
            data = json.loads(msg.data)
        except json.JSONDecodeError:
            return

        self._angle   = float(data.get('angle', 0.0))
        self._gyro    = float(data.get('gyro',  0.0))
        self._battery = float(data.get('bat',  100.0))
        self._arm_pos = float(data.get('arm',    0.0))
        self._last_telem_t = time.monotonic()

        # Detect fall / fault
        prev_fault = self._fault
        self._fault = abs(self._angle) > self._max_angle
        if self._fault and not prev_fault:
            self.get_logger().error(
                f'BALANCE FAULT – angle={self._angle:.1f}° exceeds ±{self._max_angle}°')

    def _cmd_vel_cb(self, msg: Twist):
        """Gate drive commands: block when faulted or telem lost."""
        if self._fault:
            return
        if (time.monotonic() - self._last_telem_t) > self._telem_timeout_s:
            self.get_logger().warn('Telem timeout – blocking drive command')
            return
        self._drive_pub.publish(msg)

    def _pid_tune_cb(self, msg: String):
        """Receive JSON {kp, ki, kd} and forward to Teensy."""
        try:
            data = json.loads(msg.data)
            self._kp = float(data.get('kp', self._kp))
            self._ki = float(data.get('ki', self._ki))
            self._kd = float(data.get('kd', self._kd))
            self.get_logger().info(
                f'PID update: kp={self._kp} ki={self._ki} kd={self._kd}')
            self._push_pid()
        except (json.JSONDecodeError, ValueError) as exc:
            self.get_logger().warn(f'Bad PID tune message: {exc}')

    # ------------------------------------------------------------------
    # PID push
    # ------------------------------------------------------------------
    def _push_pid_once(self):
        """One-shot timer: push PID gains to Teensy after boot."""
        if not self._pid_pushed:
            self._push_pid()
            self._pid_pushed = True

    def _push_pid(self):
        payload = json.dumps(
            {'cmd': 'pid', 'kp': self._kp, 'ki': self._ki, 'kd': self._kd})
        msg = String()
        msg.data = payload
        self._pid_pub.publish(msg)
        self.get_logger().debug(f'Pushed PID gains: {payload}')

    # ------------------------------------------------------------------
    # Status publisher
    # ------------------------------------------------------------------
    def _publish_status(self):
        self._status_seq += 1

        telem_age = time.monotonic() - self._last_telem_t
        connected = telem_age < self._telem_timeout_s

        status = {
            'seq':       self._status_seq,
            'angle':     round(self._angle, 2),
            'gyro':      round(self._gyro, 2),
            'battery':   round(self._battery, 1),
            'arm_pos':   round(self._arm_pos, 1),
            'fault':     self._fault,
            'connected': connected,
            'kp': self._kp,
            'ki': self._ki,
            'kd': self._kd,
        }

        msg = String()
        msg.data = json.dumps(status)
        self._status_pub.publish(msg)


# ---------------------------------------------------------------------------
def main(args=None):
    rclpy.init(args=args)
    node = BalanceNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
