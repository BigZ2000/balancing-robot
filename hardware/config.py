"""
Hardware configuration — Sprint 3.
Overridable via environment variables or config.json.
"""

import json
import os
from dataclasses import dataclass
from enum import Enum
from pathlib import Path


class IMUType(str, Enum):
    MPU6050   = "mpu6050"
    BNO055    = "bno055"
    SIMULATED = "simulated"


class MotorType(str, Enum):
    VESC      = "vesc"
    ODRIVE    = "odrive"
    SIMULATED = "simulated"


@dataclass
class HardwareConfig:
    # ── IMU ──────────────────────────────────────────────────────────────────
    imu_type:     IMUType = IMUType.MPU6050
    i2c_bus:      int     = 1
    mpu6050_addr: int     = 0x68

    # ── Moteurs ───────────────────────────────────────────────────────────────
    motor_type:  MotorType = MotorType.SIMULATED
    vesc_port:   str       = "/dev/ttyACM0"
    vesc_baud:   int       = 115200
    vesc_can_id: int       = 1          # CAN ID du moteur droit

    # ── PID par défaut (à tuner selon le robot physique) ────────────────────
    kp: float = 28.0
    ki: float = 0.8
    kd: float = 4.5

    # ── Sécurité ─────────────────────────────────────────────────────────────
    max_angle:     float = 30.0    # °  — coupe moteurs si dépassé
    max_motor_pct: float = 95.0    # %  — limite de commande moteur

    # ── Boucle de contrôle ────────────────────────────────────────────────────
    loop_hz: int = 100             # Hz — fréquence de la boucle PID

    # ── Filtre complémentaire IMU ────────────────────────────────────────────
    cf_alpha:    float = 0.98      # coefficient filtre (gyro vs accel)
    angle_offset: float = 0.0     # décalage si le robot n'est pas parfaitement droit


def _load_config() -> HardwareConfig:
    """Charge depuis config.json si présent, sinon defaults + env vars."""
    cfg = HardwareConfig()

    # config.json optionnel à côté de ce fichier
    cfg_path = Path(__file__).parent / "config.json"
    if cfg_path.exists():
        try:
            data = json.loads(cfg_path.read_text())
            for k, v in data.items():
                if hasattr(cfg, k):
                    setattr(cfg, k, v)
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning("config.json parse error: %s", e)

    # Variables d'environnement (priorité max)
    if os.getenv("ROBOT_IMU"):
        cfg.imu_type = IMUType(os.getenv("ROBOT_IMU"))
    if os.getenv("ROBOT_MOTORS"):
        cfg.motor_type = MotorType(os.getenv("ROBOT_MOTORS"))
    if os.getenv("ROBOT_VESC_PORT"):
        cfg.vesc_port = os.getenv("ROBOT_VESC_PORT")
    if os.getenv("ROBOT_MAX_ANGLE"):
        cfg.max_angle = float(os.getenv("ROBOT_MAX_ANGLE"))

    return cfg


config = _load_config()
