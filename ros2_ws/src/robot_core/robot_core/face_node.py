"""
face_node.py
------------
African Mask face expression renderer.
Drives an OLED / LCD display or a pygame window (for desktop testing)
showing the mask's eyes, eyebrows, and mouth matching the current emotion.

Display backend priority
  1. Pygame window (always available for development/simulation)
  2. luma.oled (SSD1306/SSD1309 128×64 I2C OLED)

Topics subscribed
  /face/expression    (std_msgs/String) – emotion name from emotion_node
  /tts/phoneme_events (std_msgs/String) – JSON word-onset events for mouth anim
  /tts/speaking       (std_msgs/Bool)   – true while TTS plays

Topics published
  /face/status        (std_msgs/String) – JSON {expression, frame_count}

Parameters
  backend         – "pygame" | "oled" | "auto"  (default "auto")
  display_width   – pixels, default 128
  display_height  – pixels, default 64
  fps             – animation frames per second, default 30
"""

import json
import math
import threading
import time

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
# Expression definitions
# Each expression is a dict of drawing parameters:
#   eye_open     : 0.0 (closed) – 1.0 (wide open)
#   brow_raise   : -1.0 (angry) – 0 (neutral) – +1.0 (raised/surprised)
#   mouth_curve  : -1.0 (frown) – 0 (flat) – +1.0 (smile)
#   mouth_open   : 0.0 (closed) – 1.0 (open)
#   squint       : 0.0 – 1.0 (narrow eyes)
# ---------------------------------------------------------------------------
EXPRESSIONS: dict[str, dict] = {
    'neutral':   {'eye_open': 0.75, 'brow_raise':  0.0, 'mouth_curve':  0.0, 'mouth_open': 0.0, 'squint': 0.0},
    'happy':     {'eye_open': 0.85, 'brow_raise':  0.2, 'mouth_curve':  1.0, 'mouth_open': 0.3, 'squint': 0.3},
    'curious':   {'eye_open': 1.00, 'brow_raise':  0.6, 'mouth_curve':  0.2, 'mouth_open': 0.1, 'squint': 0.0},
    'listening': {'eye_open': 0.90, 'brow_raise':  0.3, 'mouth_curve':  0.1, 'mouth_open': 0.0, 'squint': 0.0},
    'thinking':  {'eye_open': 0.60, 'brow_raise': -0.1, 'mouth_curve': -0.1, 'mouth_open': 0.0, 'squint': 0.3},
    'excited':   {'eye_open': 1.00, 'brow_raise':  0.8, 'mouth_curve':  1.0, 'mouth_open': 0.6, 'squint': 0.0},
    'sleepy':    {'eye_open': 0.20, 'brow_raise': -0.3, 'mouth_curve': -0.1, 'mouth_open': 0.0, 'squint': 0.7},
    'sad':       {'eye_open': 0.55, 'brow_raise': -0.5, 'mouth_curve': -1.0, 'mouth_open': 0.0, 'squint': 0.2},
    'alert':     {'eye_open': 1.00, 'brow_raise':  0.5, 'mouth_curve':  0.0, 'mouth_open': 0.2, 'squint': 0.0},
}

LERP_SPEED = 0.10   # fraction per frame at 30 fps → ~300 ms transition


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


