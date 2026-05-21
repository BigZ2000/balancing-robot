import { useState, useEffect, useRef, useCallback } from 'react'

// WebSocket connection to the robot backend
export function useRobotWS(url = null) {
  const [connected, setConnected] = useState(false)
  const [robotStatus, setRobotStatus] = useState({
    balance: 0,
    speed: 0,
    battery: 85,
    emotion: 'neutral',
    lastMessage: '',
  })
  const wsRef = useRef(null)
  const reconnectRef = useRef(null)

  const connect = useCallback(() => {
    if (!url) return
    try {
      const ws = new WebSocket(url)
      wsRef.current = ws
      ws.onopen = () => setConnected(true)
      ws.onclose = () => {
        setConnected(false)
        reconnectRef.current = setTimeout(connect, 3000)
      }
      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data)
          setRobotStatus(prev => ({ ...prev, ...data }))
        } catch {}
      }
    } catch {}
  }, [url])

  useEffect(() => {
    if (url) connect()
    return () => {
      wsRef.current?.close()
      clearTimeout(reconnectRef.current)
    }
  }, [url, connect])

  const send = useCallback((data) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
    }
  }, [])

  return { connected, robotStatus, send }
}
