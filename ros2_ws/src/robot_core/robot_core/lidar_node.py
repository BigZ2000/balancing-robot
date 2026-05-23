"""
lidar_node.py
-------------
Companion node for the RPLIDAR C1 laser scanner.
The low-level driver is provided by the rplidar_ros package (launched
separately in robot.launch.py).  This node subscribes to the raw
/scan topic published by rplidar_ros and derives higher-level outputs
used by the rest of the robot system.

Outputs
  /lidar/obstacle_distance  (std_msgs/Float32) – nearest obstacle (m), -1 if none
  /lidar/sector_distances   (std_msgs/String)  – JSON {front, left, right, rear} (m)
  /lidar/clear_to_move      (std_msgs/Bool)    – True when front > safety_dist

Topics subscribed
  /scan  (sensor_msgs/LaserScan) – raw LIDAR data from rplidar_ros

Parameters
  safety_dist_m   – minimum front clearance to allow movement (m), default 0.4
  sector_width_deg – half-width of each directional sector (deg), default 30
"""

import json
import math

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy

from std_msgs.msg import Float32, String, Bool
from sensor_msgs.msg import LaserScan

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

# Direction sectors (centre angle, degrees from robot forward = 0°)
SECTORS = {
    'front': 0.0,
    'left':  90.0,
    'rear':  180.0,
    'right': 270.0,
}


class LidarNode(Node):

    def __init__(self):
        super().__init__('lidar_node')

        self.declare_parameter('safety_dist_m',   0.40)
        self.declare_parameter('sector_width_deg', 30.0)

        self._safety_dist   = self.get_parameter('safety_dist_m').value
        self._sector_half_w = math.radians(
            self.get_parameter('sector_width_deg').value)

        # ---- Publishers ----
        self._obstacle_pub = self.create_publisher(
            Float32, '/lidar/obstacle_distance', RELIABLE_QOS)
        self._sectors_pub  = self.create_publisher(
            String,  '/lidar/sector_distances',  RELIABLE_QOS)
        self._clear_pub    = self.create_publisher(
            Bool,    '/lidar/clear_to_move',     RELIABLE_QOS)

        # ---- Subscriber ----
        self.create_subscription(
            LaserScan, '/scan', self._scan_cb, BEST_EFFORT_QOS)

        self.get_logger().info(
            f'LidarNode started – safety_dist={self._safety_dist}m')

    # ------------------------------------------------------------------
    def _scan_cb(self, msg: LaserScan):
        ranges   = msg.ranges
        angle_min = msg.angle_min
        angle_inc = msg.angle_increment
        r_min    = msg.range_min
        r_max    = msg.range_max

        # ---- Overall nearest obstacle ----
        valid = [r for r in ranges if r_min < r < r_max and math.isfinite(r)]
        nearest = min(valid) if valid else -1.0

        # ---- Sector distances ----
        sector_dists: dict[str, float] = {}
        for name, centre_deg in SECTORS.items():
            centre_rad = math.radians(centre_deg)
            lo = centre_rad - self._sector_half_w
            hi = centre_rad + self._sector_half_w

            sector_ranges = []
            for i, r in enumerate(ranges):
                if not (r_min < r < r_max and math.isfinite(r)):
                    continue
                beam_angle = angle_min + i * angle_inc
                # Normalise to -π … π
                diff = (beam_angle - centre_rad + math.pi) % (2 * math.pi) - math.pi
                if abs(diff) <= self._sector_half_w:
                    sector_ranges.append(r)

            sector_dists[name] = round(min(sector_ranges), 2) if sector_ranges else -1.0

        # ---- Clear-to-move flag ----
        front_dist = sector_dists.get('front', -1.0)
        clear = (front_dist < 0) or (front_dist > self._safety_dist)

        # ---- Publish ----
        obs_msg = Float32()
        obs_msg.data = float(nearest)
        self._obstacle_pub.publish(obs_msg)

        sec_msg = String()
        sec_msg.data = json.dumps(sector_dists)
        self._sectors_pub.publish(sec_msg)

        clr_msg = Bool()
        clr_msg.data = clear
        self._clear_pub.publish(clr_msg)


def main(args=None):
    rclpy.init(args=args)
    node = LidarNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
