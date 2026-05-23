'use client'
import { motion } from 'framer-motion'
import { Wifi, WifiOff, Battery, Thermometer, Mic, MicOff, Camera, CameraOff } from 'lucide-react'
import useRobotStore from '../../store/robot'

function StatusPill({ icon: Icon, label, active, color = '#FF9F1C' }) {
  return (
    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all
      ${active ? 'bg-white shadow-card border border-surface-border' : 'bg-transparent'}`}
      style={{ color: active ? color : '#9E9890' }}
    >
      <Icon size={12} />
      <span>{label}</span>
    </div>
  )
}

function BatteryIndicator({ level }) {
  const color = level > 40 ? '#22c55e' : level > 20 ? '#FF9F1C' : '#FF5A5F'
  return (
    <div className="flex items-center gap-2">
      <div className="relative w-8 h-4 rounded border-2 border-surface-border bg-surface-soft overflow-hidden">
        <motion.div
          className="h-full rounded-sm"
          style={{ background: color }}
          animate={{ width: `${level}%` }}
          transition={{ duration: 0.8 }}
        />
        <div className="absolute -right-1.5 top-1/2 -translate-y-1/2 w-1.5 h-2 rounded-r bg-surface-border" />
      </div>
      <span className="text-xs font-mono" style={{ color }}>{level}%</span>
    </div>
  )
}

export default function Header() {
  const {
    rosConnected, wsConnected, simulatorMode,
    battery, temperature,
    micActive, cameraActive, lidarActive,
    emotion,
    setMicActive, setCameraActive,
  } = useRobotStore()

  const connected = rosConnected || wsConnected

  return (
    <header className="bg-white border-b border-surface-border px-6 py-3">
      <div className="flex items-center justify-between max-w-screen-2xl mx-auto">

        {/* Logo / Identité */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: '#050505' }}>
            <div className="w-3 h-3 rounded-full" style={{ background: '#FF9F1C' }} />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-wide text-robot-black">African Robot</div>
            <div className="text-xs text-surface-muted">
              {simulatorMode ? 'Mode Simulateur' : 'Robot Connecté'}
            </div>
          </div>
        </div>

        {/* État central */}
        <div className="flex items-center gap-2">
          <motion.div
            className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium"
            style={{
              background: connected ? '#F0FDF4' : '#FFF8F0',
              color:      connected ? '#16a34a' : '#FF9F1C',
              border:     `1px solid ${connected ? '#bbf7d0' : '#fde68a'}`,
            }}
            animate={{ opacity: [0.8, 1, 0.8] }}
            transition={{ duration: 2.5, repeat: Infinity }}
          >
            {connected ? <Wifi size={11} /> : <WifiOff size={11} />}
            {connected ? 'ROS2 Connecté' : simulatorMode ? 'Simulation' : 'Hors ligne'}
          </motion.div>

          <div className="h-4 w-px bg-surface-border" />

          {/* Émotion courante */}
          <div className="px-3 py-1.5 rounded-full text-xs font-medium bg-surface-soft border border-surface-border text-surface-muted uppercase tracking-widest">
            {emotion}
          </div>
        </div>

        {/* Contrôles & Métriques */}
        <div className="flex items-center gap-4">
          <BatteryIndicator level={battery} />

          <div className="flex items-center gap-1.5 text-xs text-surface-muted">
            <Thermometer size={12} />
            <span className="font-mono">{temperature}°C</span>
          </div>

          <div className="h-4 w-px bg-surface-border" />

          {/* Mic toggle */}
          <button
            onClick={() => setMicActive(!micActive)}
            className={`p-2 rounded-xl transition-all ${micActive
              ? 'bg-red-50 text-robot-red border border-red-100'
              : 'bg-surface-soft text-surface-muted border border-surface-border'
            }`}
          >
            {micActive ? <Mic size={14} /> : <MicOff size={14} />}
          </button>

          {/* Camera toggle */}
          <button
            onClick={() => setCameraActive(!cameraActive)}
            className={`p-2 rounded-xl transition-all ${cameraActive
              ? 'bg-blue-50 text-robot-blue border border-blue-100'
              : 'bg-surface-soft text-surface-muted border border-surface-border'
            }`}
          >
            {cameraActive ? <Camera size={14} /> : <CameraOff size={14} />}
          </button>
        </div>
      </div>
    </header>
  )
}
