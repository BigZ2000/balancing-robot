"""
Boucle d'équilibre hardware — Sprint 3.
Remplace pid_sim.py sur Raspberry Pi (même interface publique).
"""

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Callable, List

from .config import config as hw_config, HardwareConfig
from .imu import IMUBase, create_imu
from .motors import MotorBase, create_motors

log = logging.getLogger(__name__)


@dataclass
class PIDState:
    kp: float = 28.0
    ki: float = 0.8
    kd: float = 4.5
    setpoint: float = 0.0

    _error_sum:  float = field(default=0.0,              repr=False)
    _last_error: float = field(default=0.0,              repr=False)
    _last_t:     float = field(default_factory=time.time, repr=False)

    def reset(self):
        self._error_sum  = 0.0
        self._last_error = 0.0
        self._last_t     = time.time()

    def update(self, measured: float) -> float:
        now = time.time()
        dt  = max(now - self._last_t, 0.001)
        self._last_t = now

        error            = self.setpoint - measured
        self._error_sum  = max(-50.0, min(50.0, self._error_sum + error * dt))
        d_error          = (error - self._last_error) / dt
        self._last_error = error

        out = self.kp * error + self.ki * self._error_sum + self.kd * d_error
        return max(-100.0, min(100.0, out))


class HardwareBalanceController:
    """
    Orchestre IMU réel + moteurs réels + PID.
    Interface identique à pid_sim.BalanceController pour pouvoir être
    interchangé dans backend/main.py.
    """

    def __init__(self, cfg: HardwareConfig = hw_config):
        self.cfg     = cfg
        self.pid     = PIDState(kp=cfg.kp, ki=cfg.ki, kd=cfg.kd)
        self.imu:    IMUBase   = None
        self.motors: MotorBase = None
        self.running = False

        # Télémétrie publique (lue par get_telemetry)
        self.angle       = 0.0
        self.angular_vel = 0.0
        self.motor_out   = 0.0
        self.speed       = 0.0
        self.battery     = 100.0   # TODO : lire ADC batterie

        self.target_speed = 0.0
        self.target_turn  = 0.0
        self.history: List[dict] = []

        self._safety_triggered = False

    # ── Init hardware ────────────────────────────────────────────────────────

    def init_hardware(self):
        log.info("Initialisation hardware...")
        self.imu    = create_imu(self.cfg)
        self.motors = create_motors(self.cfg)
        log.info("Hardware prêt")

    # ── Commande ─────────────────────────────────────────────────────────────

    def command(self, speed: float = 0.0, turn: float = 0.0):
        self.target_speed = max(-100.0, min(100.0, speed))
        self.target_turn  = max(-100.0, min(100.0, turn))
        # Setpoint : avancer = légèrement incliné vers l'avant
        self.pid.setpoint = self.target_speed * 0.03

    # ── Télémétrie ────────────────────────────────────────────────────────────

    def get_telemetry(self) -> dict:
        return {
            'angle':        round(self.angle, 2),
            'angular_vel':  round(self.angular_vel, 2),
            'speed':        round(self.speed, 1),
            'motor':        round(self.motor_out, 1),
            'battery':      round(self.battery, 1),
            'pid_kp':       self.pid.kp,
            'pid_ki':       self.pid.ki,
            'pid_kd':       self.pid.kd,
            'setpoint':     self.pid.setpoint,
            'disturbance':  0.0,   # pas de perturbation simulée
        }

    # ── Boucle principale ────────────────────────────────────────────────────

    async def run_loop(self, broadcast_fn: Callable):
        """Boucle PID à cfg.loop_hz Hz, broadcast telemetry via callback."""
        if self.imu is None or self.motors is None:
            self.init_hardware()

        self.running = True
        dt = 1.0 / self.cfg.loop_hz
        log.info("Boucle balance démarrée à %d Hz", self.cfg.loop_hz)

        while self.running:
            t0 = time.time()

            # 1 — Lecture IMU
            self.angle       = self.imu.get_angle()
            self.angular_vel = self.imu.get_angular_velocity()

            # 2 — Sécurité anti-chute
            if abs(self.angle) > self.cfg.max_angle:
                if not self._safety_triggered:
                    log.warning("Coupure sécurité — angle=%.1f°", self.angle)
                    self._safety_triggered = True
                self.motors.stop()
                self.motor_out = 0.0
            else:
                self._safety_triggered = False

                # 3 — PID
                self.motor_out = self.pid.update(self.angle)
                clamped = max(-self.cfg.max_motor_pct,
                              min(self.cfg.max_motor_pct, self.motor_out))

                # 4 — Mélange vitesse / virage
                left  = clamped + self.target_turn * 0.4
                right = clamped - self.target_turn * 0.4
                self.motors.set_speed(left, right)

            self.speed = self.motor_out

            # 5 — Historique + broadcast
            telem          = self.get_telemetry()
            telem['type']  = 'telemetry'
            telem['motor'] = round(self.motor_out, 1)

            self.history.append({
                't':     time.time(),
                'angle': self.angle,
                'motor': self.motor_out,
            })
            if len(self.history) > 100:
                self.history.pop(0)

            await broadcast_fn(telem)

            # 6 — Sleep précis
            elapsed = time.time() - t0
            await asyncio.sleep(max(0.0, dt - elapsed))

    def stop_loop(self):
        self.running = False
        if self.motors:
            self.motors.stop()
        if self.imu:
            self.imu.close()


# Singleton
hardware_controller = HardwareBalanceController()