class FaceNode(Node):

    def __init__(self):
        super().__init__('face_node')

        # ---- Parameters ----
        self.declare_parameter('backend',       'auto')
        self.declare_parameter('display_width', 128)
        self.declare_parameter('display_height', 64)
        self.declare_parameter('fps',           30)

        self._backend = self.get_parameter('backend').value
        self._W       = self.get_parameter('display_width').value
        self._H       = self.get_parameter('display_height').value
        self._fps     = self.get_parameter('fps').value

        # ---- State ----
        self._target_expr  = dict(EXPRESSIONS['neutral'])
        self._current_expr = dict(EXPRESSIONS['neutral'])
        self._speaking     = False
        self._mouth_phase  = 0.0  # for talking animation
        self._frame_count  = 0
        self._expression_name = 'neutral'
        self._blink_phase  = 0.0  # for blink animation

        # ---- Publishers ----
        self._status_pub = self.create_publisher(String, '/face/status', RELIABLE_QOS)

        # ---- Subscribers ----
        self.create_subscription(String, '/face/expression',    self._expression_cb,    RELIABLE_QOS)
        self.create_subscription(String, '/tts/phoneme_events', self._phoneme_cb,       RELIABLE_QOS)
        self.create_subscription(Bool,   '/tts/speaking',       self._speaking_cb,      RELIABLE_QOS)

        # ---- Display backend ----
        self._display = None
        if self._backend in ('auto', 'oled'):
            self._display = self._init_oled()
        if self._display is None and self._backend in ('auto', 'pygame'):
            self._display = self._init_pygame()

        # ---- Render loop thread ----
        self._running = True
        self._render_thread = threading.Thread(
            target=self._render_loop, daemon=True, name='face_render')
        self._render_thread.start()

        # ---- Status timer 1 Hz ----
        self.create_timer(1.0, self._publish_status)

        self.get_logger().info(
            f'FaceNode started – backend={self._backend} '
            f'{self._W}×{self._H} @{self._fps}fps')

    # ------------------------------------------------------------------
    # Display backend init
    # ------------------------------------------------------------------
    def _init_oled(self):
        try:
            from luma.core.interface.serial import i2c
            from luma.oled.device import ssd1306
            serial = i2c(port=1, address=0x3C)
            device = ssd1306(serial, width=self._W, height=self._H)
            self.get_logger().info('OLED display initialised (SSD1306)')
            return ('oled', device)
        except Exception as exc:
            self.get_logger().debug(f'OLED init failed: {exc}')
            return None

    def _init_pygame(self):
        try:
            import pygame
            pygame.init()
            scale = 4  # upscale 128×64 → 512×256 for visibility
            screen = pygame.display.set_mode((self._W * scale, self._H * scale))
            pygame.display.set_caption('African Mask — Face')
            self.get_logger().info('Pygame display initialised')
            return ('pygame', screen, scale)
        except Exception as exc:
            self.get_logger().debug(f'Pygame init failed: {exc}')
            return None

    # ------------------------------------------------------------------
    # Callbacks
    # ------------------------------------------------------------------
    def _expression_cb(self, msg: String):
        name = msg.data.strip().lower()
        if name in EXPRESSIONS:
            self._expression_name = name
            self._target_expr = dict(EXPRESSIONS[name])

    def _phoneme_cb(self, msg: String):
        # Phoneme events drive mouth animation timing
        # We just note that speaking events arrived
        pass

    def _speaking_cb(self, msg: Bool):
        self._speaking = msg.data

    # ------------------------------------------------------------------
    # Render loop (background thread)
    # ------------------------------------------------------------------
    def _render_loop(self):
        import time
        interval = 1.0 / max(1, self._fps)

        while self._running:
            t0 = time.monotonic()
            self._update_expression()
            self._draw()
            self._frame_count += 1

            elapsed = time.monotonic() - t0
            time.sleep(max(0.0, interval - elapsed))

    def _update_expression(self):
        """Lerp current expression toward target."""
        for key in self._target_expr:
            self._current_expr[key] = _lerp(
                self._current_expr.get(key, 0.0),
                self._target_expr[key],
                LERP_SPEED,
            )

        # Talking mouth animation
        if self._speaking:
            self._mouth_phase += 0.3
            self._current_expr['mouth_open'] = (
                self._target_expr['mouth_open'] * 0.5
                + 0.5 * abs(math.sin(self._mouth_phase))
            )
        else:
            self._mouth_phase = 0.0

        # Periodic blink
        self._blink_phase += 0.02
        if 0 < self._blink_phase % (math.pi * 6) < 0.15:
            self._current_expr['eye_open'] = 0.05
        # (else eye_open lerps normally from target)

    def _draw(self):
        if self._display is None:
            return
        backend_type = self._display[0]
        if backend_type == 'pygame':
            self._draw_pygame()
        elif backend_type == 'oled':
            self._draw_oled()

    # ------------------------------------------------------------------
    # Pygame renderer (development / desktop)
    # ------------------------------------------------------------------
    def _draw_pygame(self):
        try:
            import pygame
            _, screen, scale = self._display

            for event in pygame.event.get():
                if event.type == pygame.QUIT:
                    self._running = False

            # Draw on a small surface then scale up
            surf = pygame.Surface((self._W, self._H))
            surf.fill((0, 0, 0))

            e = self._current_expr
            cx = self._W // 2
            cy = self._H // 2

            eye_h = int(e['eye_open'] * 10) + 1
            # Left eye
            pygame.draw.ellipse(surf, (255, 255, 255),
                                 (cx - 30, cy - eye_h // 2, 16, eye_h))
            # Right eye
            pygame.draw.ellipse(surf, (255, 255, 255),
                                 (cx + 14, cy - eye_h // 2, 16, eye_h))

            # Eyebrows
            brow_y = int(cy - 14 - e['brow_raise'] * 6)
            pygame.draw.line(surf, (255, 200, 100),
                             (cx - 32, brow_y), (cx - 14, brow_y + 3), 2)
            pygame.draw.line(surf, (255, 200, 100),
                             (cx + 14, brow_y + 3), (cx + 32, brow_y), 2)

            # Mouth
            mouth_y = cy + 14
            mouth_curve = int(e['mouth_curve'] * 6)
            mouth_open_h = int(e['mouth_open'] * 8)
            if mouth_open_h < 2:
                # Closed mouth — curved line
                points = [
                    (cx - 14, mouth_y),
                    (cx, mouth_y + mouth_curve),
                    (cx + 14, mouth_y),
                ]
                if len(points) >= 2:
                    pygame.draw.lines(surf, (255, 100, 100), False, points, 2)
            else:
                # Open mouth — ellipse
                pygame.draw.ellipse(surf, (200, 50, 50),
                                     (cx - 10, mouth_y - mouth_open_h // 2,
                                      20, mouth_open_h))

            scaled = pygame.transform.scale(surf, (self._W * scale, self._H * scale))
            screen.blit(scaled, (0, 0))
            pygame.display.flip()
        except Exception as exc:
            self.get_logger().debug(f'Pygame draw error: {exc}')

    # ------------------------------------------------------------------
    # OLED renderer (luma.oled / PIL)
    # ------------------------------------------------------------------
    def _draw_oled(self):
        try:
            from luma.core.render import canvas
            from PIL import ImageDraw

            _, device = self._display
            e = self._current_expr
            cx = self._W // 2
            cy = self._H // 2

            with canvas(device) as draw:
                eye_h = max(1, int(e['eye_open'] * 10))
                # Left eye
                draw.ellipse(
                    [cx - 30, cy - eye_h // 2, cx - 14, cy + eye_h // 2],
                    fill='white')
                # Right eye
                draw.ellipse(
                    [cx + 14, cy - eye_h // 2, cx + 30, cy + eye_h // 2],
                    fill='white')
                # Eyebrows
                brow_y = cy - 14 - int(e['brow_raise'] * 6)
                draw.line([(cx - 30, brow_y), (cx - 12, brow_y + 3)], fill='white', width=2)
                draw.line([(cx + 12, brow_y + 3), (cx + 30, brow_y)], fill='white', width=2)
                # Mouth
                curve = int(e['mouth_curve'] * 5)
                draw.arc([cx - 12, cy + 10, cx + 12, cy + 20 + curve],
                         start=0, end=180, fill='white')
        except Exception as exc:
            self.get_logger().debug(f'OLED draw error: {exc}')

    # ------------------------------------------------------------------
    # Status publisher
    # ------------------------------------------------------------------
    def _publish_status(self):
        status = {
            'expression':  self._expression_name,
            'frame_count': self._frame_count,
            'speaking':    self._speaking,
        }
        msg = String()
        msg.data = json.dumps(status)
        self._status_pub.publish(msg)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    def destroy_node(self):
        self._running = False
        self._render_thread.join(timeout=2.0)
        try:
            if self._display and self._display[0] == 'pygame':
                import pygame
                pygame.quit()
        except Exception:
            pass
        super().destroy_node()


def main(args=None):
    rclpy.init(args=args)
    node = FaceNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
