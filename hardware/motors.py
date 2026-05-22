"""
Abstraction moteurs — Sprint 3.
VESC via UART/pyvesc, ODrive via USB, fallback simulé.
"""

import logging
from abc import ABC, abstractmethod

log = logging.getLogger(__name__)


# ── Interface commune ─────────────────────────────────────────────────────────

class MotorBase(ABC):
    @abstractmethod
    def set_speed(self, left: float, right: float) -> None:
        """Commande les deux moteurs. Valeurs en % : -100..100."""

    def stop(self) -> None:
        self.set_speed(0.0, 0.0)

    def close(self) -> None:
        self.stop()


# ── VESC (UART + pyvesc) ──────────────────────────────────────────────────────

class VESCMotors(MotorBase):
    """
    Deux VESC sur le même bus UART.
    Moteur gauche : ID 0 (direct).
    Moteur droit  : ID can_id (CAN forwarding depuis le VESC maître).
    """

    def __init__(self, port: str = "/dev/ttyACM0", baud: int = 115200,
                 can_id: int = 1):
        import serial
        import pyvesc
        self._pyvesc = pyvesc
        self._ser    = serial.Serial(port, baud, timeout=0.05)
        self._can_id = can_id
        self.stop()
        log.info("VESC connecté sur %s (baud=%d, CAN right=%d)", port, baud, can_id)

    def _duty(self, pct: float) -> float:
        return max(-1.0, min(1.0, pct / 100.0))

    def set_speed(self, left: float, right: float) -> None:
        pv = self._pyvesc

        # Moteur gauche (maître direct)
        self._ser.write(pv.encode(pv.SetDutyCycle(self._duty(left))))

        # Moteur droit via CAN forwarding
        msg_right = pv.SetDutyCycle(self._duty(right))
        self._ser.write(pv.encode_request(self._can_id, msg_right))

    def close(self):
        self.stop()
        self._ser.close()


# ── ODrive (USB) ──────────────────────────────────────────────────────────────

class ODriveMotors(MotorBase):
    """
    ODrive v3.6+ via USB.
    axis0 = roue gauche, axis1 = roue droite (inversée mécaniquement).
    Contrôle en vitesse (tours/s). Tune max_turns selon ton montage.
    """

    MAX_TURNS = 5.0   # tours/s à 100 % de commande

    def __init__(self):
        import odrive
        log.info("Recherche ODrive...")
        self._od = odrive.find_any(timeout=15)
        for axis in (self._od.axis0, self._od.axis1):
            axis.controller.config.control_mode = 2   # VELOCITY_CONTROL
            axis.requested_state = 8                   # CLOSED_LOOP_CONTROL
        log.info("ODrive connecté firmware v%d.%d",
                 self._od.fw_version_major, self._od.fw_version_minor)

    def set_speed(self, left: float, right: float) -> None:
        vel_l =  (left  / 100.0) * self.MAX_TURNS
        vel_r = -(right / 100.0) * self.MAX_TURNS   # inversé
        self._od.axis0.controller.input_vel = vel_l
        self._od.axis1.controller.input_vel = vel_r

    def close(self):
        self.stop()
        self._od.axis0.requested_state = 1   # IDLE
        self._od.axis1.requested_state = 1


# ── Moteurs simulés ───────────────────────────────────────────────────────────

class SimulatedMotors(MotorBase):
    def set_speed(self, left: float, right: float) -> None:
        pass   # no-op


# ── Factory ───────────────────────────────────────────────────────────────────

def create_motors(cfg) -> MotorBase:
    from .config import MotorType
    try:
        if cfg.motor_type == MotorType.VESC:
            return VESCMotors(cfg.vesc_port, cfg.vesc_baud, cfg.vesc_can_id)
        if cfg.motor_type == MotorType.ODRIVE:
            return ODriveMotors()
    except Exception as e:
        log.warning("Impossible d'initialiser moteurs %s: %s — fallback simulé",
                    cfg.motor_type, e)
    return SimulatedMotors()
