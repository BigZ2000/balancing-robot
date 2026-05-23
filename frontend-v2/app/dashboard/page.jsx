'use client'
import { useEffect } from 'react'
import { useRosBridge } from '../../hooks/useRosBridge'
import Header from '../../components/dashboard/Header'
import EmotionBar from '../../components/dashboard/EmotionBar'
import FacePanel from '../../components/dashboard/FacePanel'
import VoicePanel from '../../components/dashboard/VoicePanel'
import RobotPanel from '../../components/dashboard/RobotPanel'
import SimulatorPanel from '../../components/dashboard/SimulatorPanel'
import useRobotStore from '../../store/robot'

export default function Dashboard() {
  // Connexion ROSBridge (no-op en mode simulateur)
  useRosBridge()

  const { simulatorMode, setSimulatorMode } = useRobotStore()

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <Header />

      <main className="flex-1 p-4 lg:p-6 max-w-screen-2xl mx-auto w-full">
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_300px] gap-4 h-full">

          {/* ── Colonne gauche : émotions ─────────────────────────────────── */}
          <aside className="flex flex-col gap-4">
            <EmotionBar />

            {/* Toggle simulateur */}
            <div className="bg-white rounded-3xl border border-surface-border p-4 shadow-card">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-robot-black">Mode Simulateur</div>
                  <div className="text-xs text-surface-muted mt-0.5">Sans robot physique</div>
                </div>
                <button
                  onClick={() => setSimulatorMode(!simulatorMode)}
                  className={`relative w-10 h-6 rounded-full transition-colors ${
                    simulatorMode ? 'bg-robot-amber' : 'bg-surface-border'
                  }`}
                >
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                    simulatorMode ? 'translate-x-5' : 'translate-x-1'
                  }`} />
                </button>
              </div>
            </div>
          </aside>

          {/* ── Centre : visage + simulateur ─────────────────────────────── */}
          <section className="flex flex-col gap-4">
            <div className="bg-white rounded-3xl border border-surface-border shadow-card overflow-hidden p-6">
              <FacePanel />
            </div>

            <SimulatorPanel />
          </section>

          {/* ── Colonne droite : voix + robot ────────────────────────────── */}
          <aside className="flex flex-col gap-4">
            <div className="flex-1 min-h-0" style={{ minHeight: 320 }}>
              <VoicePanel />
            </div>
            <RobotPanel />
          </aside>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-surface-border px-6 py-3 bg-white">
        <div className="flex items-center justify-between text-xs text-surface-muted max-w-screen-2xl mx-auto">
          <span>African Robot — Sprint 4</span>
          <div className="flex items-center gap-4">
            <span>Next.js 15 · ROS2 · Teensy 4.1</span>
            <span className="text-robot-amber">Phase 1 — Visage & Dashboard</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
