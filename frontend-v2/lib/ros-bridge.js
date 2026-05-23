'use client'
/**
 * ROSBridge WebSocket client.
 * Se connecte au rosbridge_server sur le Raspberry Pi (port 9090 par défaut).
 * Fournit subscribe/publish/call_service sur les topics ROS2.
 */

const ROS_BRIDGE_URL =
  process.env.NEXT_PUBLIC_ROSBRIDGE_URL || 'ws://localhost:9090'

class RosBridgeClient {
  constructor() {
    this.ws         = null
    this.connected  = false
    this.subs       = new Map()   // id → { topic, cb }
    this.pendingCalls = new Map() // id → { resolve, reject }
    this._idCounter = 1
    this._reconnectTimer = null
    this._onConnectCbs  = []
    this._onDisconnectCbs = []
  }

  connect(url = ROS_BRIDGE_URL) {
    this._url = url
    this._connect()
  }

  _connect() {
    try {
      this.ws = new WebSocket(this._url)
    } catch (e) {
      this._scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      this.connected = true
      this._onConnectCbs.forEach(cb => cb())
      // Re-subscribe
      this.subs.forEach((_, id) => {
        const { topic, type } = this.subs.get(id)
        this._send({ op: 'subscribe', id, topic, type })
      })
    }

    this.ws.onclose = () => {
      this.connected = false
      this._onDisconnectCbs.forEach(cb => cb())
      this._scheduleReconnect()
    }

    this.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        this._handleMessage(msg)
      } catch {}
    }
  }

  _scheduleReconnect() {
    clearTimeout(this._reconnectTimer)
    this._reconnectTimer = setTimeout(() => this._connect(), 3000)
  }

  _handleMessage(msg) {
    if (msg.op === 'publish' && msg.topic) {
      this.subs.forEach(({ topic, cb }) => {
        if (topic === msg.topic) cb(msg.msg)
      })
    }
    if (msg.op === 'service_response' && this.pendingCalls.has(msg.id)) {
      const { resolve } = this.pendingCalls.get(msg.id)
      this.pendingCalls.delete(msg.id)
      resolve(msg.values)
    }
  }

  _send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    }
  }

  _nextId() { return `id_${this._idCounter++}` }

  /** Subscribe to a ROS topic */
  subscribe(topic, type, cb) {
    const id = this._nextId()
    this.subs.set(id, { topic, type, cb })
    this._send({ op: 'subscribe', id, topic, type })
    return () => {
      this.subs.delete(id)
      this._send({ op: 'unsubscribe', id, topic })
    }
  }

  /** Publish to a ROS topic */
  publish(topic, type, msg) {
    this._send({ op: 'publish', topic, type, msg })
  }

  /** Call a ROS service */
  callService(service, type, args = {}) {
    const id = this._nextId()
    return new Promise((resolve, reject) => {
      this.pendingCalls.set(id, { resolve, reject })
      this._send({ op: 'call_service', id, service, type, args })
      setTimeout(() => {
        if (this.pendingCalls.has(id)) {
          this.pendingCalls.delete(id)
          reject(new Error('Service timeout'))
        }
      }, 5000)
    })
  }

  onConnect(cb)    { this._onConnectCbs.push(cb) }
  onDisconnect(cb) { this._onDisconnectCbs.push(cb) }

  disconnect() {
    clearTimeout(this._reconnectTimer)
    this.ws?.close()
  }
}

// Singleton
let _client = null
export function getRosBridge() {
  if (!_client && typeof window !== 'undefined') {
    _client = new RosBridgeClient()
  }
  return _client
}

// ── Topics ROS2 ────────────────────────────────────────────────────────────────
export const TOPICS = {
  EMOTION:       '/robot/emotion',
  BALANCE:       '/robot/balance_status',
  ARM_CMD:       '/arm_cmd',
  ARM_STATUS:    '/arm/status',
  TTS_TEXT:      '/tts/text',
  TTS_PHONEME:   '/tts/phoneme_events',
  TTS_SPEAKING:  '/tts/speaking',
  STT_RESULT:    '/stt/result',
  STT_LISTENING: '/stt/listening',
  CMD_VEL:       '/cmd_vel',
  PID_TUNE:      '/balance/pid_tune',
  VISION_FACES:  '/vision/faces',
  AI_TRANSCRIPT: '/ai/transcript',
}
