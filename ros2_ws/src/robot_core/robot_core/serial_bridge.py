"""
serial_bridge.py
----------------
Thread-safe USB serial bridge between the Raspberry Pi (ROS2) and the
Teensy 4.1 micro-controller.

JSON protocol
  Outgoing  → Teensy  : {"cmd":"drive","speed":50,"turn":20}
                         {"cmd":"arm","pos":30}
                         {"cmd":"pid","kp":25.0,"ki":0.5,"kd":8.0}
  Incoming  ← Teensy  : {"t":"telem","angle":1.2,"gyro":0.3,"bat":95.2,"arm":45}

ROS2 topics published
  /teensy/telemetry   (std_msgs/String)  – raw JSON string from Teensy

ROS2 topics subscribed
  /cmd_vel            (geometry_msgs/Twist)
  /arm_cmd            (std_msgs/Float32)
"""

import json
import threading
import time

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy

import serial
import serial.tools.list_ports

from std_msgs.msg import String, Float32
from geometry_msgs.msg import Twist


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
DEFAULT_PORT = '/dev/ttyACM0'
BAUD_RATE    = 115200
RECONNECT_DELAY_S = 2.0
READ_TIMEOUT_S    = 0.05   # non-blocking read timeout

# QoS: best-effort, keep-last-1 is fine for high-rate telemetry
TELEM_QOS = QoSProfile(
    reliability=ReliabilityPolicy.BEST_EFFORT,
    history=HistoryPolicy.KEEP_LAST,
    depth=1,
)

CMD_QOS = QoSProfile(
    reliability=ReliabilityPolicy.RELIABLE,
    history=HistoryPolicy.KEEP_LAST,
    depth=10,
)


# ---------------------------------------------------------------------------
# Helper: find the Teensy serial port automatically
# ---------------------------------------------------------------------------
def find_teensy_port() -> str:
    """Return the first USB-serial port that looks like a Teensy."""
    TEENSY_VID = 0x16C0  # PJRC USB VID
    for port in serial.tools.list_ports.comports():
        if port.vid == TEENSY_VID:
            return port.device
    # Fall back to default
    return DEFAULT_PORT


