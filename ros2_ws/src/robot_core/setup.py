from setuptools import find_packages, setup
import os
from glob import glob

package_name = 'robot_core'

setup(
    name=package_name,
    version='0.1.0',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages',
            ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        # Install launch files
        (os.path.join('share', package_name, 'launch'),
            glob(os.path.join('launch', '*.launch.py'))),
        # Install config files if present
        (os.path.join('share', package_name, 'config'),
            glob(os.path.join('config', '*.yaml'))),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='robot',
    maintainer_email='robot@robot.local',
    description='Core package for the African Mask Balancing Robot',
    license='MIT',
    tests_require=['pytest'],
    entry_points={
        'console_scripts': [
            # Hardware interface nodes
            'balance_node   = robot_core.balance_node:main',
            'imu_node       = robot_core.imu_node:main',
            'arm_node       = robot_core.arm_node:main',

            # AI / speech nodes
            'emotion_node   = robot_core.emotion_node:main',
            'speech_node    = robot_core.speech_node:main',
            'tts_node       = robot_core.tts_node:main',
            'stt_node       = robot_core.stt_node:main',
            'ai_brain_node  = robot_core.ai_brain_node:main',

            # Perception nodes
            'face_node      = robot_core.face_node:main',
            'vision_node    = robot_core.vision_node:main',
            'lidar_node     = robot_core.lidar_node:main',

            # Dashboard / telemetry
            'dashboard_node = robot_core.dashboard_node:main',
        ],
    },
)
