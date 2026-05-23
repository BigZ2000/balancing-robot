'use client'
import { create } from 'zustand'

const useRobotStore = create((set, get) => ({
  // ── Visage / Émotion ────────────────────────────────────────────────────────
  emotion:         'neutral',
  emotionIntensity: 1.0,
  isSpeaking:      false,
  isListening:     false,
  isThinking:      false,
  phoneme:         'rest',
  lipSyncValue:    0,

  // ── Connexions ──────────────────────────────────────────────────────────────
  wsConnected:  false,    // WebSocket backend
  rosConnected: false,    // ROSBridge

  // ── Robot physique ──────────────────────────────────────────────────────────
  battery:     85,
  angle:       0,
  angularVel:  0,
  speed:       0,
  armPosition: 0,        // -100 → 100
  temperature: 42,       // CPU °C
  motorLeft:   0,
  motorRight:  0,

  // ── PID ─────────────────────────────────────────────────────────────────────
  pid: { kp: 25, ki: 0.5, kd: 8 },

  // ── IA conversationnelle ────────────────────────────────────────────────────
  userTranscript:  '',
  robotResponse:   '',
  conversationLog: [],    // [{ role, text, emotion, ts }]

  // ── Périphériques ───────────────────────────────────────────────────────────
  micActive:    false,
  cameraActive: false,
  lidarActive:  false,

  // ── Mode simulateur ─────────────────────────────────────────────────────────
  simulatorMode: true,   // true = pas besoin du robot physique

  // ── Actions ─────────────────────────────────────────────────────────────────
  setEmotion: (emotion, intensity = 1.0) =>
    set({ emotion, emotionIntensity: intensity }),

  setPhoneme: (phoneme, lipSyncValue = 0) =>
    set({ phoneme, lipSyncValue }),

  setSpeaking: (isSpeaking) => set({ isSpeaking }),
  setListening: (isListening) => set({ isListening }),
  setThinking:  (isThinking)  => set({ isThinking }),

  setWsConnected:  (v) => set({ wsConnected: v }),
  setRosConnected: (v) => set({ rosConnected: v }),

  updateTelemetry: (data) => set({
    battery:    data.battery    ?? get().battery,
    angle:      data.angle      ?? get().angle,
    angularVel: data.angular_vel ?? get().angularVel,
    speed:      data.speed      ?? get().speed,
    armPosition: data.arm_pos   ?? get().armPosition,
    motorLeft:  data.motor_left  ?? get().motorLeft,
    motorRight: data.motor_right ?? get().motorRight,
  }),

  setTranscript: (userTranscript) => set({ userTranscript }),

  addToLog: (entry) => set((s) => ({
    conversationLog: [...s.conversationLog.slice(-20), {
      ...entry, ts: Date.now(),
    }],
    robotResponse: entry.role === 'assistant' ? entry.text : s.robotResponse,
    userTranscript: entry.role === 'user' ? entry.text : s.userTranscript,
  })),

  setPID: (pid) => set({ pid: { ...get().pid, ...pid } }),

  setMicActive:    (v) => set({ micActive: v }),
  setCameraActive: (v) => set({ cameraActive: v }),
  setSimulatorMode: (v) => set({ simulatorMode: v }),

  setArmPosition: (armPosition) => set({ armPosition }),
}))

export default useRobotStore
