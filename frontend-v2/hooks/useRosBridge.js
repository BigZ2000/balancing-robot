'use client'
import { useEffect, useRef, useCallback } from 'react'
import { getRosBridge, TOPICS } from '../lib/ros-bridge'
import useRobotStore from '../store/robot'

/**
 * Hook principal ROSBridge.
 * Connecte le store Zustand aux topics ROS2.
 * En mode simulateur → ne connecte pas.
 */
export function useRosBridge() {
  const simulatorMode  = useRobotStore(s => s.simulatorMode)
  const setRosConnected = useRobotStore(s => s.setRosConnected)
  const setEmotion      = useRobotStore(s => s.setEmotion)
  const setPhoneme      = useRobotStore(s => s.setPhoneme)
  const setSpeaking     = useRobotStore(s => s.setSpeaking)
  const setListening    = useRobotStore(s => s.setListening)
  const setTranscript   = useRobotStore(s => s.setTranscript)
  const addToLog        = useRobotStore(s => s.addToLog)
  const updateTelemetry = useRobotStore(s => s.updateTelemetry)

  const ros = useRef(null)

  useEffect(() => {
    if (simulatorMode) return

    const client = getRosBridge()
    ros.current = client

    client.onConnect(() => setRosConnected(true))
    client.onDisconnect(() => setRosConnected(false))
    client.connect()

    const unsubs = [
      client.subscribe(TOPICS.EMOTION, 'std_msgs/String', (msg) => {
        setEmotion(msg.data)
      }),
      client.subscribe(TOPICS.TTS_PHONEME, 'std_msgs/String', (msg) => {
        try {
          const ev = JSON.parse(msg.data)
          setPhoneme(ev.phoneme, ev.value ?? 0.7)
        } catch {}
      }),
      client.subscribe(TOPICS.TTS_SPEAKING, 'std_msgs/Bool', (msg) => {
        setSpeaking(msg.data)
        if (!msg.data) setPhoneme('rest', 0)
      }),
      client.subscribe(TOPICS.STT_LISTENING, 'std_msgs/Bool', (msg) => {
        setListening(msg.data)
      }),
      client.subscribe(TOPICS.STT_RESULT, 'std_msgs/String', (msg) => {
        setTranscript(msg.data)
        addToLog({ role: 'user', text: msg.data, emotion: null })
      }),
      client.subscribe(TOPICS.BALANCE, 'std_msgs/String', (msg) => {
        try { updateTelemetry(JSON.parse(msg.data)) } catch {}
      }),
      client.subscribe(TOPICS.AI_TRANSCRIPT, 'std_msgs/String', (msg) => {
        try {
          const d = JSON.parse(msg.data)
          addToLog({ role: 'assistant', text: d.text, emotion: d.emotion })
        } catch {}
      }),
    ]

    return () => {
      unsubs.forEach(u => u?.())
      client.disconnect()
    }
  }, [simulatorMode])

  const publish = useCallback((topic, type, msg) => {
    ros.current?.publish(topic, type, msg)
  }, [])

  return { publish }
}

/** Hook pour publier une commande de mouvement */
export function useCmdVel() {
  const { publish } = useRosBridge()
  return useCallback(({ linear = 0, angular = 0 }) => {
    publish(TOPICS.CMD_VEL, 'geometry_msgs/Twist', {
      linear:  { x: linear,  y: 0, z: 0 },
      angular: { x: 0, y: 0, z: angular },
    })
  }, [publish])
}
