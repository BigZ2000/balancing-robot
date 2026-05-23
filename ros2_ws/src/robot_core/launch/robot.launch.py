"""
robot.launch.py
---------------
Main ROS2 launch file for the African Mask Balancing Robot.

Environment variables
  SIMULATION=true   – skip hardware nodes (serial_bridge, lidar_node)
  ROBOT_LOG_LEVEL   – log level for all nodes, default "info"
  OLLAMA_MODEL      – override the Ollama model name, default "llama3"
  STT_MODEL         – Whisper model size, default "small"
  CAMERA_INDEX      – OpenCV camera index, default "0"
  NO_YOLO           – set to "1" to disable YOLOv8
"""

import os
from launch import LaunchDescription
from launch.actions import (
    DeclareLaunchArgument,
    GroupAction,
    IncludeLaunchDescription,
    LogInfo,
    OpaqueFunction,
    SetEnvironmentVariable,
)
from launch.conditions import IfCondition, UnlessCondition
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import (
    EnvironmentVariable,
    LaunchConfiguration,
    PathJoinSubstitution,
)
from launch_ros.actions import Node
from launch_ros.substitutions import FindPackageShare


# ---------------------------------------------------------------------------
# Helper: read env with fallback
# ---------------------------------------------------------------------------
def _env(name: str, default: str = '') -> str:
    return os.environ.get(name, default)


SIMULATION  = _env('SIMULATION', 'false').lower() in ('true', '1', 'yes')
LOG_LEVEL   = _env('ROBOT_LOG_LEVEL', 'info')
OLLAMA_MODEL = _env('OLLAMA_MODEL', 'llama3')
STT_MODEL   = _env('STT_MODEL', 'small')
CAMERA_IDX  = int(_env('CAMERA_INDEX', '0'))
YOLO_ON     = _env('NO_YOLO', '0') not in ('1', 'true', 'yes')


# ---------------------------------------------------------------------------
def generate_launch_description():

    pkg = 'robot_core'

    # ------------------------------------------------------------------
    # Common node arguments
    # ------------------------------------------------------------------
    def make_node(executable, name=None, parameters=None, remappings=None):
        return Node(
            package=pkg,
            executable=executable,
            name=name or executable,
            output='screen',
            emulate_tty=True,
            arguments=['--ros-args', '--log-level', LOG_LEVEL],
            parameters=parameters or [],
            remappings=remappings or [],
        )

    # ------------------------------------------------------------------
    # Hardware nodes (skip in simulation)
    # ------------------------------------------------------------------
    hardware_nodes = []

    if not SIMULATION:
        hardware_nodes += [
            # USB Serial bridge to Teensy
            make_node('serial_bridge', parameters=[{
                'port': '/dev/ttyACM0',
                'baud': 115200,
                'reconnect_delay': 2.0,
            }]),

            # LIDAR node (rplidar_ros package – launched separately below)
        ]
    else:
        hardware_nodes.append(
            LogInfo(msg='[SIMULATION=true] Skipping hardware nodes'))

    # ------------------------------------------------------------------
    # Core robot nodes (always launched)
    # ------------------------------------------------------------------
    core_nodes = [
        # Balance monitor
        make_node('balance_node', parameters=[{
            'kp': 25.0,
            'ki': 0.5,
            'kd': 8.0,
            'max_angle': 35.0,
        }]),

        # Arm controller
        make_node('arm_node', parameters=[{
            'lerp_rate':   0.12,
            'speed_scale': 1.0,
        }]),

        # Emotion state machine
        make_node('emotion_node', parameters=[{
            'transition_delay_s': 0.8,
        }]),

        # AI brain (Ollama)
        make_node('ai_brain_node', parameters=[{
            'ollama_url':      'http://localhost:11434',
            'model':           OLLAMA_MODEL,
            'max_history':     10,
            'request_timeout': 30.0,
        }]),

        # TTS
        make_node('tts_node', parameters=[{
            'engine':        'auto',
            'kokoro_voice':  'af_bella',
            'edge_voice':    'en-US-AriaNeural',
            'volume':        0.85,
            'speed':         1.0,
        }]),

        # STT
        make_node('stt_node', parameters=[{
            'model_size':       STT_MODEL,
            'device':           'cpu',
            'compute_type':     'int8',
            'sample_rate':      16000,
            'chunk_ms':         30,
            'energy_threshold': 500,
            'silence_ms':       800,
            'min_speech_ms':    300,
            'language':         'en',
        }]),

        # Vision
        make_node('vision_node', parameters=[{
            'camera_index':    CAMERA_IDX,
            'width':           640,
            'height':          480,
            'fps':             30,
            'publish_frames':  True,
            'frame_skip':      3,
            'yolo_enabled':    YOLO_ON,
            'yolo_model':      'yolov8n.pt',
            'focal_length_px': 700.0,
            'face_width_m':    0.15,
        }]),

        # Face expression renderer (face_node)
        make_node('face_node'),

        # Dashboard WebSocket relay
        make_node('dashboard_node'),
    ]

    # ------------------------------------------------------------------
    # RPLIDAR C1 – launched via rplidar_ros if not simulation
    # ------------------------------------------------------------------
    lidar_nodes = []
    if not SIMULATION:
        try:
            from ament_index_python.packages import get_package_share_directory
            rplidar_pkg = get_package_share_directory('rplidar_ros')
            lidar_nodes.append(
                Node(
                    package='rplidar_ros',
                    executable='rplidar_node',
                    name='rplidar_node',
                    output='screen',
                    parameters=[{
                        'serial_port': '/dev/ttyUSB0',
                        'serial_baudrate': 460800,
                        'frame_id': 'laser',
                        'angle_compensate': True,
                        'scan_mode': 'Standard',
                    }],
                )
            )
        except Exception:
            lidar_nodes.append(
                LogInfo(msg='rplidar_ros not found – LIDAR disabled'))

    # ------------------------------------------------------------------
    # rosbridge_server for WebSocket dashboard (port 9090)
    # ------------------------------------------------------------------
    rosbridge_nodes = []
    try:
        from ament_index_python.packages import get_package_share_directory
        get_package_share_directory('rosbridge_server')
        rosbridge_nodes.append(
            Node(
                package='rosbridge_server',
                executable='rosbridge_websocket',
                name='rosbridge_websocket',
                output='screen',
                parameters=[{
                    'port': 9090,
                    'address': '0.0.0.0',
                    'retry_startup_delay': 5.0,
                    'fragment_timeout': 600,
                    'delay_between_messages': 0,
                    'max_message_size': 10_000_000,
                    'unregister_timeout': 10.0,
                    'use_compression': False,
                }],
            )
        )
        rosbridge_nodes.append(
            Node(
                package='rosbridge_server',
                executable='rosapi_node',
                name='rosapi',
                output='screen',
            )
        )
    except Exception:
        rosbridge_nodes.append(
            LogInfo(msg='rosbridge_server not found – WebSocket bridge disabled'))

    # ------------------------------------------------------------------
    # Assemble launch description
    # ------------------------------------------------------------------
    return LaunchDescription(
        [LogInfo(msg=f'Launching African Mask Balancing Robot '
                     f'[simulation={SIMULATION}]')]
        + hardware_nodes
        + core_nodes
        + lidar_nodes
        + rosbridge_nodes
    )
