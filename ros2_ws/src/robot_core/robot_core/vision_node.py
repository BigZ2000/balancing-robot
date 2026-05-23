"""
vision_node.py
--------------
Vision node for the African Mask Balancing Robot.
Logitech camera via OpenCV + MediaPipe face detection.
Optional YOLOv8 object detection.

Topics published
  /vision/faces              (std_msgs/String)  – JSON {count, faces:[{x,y,w,h,dist}]}
  /vision/frame_compressed   (sensor_msgs/CompressedImage) – JPEG thumbnail

Parameters
  camera_index    – OpenCV camera index, default 0
  width, height   – capture resolution, default 640×480
  fps             – capture FPS, default 30
  publish_frames  – publish compressed frames (can be bandwidth-heavy), default True
  frame_skip      – publish 1 of every N frames, default 3
  yolo_enabled    – enable YOLOv8 object detection, default False
  yolo_model      – YOLOv8 model path / name, default "yolov8n.pt"
  focal_length_px – camera focal length in pixels for distance estimate, default 700
  face_width_m    – average face width in metres, default 0.15
"""

import io
import json
import math
import threading
import time
from typing import Optional

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy

from std_msgs.msg import String
from sensor_msgs.msg import CompressedImage

BEST_EFFORT_QOS = QoSProfile(
    reliability=ReliabilityPolicy.BEST_EFFORT,
    history=HistoryPolicy.KEEP_LAST,
    depth=2,
)
RELIABLE_QOS = QoSProfile(
    reliability=ReliabilityPolicy.RELIABLE,
    history=HistoryPolicy.KEEP_LAST,
    depth=5,
)

# ---------------------------------------------------------------------------
try:
    import cv2
    _CV2_AVAILABLE = True
except ImportError:
    _CV2_AVAILABLE = False

try:
    import mediapipe as mp
    _MP_AVAILABLE = True
except ImportError:
    _MP_AVAILABLE = False


