"""
PID Controller + Balance Simulator — Sprint 2
Simule le comportement d'un robot balançant sur roues de hoverboard.
En Sprint 3, ce module pilote les vrais moteurs via UART/ODrive.
"""

import asyncio
import math
import time
from dataclasses import dataclass, field
from typing import List


@dataclass
class PIDState:
    kp: float = 28.0    # Proportionnel
    ki: float = 0.8     # Intégral
    kd: float = 4.5     # Dérivé
    setpoint: float = 0.0  # angle cible (°)

    _error_sum: float = field(default=0.0, repr=False)
    _last_error: float = field(default=0.0, repr=False)
    _last_t: float = field(default_factory=time.time, repr=False)

    def reset(self):
        self._error_sum = 0.0
        self._last_error = 0.0
        self._last_t = time.time()

    def update(self, measured: float) -> float:
        now = time.time()
        dt = max(now - self._last_t, 0.001)
        self._last_t = now

        error = self.setpoint - measured
        self._error_sum = max(-50.0, min(50.0, self._error_sum + error * dt))
        d_error = (error - self._last_error) / dt
        self._last_error = error

        output = self.kp * error + self.ki * self._error_sum + self.kd * d_error
        return max(-100.0, min(100.0, output))


@dataclass
class RobotPhysics:
    """
    Pendule inversé simplifié.
    angle = tilt en degrés (0 = vertical)
    velocity = vitesse angulaire (°/s)
    """
    angle: float = 0.0
    angular_vel: float = 0.0
    position: float = 0.0   # position linéaire (m)
    speed: float = 0.0      # vitesse (m/s)
    battery: float = 100.0

    # Physique
    g: float = 9.81
    L: float = 0.45      # hauteur du robot (m)
    mass: float = 4.0    # kg
    friction: float = 0.15

    # Perturbation externe (pour simulation)
    disturbance: float = 0.0
    _dist_timer: float = 0.0

    def step(self, motor_output: float, dt: float = 0.02) -> None:
        # Perturbation aléatoire périodique
        self._dist_timer += dt
        if self._dist_timer > 8.0:
            self._dist_timer = 0.0
            self.disturbance = (math.sin(time.time()) * 2.5)

        # Équation du pendule inversé : θ'' = (g/L)sinθ - u/mL² - friction*θ'
        torque = motor_output * 0.015  # moteur → couple
        angular_acc = (
            (self.g / self.L) * math.sin(math.radians(self.angle))
            - torque
            - self.friction * self.angular_vel
            + self.disturbance * 0.1
        )

        self.angular_vel += angular_acc * dt
        self.angle += self.angular_vel * dt

        # Limiter — si trop incliné, le robot "tombe"
        self.angle = max(-35.0, min(35.0, self.angle))

        # Position linéaire
        self.speed = motor_output * 0.05
        self.position += self.speed * dt

        # Batterie se décharge avec l'effort moteur
        self.battery = max(0.0, self.battery - abs(motor_output) * 0.00005 * dt)


class BalanceController:
    """Orchestre PID + physique + état pour la télémétrie WebSocket."""

    def __init__(self):
        self.pid = PIDState()
        self.physics = RobotPhysics()
        self.running = False
        self.target_speed = 0.0   # commande de vitesse (−100..100)
        self.target_turn = 0.0    # commande de virage
        self.history: List[dict] = []  # dernières 100 mesures

    def command(self, speed: float = 0.0, turn: float = 0.0):
        self.target_speed = max(-100.0, min(100.0, speed))
        self.target_turn  = max(-100.0, min(100.0, turn))
        # Setpoint PID : avancer = légèrement incliné vers l'avant
        self.pid.setpoint = self.target_speed * 0.03

    def get_telemetry(self) -> dict:
        return {
            'angle':      round(self.physics.angle, 2),
            'angular_vel': round(self.physics.angular_vel, 2),
            'speed':      round(self.physics.speed * 100, 1),
            'position':   round(self.physics.position, 3),
            'battery':    round(self.physics.battery, 1),
            'pid_kp':     self.pid.kp,
            'pid_ki':     self.pid.ki,
            'pid_kd':     self.pid.kd,
            'setpoint':   self.pid.setpoint,
            'disturbance': round(self.physics.disturbance, 2),
        }

    async def run_loop(self, broadcast_fn):
        """Boucle de contrôle à 50Hz avec broadcast WebSocket."""
        self.running = True
        dt = 0.02
        while self.running:
            motor_out = self.pid.update(self.physics.angle)
            self.physics.step(motor_out, dt)

            telem = self.get_telemetry()
            telem['type'] = 'telemetry'
            telem['motor'] = round(motor_out, 1)

            # Garder historique des 100 derniers points
            self.history.append({'t': time.time(), 'angle': telem['angle'], 'motor': telem['motor']})
            if len(self.history) > 100:
                self.history.pop(0)

            await broadcast_fn(telem)
            await asyncio.sleep(dt)

    def stop_loop(self):
        self.running = False


# Singleton
controller = BalanceController()