# ---------------------------------------------------------------------------
# Main node
# ---------------------------------------------------------------------------
class SerialBridgeNode(Node):
    """
    Manages a persistent, auto-reconnecting serial connection to the Teensy.
    All serial I/O runs in a background thread; thread-safety is enforced
    via a threading.Lock on the serial port object.
    """

    def __init__(self):
        super().__init__('serial_bridge')

        # Parameters
        self.declare_parameter('port', find_teensy_port())
        self.declare_parameter('baud', BAUD_RATE)
        self.declare_parameter('reconnect_delay', RECONNECT_DELAY_S)

        self._port_name      = self.get_parameter('port').value
        self._baud           = self.get_parameter('baud').value
        self._reconnect_delay = self.get_parameter('reconnect_delay').value

        # Serial state
        self._serial: serial.Serial | None = None
        self._serial_lock = threading.Lock()
        self._running = True

        # ---- Publishers ----
        self._telem_pub = self.create_publisher(
            String, '/teensy/telemetry', TELEM_QOS)

        # ---- Subscribers ----
        self.create_subscription(
            Twist, '/cmd_vel', self._cmd_vel_cb, CMD_QOS)
        self.create_subscription(
            Float32, '/arm_cmd', self._arm_cmd_cb, CMD_QOS)

        # ---- Background I/O thread ----
        self._io_thread = threading.Thread(
            target=self._io_loop, daemon=True, name='serial_io')
        self._io_thread.start()

        self.get_logger().info(
            f'SerialBridge started – port={self._port_name} baud={self._baud}')

    # ------------------------------------------------------------------
    # Serial connection management
    # ------------------------------------------------------------------
    def _open_port(self) -> bool:
        """Try to open the serial port. Returns True on success."""
        try:
            ser = serial.Serial(
                port=self._port_name,
                baudrate=self._baud,
                timeout=READ_TIMEOUT_S,
                write_timeout=0.5,
            )
            with self._serial_lock:
                self._serial = ser
            self.get_logger().info(
                f'Serial port {self._port_name} opened at {self._baud} baud')
            return True
        except serial.SerialException as exc:
            self.get_logger().warn(f'Cannot open {self._port_name}: {exc}')
            return False

    def _close_port(self):
        with self._serial_lock:
            if self._serial and self._serial.is_open:
                try:
                    self._serial.close()
                except Exception:
                    pass
            self._serial = None

    # ------------------------------------------------------------------
    # I/O loop (background thread)
    # ------------------------------------------------------------------
    def _io_loop(self):
        """
        Continuously read lines from the Teensy and publish them.
        Auto-reconnects on disconnect.
        """
        buf = b''
        while self._running:
            # --- ensure connection ---
            with self._serial_lock:
                connected = self._serial is not None and self._serial.is_open
            if not connected:
                if not self._open_port():
                    time.sleep(self._reconnect_delay)
                    continue
                buf = b''

            # --- read a line ---
            try:
                with self._serial_lock:
                    raw = self._serial.read(256)
            except serial.SerialException as exc:
                self.get_logger().error(f'Serial read error: {exc}')
                self._close_port()
                continue

            if not raw:
                continue

            buf += raw
            while b'\n' in buf:
                line, buf = buf.split(b'\n', 1)
                self._handle_teensy_line(line.strip())

    # ------------------------------------------------------------------
    # Parse a complete line from the Teensy
    # ------------------------------------------------------------------
    def _handle_teensy_line(self, raw: bytes):
        if not raw:
            return
        try:
            text = raw.decode('ascii', errors='replace').strip()
            # Validate JSON before publishing
            obj = json.loads(text)
            if obj.get('t') == 'telem':
                msg = String()
                msg.data = text
                self._telem_pub.publish(msg)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            self.get_logger().debug(f'Bad Teensy line: {raw!r} – {exc}')

    # ------------------------------------------------------------------
    # Send JSON to Teensy (thread-safe)
    # ------------------------------------------------------------------
    def _send(self, payload: dict):
        line = (json.dumps(payload, separators=(',', ':')) + '\n').encode()
        with self._serial_lock:
            if self._serial is None or not self._serial.is_open:
                self.get_logger().warn('Serial not open, dropping command')
                return
            try:
                self._serial.write(line)
                self._serial.flush()
            except serial.SerialException as exc:
                self.get_logger().error(f'Serial write error: {exc}')
                # Mark as disconnected so the I/O thread reconnects
                try:
                    self._serial.close()
                except Exception:
                    pass
                self._serial = None

    # ------------------------------------------------------------------
    # ROS2 subscription callbacks
    # ------------------------------------------------------------------
    def _cmd_vel_cb(self, msg: Twist):
        """
        Convert Twist to Teensy drive command.
          linear.x  → forward speed  (-100 … +100)
          angular.z → turn rate      (-100 … +100)
        """
        speed = int(max(-100, min(100, msg.linear.x * 100.0)))
        turn  = int(max(-100, min(100, msg.angular.z * 100.0)))
        self._send({'cmd': 'drive', 'speed': speed, 'turn': turn})

    def _arm_cmd_cb(self, msg: Float32):
        """Forward arm position command to Teensy (-100 … +100)."""
        pos = max(-100.0, min(100.0, float(msg.data)))
        self._send({'cmd': 'arm', 'pos': round(pos, 1)})

    # ------------------------------------------------------------------
    # Public helpers for other nodes that share this bridge
    # ------------------------------------------------------------------
    def send_pid(self, kp: float, ki: float, kd: float):
        self._send({'cmd': 'pid', 'kp': kp, 'ki': ki, 'kd': kd})

    def send_drive(self, speed: float, turn: float):
        self._send({'cmd': 'drive',
                    'speed': round(speed, 1),
                    'turn':  round(turn, 1)})

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    def destroy_node(self):
        self._running = False
        self._close_port()
        super().destroy_node()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main(args=None):
    rclpy.init(args=args)
    node = SerialBridgeNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
