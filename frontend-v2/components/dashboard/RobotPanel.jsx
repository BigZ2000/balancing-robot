'use client'
import { useCallback } from 'react'
import { motion } from 'framer-motion'
import { getRosBridge, TOPICS } from '../../lib/ros-bridge'
import useRobotStore from '../../store/robot'

function Metric({ label, value, unit, color = '#FF9F1C', max = 100 }) {
  const pct = Math.min(100, Math.abs((value / max) * 100))
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between items-baseline">
        <span className="text-xs text-surface-muted">{label}</span>
        <span className="text-xs font-mono font-semibold" style={{ color }}>
          {typeof value === 'number' ? value.toFixed(1) : value}{unit}
        </span>
      </div>
      <div className="h-1 bg-surface-soft rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4 }}
        />
      </div>
    </div>
  )
}

function PIDSlider({ label, value, min, max, step, onChange }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-mono text-surface-muted w-6">{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="flex-1 accent-robot-amber h-1"
      />
      <span className="text-xs font-mono font-semibold text-robot-amber w-10 text-right">
        {value.toFixed(1)}
      </span>
    </div>
  )
}

function ArmControl() {
  const { armPosition, setArmPosition, simulatorMode } = useRobotStore()

  function sendArm(pos) {
    setArmPosition(pos)
    if (!simulatorMode) {
      getRosBridge()?.publish(TOPICS.ARM_CMD, 'std_msgs/Float32', { data: pos })
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs font-semibold text-surface-muted uppercase tracking-widest">
        Bras — Servo 60KG
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range" min={-100} max={100} step={1}
          value={armPosition}
          onChange={e => sendArm(Number(e.target.value))}
          className="flex-1 accent-robot-teal h-1"
        />
        <span className="text-xs font-mono text-robot-teal w-12 text-right">
          {armPosition > 0 ? '+' : ''}{armPosition}%
        </span>
      </div>
      <div className="flex gap-2">
        {[
          { label: 'Neutre', val: 0 },
          { label: 'Haut',   val: -80 },
          { label: 'Bas',    val: 80 },
        ].map(({ label, val }) => (
          <button
            key={label}
            onClick={() => sendArm(val)}
            className="flex-1 py-1.5 rounded-xl text-xs font-medium bg-surface-soft border border-surface-border
              text-surface-muted hover:border-robot-teal/40 hover:text-robot-teal transition-all"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Pendule SVG simplifié ─────────────────────────────────────────────────────
function PendulumMini({ angle }) {
  const rad = (angle * Math.PI) / 180
  const cx = 60, cy = 55, L = 45
  const wx = cx + Math.sin(rad) * L
  const wy = cy + Math.cos(rad) * L
  const danger = Math.min(1, Math.abs(angle) / 25)
  const color  = `hsl(${(1 - danger) * 120}, 70%, 45%)`

  return (
    <svg width={120} height={110} className="mx-auto">
      <circle cx={cx} cy={cy} r={4} fill="#E8E4DC" />
      <line x1={cx} y1={cy} x2={wx} y2={wy}
        stroke={color} strokeWidth={7} strokeLinecap="round" />
      <ellipse cx={cx + Math.sin(rad)*8} cy={cy + Math.cos(rad)*8 - 5}
        rx={10} ry={12} fill="#3A3530" stroke={color} strokeWidth={1.5} />
      <circle cx={wx} cy={wy} r={12}
        fill="none" stroke="#9E9890" strokeWidth={3} />
      <text x={cx + 14} y={cy} fill={color} fontSize={9} fontFamily="monospace">
        {angle > 0 ? '+' : ''}{angle.toFixed(1)}°
      </text>
    </svg>
  )
}

export default function RobotPanel() {
  const {
    angle, angularVel, speed, battery,
    motorLeft, motorRight,
    pid, setPID, simulatorMode,
  } = useRobotStore()

  const alertAngle = Math.abs(angle) > 20

  function sendPID(updated) {
    const next = { ...pid, ...updated }
    setPID(next)
    if (!simulatorMode) {
      getRosBridge()?.publish(TOPICS.PID_TUNE, 'std_msgs/String', {
        data: JSON.stringify(next),
      })
    }
  }

  return (
    <div className="bg-white rounded-3xl border border-surface-border p-5 shadow-card flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-surface-muted uppercase tracking-widest">
          Robot & Équilibre
        </div>
        {alertAngle && (
          <motion.span
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 0.5, repeat: Infinity }}
            className="text-xs font-bold text-robot-red"
          >
            ⚠ INSTABLE
          </motion.span>
        )}
      </div>

      {/* Pendule */}
      <PendulumMini angle={angle} />

      {/* Métriques */}
      <div className="flex flex-col gap-3">
        <Metric label="Angle"    value={angle}      unit="°"   max={35}  color={alertAngle ? '#FF5A5F' : '#FF9F1C'} />
        <Metric label="Vitesse"  value={Math.abs(speed)} unit="%" max={100} color="#F6C453" />
        <Metric label="Batterie" value={battery}    unit="%"   max={100} color={battery < 20 ? '#FF5A5F' : '#3CCFCF'} />
        <Metric label="Moteur G" value={motorLeft}  unit="%"   max={100} color="#60A5FA" />
        <Metric label="Moteur D" value={motorRight} unit="%"   max={100} color="#60A5FA" />
      </div>

      {/* PID Tuning */}
      <div className="flex flex-col gap-3 pt-2 border-t border-surface-border">
        <div className="text-xs font-semibold text-surface-muted uppercase tracking-widest">
          PID Teensy 4.1
        </div>
        <PIDSlider label="Kp" value={pid.kp} min={0} max={60} step={0.5}
          onChange={v => sendPID({ kp: v })} />
        <PIDSlider label="Ki" value={pid.ki} min={0} max={5}  step={0.05}
          onChange={v => sendPID({ ki: v })} />
        <PIDSlider label="Kd" value={pid.kd} min={0} max={25} step={0.5}
          onChange={v => sendPID({ kd: v })} />
      </div>

      {/* Bras */}
      <div className="pt-2 border-t border-surface-border">
        <ArmControl />
      </div>
    </div>
  )
}
