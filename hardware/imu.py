"""
Abstraction IMU — Sprint 3.
MPU-6050 via smbus2 (filtre complémentaire), BNO055 via Adafruit, fallback simulé.
"""

import logging
import math
import time
from abc import ABC, abstractmethod

log = logging.getLogger(__name__)


# ── Interface commune ─────────────────────────────────────────────────────────

class IMUBase(ABC):
    @abstractmethod
    def get_angle(self) -> float:
        """Inclinaison en degrés (0 = vertical, + = penché en avant)."""

    @abstractmethod
    def get_angular_velocity(self) -> float:
        """Vitesse angulaire en °/s."""

    def close(self):
        pass


# ── MPU-6050 (I²C) ────────────────────────────────────────────────────────────

class MPU6050(IMUBase):
    """
    MPU-6050 via smbus2.
    Filtre complémentaire : angle = α*(angle + ω·dt) + (1-α)*accel_angle
    """

    # Registres
    PWR_MGMT_1   = 0x6B
    ACCEL_XOUT_H = 0x3B
    GYRO_XOUT_H  = 0x43
    GYRO_CONFIG  = 0x1B
    ACCEL_CONFIG = 0x1C

    # Échelles (configuration par défaut ±2g / ±250°/s)
    ACCEL_SCALE = 16384.0
    GYRO_SCALE  = 131.0

    def __init__(self, bus: int = 1, addr: int = 0x68,
                 alpha: float = 0.98, angle_offset: float = 0.0):
        import smbus2
        self._bus    = smbus2.SMBus(bus)
        self._addr   = addr
        self._alpha  = alpha
        self._offset = angle_offset

        # Réveil
        self._bus.write_byte_data(self._addr, self.PWR_MGMT_1, 0x00)
        time.sleep(0.1)

        self._angle    = 0.0
        self._gyro_x   = 0.0
        self._last_t   = time.time()
        self._gyro_off = 0.0

        self._calibrate()
        log.info("MPU-6050 prêt — bus=%d addr=0x%02X offset_gyro=%.4f",
                 bus, addr, self._gyro_off)

    def _read_word(self, reg: int) -> int:
        hi = self._bus.read_byte_data(self._addr, reg)
        lo = self._bus.read_byte_data(self._addr, reg + 1)
        v  = (hi << 8) | lo
        return v - 65536 if v > 32767 else v

    def _calibrate(self, n: int = 200):
        """Mesure l'offset du gyroscope à l'arrêt."""
        log.info("Calibration IMU — ne pas bouger le robot...")
        total = 0.0
        for _ in range(n):
            total += self._read_word(self.GYRO_XOUT_H) / self.GYRO_SCALE
            time.sleep(0.005)
        self._gyro_off = total / n

    def _update(self):
        now = time.time()
        dt  = now - self._last_t
        self._last_t = now

        ax = self._read_word(self.ACCEL_XOUT_H)     / self.ACCEL_SCALE
        ay = self._read_word(self.ACCEL_XOUT_H + 2) / self.ACCEL_SCALE
        az = self._read_word(self.ACCEL_XOUT_H + 4) / self.ACCEL_SCALE
        gx = self._read_word(self.GYRO_XOUT_H)      / self.GYRO_SCALE

        self._gyro_x = gx - self._gyro_off

        # Angle accéléromètre (pitch autour de l'axe X)
        accel_angle = math.degrees(math.atan2(ay, math.sqrt(ax * ax + az * az)))

        # Filtre complémentaire
        self._angle = (self._alpha * (self._angle + self._gyro_x * dt)
                       + (1 - self._alpha) * accel_angle)

    def get_angle(self) -> float:
        self._update()
        return self._angle - self._offset

    def get_angular_velocity(self) -> float:
        return self._gyro_x

    def close(self):
        self._bus.close()


# ── BNO055 (Adafruit CircuitPython) ──────────────────────────────────────────

class BNO055(IMUBase):
    """
    BNO055 9-DOF IMU — fusion intégrée, angle euler direct.
    Nécessite adafruit-circuitpython-bno055.
    """

    def __init__(self, angle_offset: float = 0.0):
        import board
        import busio
        import adafruit_bno055
        i2c = busio.I2C(board.SCL, board.SDA)
        self._sensor = adafruit_bno055.BNO055_I2C(i2c)
        self._offset = angle_offset
        self._gyro_y = 0.0
        log.info("BNO055 prêt")

    def get_angle(self) -> float:
        euler = self._sensor.euler
        pitch = euler[1] if euler else 0.0
        return pitch - self._offset

    def get_angular_velocity(self) -> float:
        gyro = self._sensor.gyro
        self._gyro_y = math.degrees(gyro[1]) if gyro else 0.0
        return self._gyro_y

    def close(self):
        pass


# ── IMU simulé (stub pour tests sans hardware) ────────────────────────────────

class SimulatedIMU(IMUBase):
    def __init__(self):
        self._angle = 0.0
        self._gyro  = 0.0

    def set_state(self, angle: float, gyro: float):
        self._angle = angle
        self._gyro  = gyro

    def get_angle(self) -> float:
        return self._angle

    def get_angular_velocity(self) -> float:
        return self._gyro


# ── Factory ───────────────────────────────────────────────────────────────────

def create_imu(cfg) -> IMUBase:
    from .config import IMUType
    try:
        if cfg.imu_type == IMUType.MPU6050:
            return MPU6050(cfg.i2c_bus, cfg.mpu6050_addr,
                           cfg.cf_alpha, cfg.angle_offset)
        if cfg.imu_type == IMUType.BNO055:
            return BNO055(cfg.angle_offset)
    except Exception as e:
        log.warning("Impossible d'initialiser IMU %s: %s — fallback simulé", cfg.imu_type, e)
    return SimulatedIMU()
