"""
dashboard_node.py
-----------------
Aggregates robot telemetry and serves a consolidated JSON status
object for the web dashboard (accessed via rosbridge WebSocket on port 9090).

This node collects data from all major topics and republishes a single
/dashboard/state (std_msgs/String JSON) at a comfortable 10 Hz for
the frontend to consume.

Topics subscribed
  /robot/balance_status  (std_msgs/String)
  /robot/emotion         (std_msgs/String)
  /arm/status            (std_msgs/String)
  /ai/status             (std_msgs/String)
  /tts/speaking          (std_msgs/Bool)
  /stt/listening         (std_msgs/Bool)
  /vision/faces          (std_msgs/String)
  /lidar/sector_distances (std_msgs/String)
  /lidar/clear_to_move   (std_msgs/Bool)
  /lidar/obstacle_distance (std_msgs/Float32)

Topics published
  /dashboard/state    (std_msgs/String) – consolidated JSON at 10 Hz
  /dashboard/alert    (std_msgs/String) – JSON alert messages (faults, warnings)

Parameters
  publish_hz   – dashboard state publish frequency, default 10
"""

import json
import time

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy

from std_msgs.msg import String, Bool, Float32

BEST_EFFORT_QOS = QoSProfile(
    reliability=ReliabilityPolicy.BEST_EFFORT,
    history=HistoryPolicy.KEEP_LAST,
    depth=1,
)
RELIABLE_QOS = QoSProfile(
    reliability=ReliabilityPolicy.RELIABLE,
    history=HistoryPolicy.KEEP_LAST,
    depth=5,
)


class DashboardNode(Node):

    def __init__(self):
        super().__init__('dashboard_node')

        self.declare_parameter('publish_hz', 10)
        hz = self.get_parameter('publish_hz').value

        # ---- Aggregated state ----
        self._state = {
            'timestamp':       0,
            'balance': {
                'angle':     0.0,
                'gyro':      0.0,
                'battery':   100.0,
                'fault':     False,
                'connected': False,
                'kp': 25.0, 'ki': 0.5, 'kd': 8.0,
            },
            'emotion':        'neutral',
            'arm': {
                'pos':     0.0,
                'target':  0.0,
                'moving':  False,
                'gesture': 'neutral',
            },
            'ai': {
                'thinking':      False,
                'last_query':    '',
                'history_turns': 0,
                'model':         '',
            },
            'speech': {
                'speaking':   False,
                'listening':  False,
            },
            'vision': {
                'faces':   0,
                'details': [],
            },
            'lidar': {
                'obstacle_m':   -1.0,
                'clear':        True,
                'front': -1.0, 'left': -1.0, 'right': -1.0, 'rear': -1.0,
            },
            'uptime_s': 0,
        }
        self._start_time = time.monotonic()
        self._prev_fault = False

        # ---- Publishers ----
        self._state_pub = self.create_publisher(
            String, '/dashboard/state', RELIABLE_QOS)
        self._alert_pub = self.create_publisher(
            String, '/dashboard/alert', RELIABLE_QOS)

        # ---- Subscribers ----
        subs = [
            (String,  '/robot/balance_status',     self._balance_cb,   BEST_EFFORT_QOS),
            (String,  '/robot/emotion',             self._emotion_cb,   BEST_EFFORT_QOS),
            (String,  '/arm/status',                self._arm_cb,       BEST_EFFORT_QOS),
            (String,  '/ai/status',                 self._ai_cb,        BEST_EFFORT_QOS),
            (Bool,    '/tts/speaking',              self._speaking_cb,  BEST_EFFORT_QOS),
            (Bool,    '/stt/listening',             self._listening_cb, BEST_EFFORT_QOS),
            (String,  '/vision/faces',              self._vision_cb,    BEST_EFFORT_QOS),
            (String,  '/lidar/sector_distances',    self._sectors_cb,   BEST_EFFORT_QOS),
            (Bool,    '/lidar/clear_to_move',       self._clear_cb,     BEST_EFFORT_QOS),
            (Float32, '/lidar/obstacle_distance',   self._obstacle_cb,  BEST_EFFORT_QOS),
        ]
        for msg_type, topic, cb, qos in subs:
            self.create_subscription(msg_type, topic, cb, qos)

        # ---- Publish timer ----
        self.create_timer(1.0 / hz, self._publish)

        self.get_logger().info(f'DashboardNode started at {hz} Hz')

    # ------------------------------------------------------------------
    # Callbacks
    # ------------------------------------------------------------------
    def _balance_cb(self, msg: String):
        try:
            data = json.loads(msg.data)
            b = self._state['balance']
            b['angle']     = data.get('angle',     b['angle'])
            b['gyro']      = data.get('gyro',      b['gyro'])
            b['battery']   = data.get('battery',   b['battery'])
            b['fault']     = bool(data.get('fault',     b['fault']))
            b['connected'] = bool(data.get('connected', b['connected']))
            b['kp']        = data.get('kp', b['kp'])
            b['ki']        = data.get('ki', b['ki'])
            b['kd']        = data.get('kd', b['kd'])

            # Fault alert
            if b['fault'] and not self._prev_fault:
                self._send_alert('BALANCE_FAULT',
                    f"Robot fell over! angle={b['angle']:.1f}°")
            self._prev_fault = b['fault']
        except (json.JSONDecodeError, TypeError):
            pass

    def _emotion_cb(self, msg: String):
        self._state['emotion'] = msg.data.strip()

    def _arm_cb(self, msg: String):
        try:
            data = json.loads(msg.data)
            self._state['arm'].update(data)
        except (json.JSONDecodeError, TypeError):
            pass

    def _ai_cb(self, msg: String):
        try:
            data = json.loads(msg.data)
            self._state['ai'].update(data)
        except (json.JSONDecodeError, TypeError):
            pass

    def _speaking_cb(self, msg: Bool):
        self._state['speech']['speaking'] = msg.data

    def _listening_cb(self, msg: Bool):
        self._state['speech']['listening'] = msg.data

    def _vision_cb(self, msg: String):
        try:
            data = json.loads(msg.data)
            self._state['vision']['faces']   = data.get('count', 0)
            self._state['vision']['details'] = data.get('faces', [])
        except (json.JSONDecodeError, TypeError):
            pass

    def _sectors_cb(self, msg: String):
        try:
            data = json.loads(msg.data)
            for key in ('front', 'left', 'right', 'rear'):
                if key in data:
                    self._state['lidar'][key] = data[key]
        except (json.JSONDecodeError, TypeError):
            pass

    def _clear_cb(self, msg: Bool):
        self._state['lidar']['clear'] = msg.data

    def _obstacle_cb(self, msg: Float32):
        self._state['lidar']['obstacle_m'] = round(float(msg.data), 2)

    # ------------------------------------------------------------------
    # Publish
    # ------------------------------------------------------------------
    def _publish(self):
        self._state['timestamp'] = int(time.time())
        self._state['uptime_s']  = int(time.monotonic() - self._start_time)

        msg = String()
        msg.data = json.dumps(self._state, separators=(',', ':'))
        self._state_pub.publish(msg)

    def _send_alert(self, code: str, detail: str):
        alert = {
            'code':      code,
            'detail':    detail,
            'timestamp': int(time.time()),
        }
        msg = String()
        msg.data = json.dumps(alert)
        self._alert_pub.publish(msg)
        self.get_logger().warn(f'Alert: {code} – {detail}')


def main(args=None):
    rclpy.init(args=args)
    node = DashboardNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
