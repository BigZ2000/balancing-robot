"""
imu_node.py
-----------
Thin wrapper that re-publishes IMU fields from /teensy/telemetry
as a standard sensor_msgs/Imu message.  The actual IMU lives on the
Teensy; this node converts the JSON telemetry into proper ROS2 types
for compatibility with nav/slam tooling.

Topics subscribed
  /teensy/telemetry   (std_msgs/String) – JSON from Teensy

Topics published
  /imu/data           (sensor_msgs/Imu) – standard IMU message
  /imu/angle          (std_msgs/Float32) – filtered pitch angle (deg)
"""

import json
import math

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy

from std_msgs.msg import String, Float32
from sensor_msgs.msg import Imu
from geometry_msgs.msg import Quaternion

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


def euler_to_quaternion(roll: float, pitch: float, yaw: float) -> Quaternion:
    """Convert Euler angles (radians) to a geometry_msgs/Quaternion."""
    cy = math.cos(yaw   * 0.5)
    sy = math.sin(yaw   * 0.5)
    cp = math.cos(pitch * 0.5)
    sp = math.sin(pitch * 0.5)
    cr = math.cos(roll  * 0.5)
    sr = math.sin(roll  * 0.5)

    q = Quaternion()
    q.w = cr * cp * cy + sr * sp * sy
    q.x = sr * cp * cy - cr * sp * sy
    q.y = cr * sp * cy + sr * cp * sy
    q.z = cr * cp * sy - sr * sp * cy
    return q


class ImuNode(Node):

    def __init__(self):
        super().__init__('imu_node')

        self._imu_pub   = self.create_publisher(Imu,    '/imu/data',  BEST_EFFORT_QOS)
        self._angle_pub = self.create_publisher(Float32, '/imu/angle', BEST_EFFORT_QOS)

        self.create_subscription(
            String, '/teensy/telemetry', self._telem_cb, BEST_EFFORT_QOS)

        self.get_logger().info('ImuNode started')

    def _telem_cb(self, msg: String):
        try:
            data = json.loads(msg.data)
        except json.JSONDecodeError:
            return

        angle_deg = float(data.get('angle', 0.0))
        gyro_dps  = float(data.get('gyro',  0.0))

        angle_rad = math.radians(angle_deg)
        gyro_rads = math.radians(gyro_dps)

        # Publish Imu message (pitch only from complementary filter)
        imu_msg = Imu()
        imu_msg.header.stamp    = self.get_clock().now().to_msg()
        imu_msg.header.frame_id = 'imu_link'

        imu_msg.orientation = euler_to_quaternion(0.0, angle_rad, 0.0)

        # Angular velocity — only pitch axis available
        imu_msg.angular_velocity.y = gyro_rads

        # Covariance: diagonal, modest uncertainty
        imu_msg.orientation_covariance[4]         = 0.01   # pitch variance
        imu_msg.angular_velocity_covariance[4]    = 0.005
        imu_msg.linear_acceleration_covariance[0] = -1.0   # unknown

        self._imu_pub.publish(imu_msg)

        # Simple angle float for other consumers
        a_msg = Float32()
        a_msg.data = float(angle_deg)
        self._angle_pub.publish(a_msg)


def main(args=None):
    rclpy.init(args=args)
    node = ImuNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