class VisionNode(Node):

    def __init__(self):
        super().__init__('vision_node')

        # ---- Parameters ----
        self.declare_parameter('camera_index',    0)
        self.declare_parameter('width',           640)
        self.declare_parameter('height',          480)
        self.declare_parameter('fps',             30)
        self.declare_parameter('publish_frames',  True)
        self.declare_parameter('frame_skip',      3)
        self.declare_parameter('yolo_enabled',    False)
        self.declare_parameter('yolo_model',      'yolov8n.pt')
        self.declare_parameter('focal_length_px', 700.0)
        self.declare_parameter('face_width_m',    0.15)

        self._cam_idx        = self.get_parameter('camera_index').value
        self._width          = self.get_parameter('width').value
        self._height         = self.get_parameter('height').value
        self._fps            = self.get_parameter('fps').value
        self._pub_frames     = self.get_parameter('publish_frames').value
        self._frame_skip     = self.get_parameter('frame_skip').value
        self._yolo_enabled   = self.get_parameter('yolo_enabled').value
        self._yolo_model_name = self.get_parameter('yolo_model').value
        self._focal_px       = self.get_parameter('focal_length_px').value
        self._face_width_m   = self.get_parameter('face_width_m').value

        # ---- State ----
        self._frame_count  = 0
        self._last_faces: list[dict] = []
        self._cap: Optional[object]  = None
        self._yolo_model: Optional[object] = None

        # ---- Publishers ----
        self._faces_pub  = self.create_publisher(
            String,           '/vision/faces',            RELIABLE_QOS)
        self._frame_pub  = self.create_publisher(
            CompressedImage,  '/vision/frame_compressed', BEST_EFFORT_QOS)

        # ---- Dependency checks ----
        if not _CV2_AVAILABLE:
            self.get_logger().error('opencv-python not installed – vision disabled')
            return
        if not _MP_AVAILABLE:
            self.get_logger().warn('mediapipe not installed – face detection disabled')

        # ---- Init MediaPipe ----
        self._mp_face = None
        self._mp_det  = None
        if _MP_AVAILABLE:
            self._mp_face = mp.solutions.face_detection
            self._mp_det  = self._mp_face.FaceDetection(
                model_selection=1,         # 1 = full-range model
                min_detection_confidence=0.5,
            )

        # ---- Init YOLO (optional) ----
        if self._yolo_enabled:
            self._load_yolo()

        # ---- Start capture thread ----
        threading.Thread(
            target=self._capture_loop, daemon=True, name='vision_cap').start()

        self.get_logger().info(
            f'VisionNode started – cam={self._cam_idx} '
            f'{self._width}×{self._height} @{self._fps}fps '
            f'yolo={self._yolo_enabled}')

    # ------------------------------------------------------------------
    # YOLO loader
    # ------------------------------------------------------------------
    def _load_yolo(self):
        try:
            from ultralytics import YOLO  # type: ignore
            self._yolo_model = YOLO(self._yolo_model_name)
            self.get_logger().info(f'YOLOv8 loaded: {self._yolo_model_name}')
        except Exception as exc:
            self.get_logger().warn(f'YOLOv8 load failed: {exc}')
            self._yolo_enabled = False

    # ------------------------------------------------------------------
    # Camera capture loop (background thread)
    # ------------------------------------------------------------------
    def _capture_loop(self):
        cap = cv2.VideoCapture(self._cam_idx)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH,  self._width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self._height)
        cap.set(cv2.CAP_PROP_FPS,          self._fps)

        if not cap.isOpened():
            self.get_logger().error(f'Cannot open camera {self._cam_idx}')
            return

        self._cap = cap
        interval = 1.0 / max(1, self._fps)

        while True:
            t0 = time.monotonic()
            ret, frame = cap.read()
            if not ret:
                self.get_logger().warn('Camera read failed – retrying…')
                time.sleep(0.5)
                continue

            self._frame_count += 1
            self._process_frame(frame)

            elapsed = time.monotonic() - t0
            sleep_t = max(0.0, interval - elapsed)
            time.sleep(sleep_t)

    # ------------------------------------------------------------------
    # Per-frame processing
    # ------------------------------------------------------------------
    def _process_frame(self, frame):
        # ---- Face detection ----
        faces: list[dict] = []
        if self._mp_det is not None:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = self._mp_det.process(rgb)
            if results.detections:
                ih, iw = frame.shape[:2]
                for det in results.detections:
                    bb = det.location_data.relative_bounding_box
                    x = int(bb.xmin * iw)
                    y = int(bb.ymin * ih)
                    w = int(bb.width  * iw)
                    h = int(bb.height * ih)
                    # Distance estimate from face width in pixels
                    dist_m = (self._face_width_m * self._focal_px / w) if w > 0 else -1.0
                    faces.append({
                        'x':    x, 'y': y, 'w': w, 'h': h,
                        'dist': round(dist_m, 2),
                        'conf': round(det.score[0], 3),
                    })
                    # Draw on frame for debug
                    cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)

        self._last_faces = faces

        # Publish face data every frame
        faces_msg = String()
        faces_msg.data = json.dumps({
            'count': len(faces),
            'faces': faces,
        })
        self._faces_pub.publish(faces_msg)

        # ---- YOLO (if enabled) ----
        if self._yolo_enabled and self._yolo_model is not None:
            self._run_yolo(frame)

        # ---- Compressed frame (throttled) ----
        if self._pub_frames and (self._frame_count % self._frame_skip == 0):
            self._publish_frame(frame)

    # ------------------------------------------------------------------
    # YOLO inference
    # ------------------------------------------------------------------
    def _run_yolo(self, frame):
        try:
            results = self._yolo_model.predict(
                frame, conf=0.4, verbose=False, stream=False)
            for r in results:
                for box in r.boxes:
                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    cls  = int(box.cls[0])
                    conf = float(box.conf[0])
                    label = self._yolo_model.names[cls]
                    cv2.rectangle(frame, (x1, y1), (x2, y2), (255, 0, 0), 2)
                    cv2.putText(frame, f'{label} {conf:.2f}',
                                (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX,
                                0.5, (255, 0, 0), 1)
        except Exception as exc:
            self.get_logger().debug(f'YOLO error: {exc}')

    # ------------------------------------------------------------------
    # Publish compressed frame
    # ------------------------------------------------------------------
    def _publish_frame(self, frame):
        try:
            # Resize to 320×240 thumbnail to save bandwidth
            thumb = cv2.resize(frame, (320, 240))
            ok, buf = cv2.imencode('.jpg', thumb, [cv2.IMWRITE_JPEG_QUALITY, 70])
            if not ok:
                return
            msg = CompressedImage()
            msg.header.stamp = self.get_clock().now().to_msg()
            msg.format = 'jpeg'
            msg.data   = buf.tobytes()
            self._frame_pub.publish(msg)
        except Exception as exc:
            self.get_logger().debug(f'Frame publish error: {exc}')

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    def destroy_node(self):
        if self._cap:
            self._cap.release()
        if self._mp_det:
            self._mp_det.close()
        super().destroy_node()


# ---------------------------------------------------------------------------
def main(args=None):
    rclpy.init(args=args)
    node = VisionNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
