"""
African Mask Robot — Backend v2
Sprint 2: TTS précis (edge-tts) + PID controller + WebSocket
"""

import asyncio
import logging
from typing import Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from tts_engine import engine as tts_engine
from pid_sim import controller

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger(__name__)

app = FastAPI(title="African Mask Robot API v2")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── WebSocket manager ────────────────────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self.clients: Set[WebSocket] = set()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.clients.add(ws)
        log.info(f"WS connect — total: {len(self.clients)}")

    def disconnect(self, ws: WebSocket):
        self.clients.discard(ws)

    async def broadcast(self, data: dict):
        dead = set()
        for ws in self.clients:
            try:
                await ws.send_json(data)
            except Exception:
                dead.add(ws)
        self.clients -= dead


manager = ConnectionManager()

# ── Robot state ──────────────────────────────────────────────────────────────

robot_state = {
    "emotion": "neutral",
    "last_text": "",
    "speaking": False,
}

# ── REST endpoints ───────────────────────────────────────────────────────────

@app.get("/api/status")
async def status():
    return {**robot_state, **controller.get_telemetry()}


@app.get("/api/pid_history")
async def pid_history():
    return {"history": controller.history}


class SpeakRequest(BaseModel):
    text: str
    emotion: str = "neutral"
    lang: str = "fr-FR"


@app.post("/api/tts")
async def tts(req: SpeakRequest):
    """
    Génère l'audio TTS + timing phonèmes précis.
    Retourne {audio_b64, mime, phoneme_events, duration_ms}.
    Diffuse aussi en WebSocket pour les autres clients (ex: écran robot).
    """
    log.info(f"TTS: '{req.text[:40]}...' | lang={req.lang} | emotion={req.emotion}")

    robot_state["emotion"]    = req.emotion
    robot_state["last_text"]  = req.text
    robot_state["speaking"]   = True

    result = await tts_engine.synthesize(req.text, req.lang)

    # Notifier tous les clients WebSocket que la parole commence
    await manager.broadcast({
        "type":            "speak_start",
        "emotion":         req.emotion,
        "text":            req.text,
        "duration_ms":     result["duration_ms"],
        "phoneme_events":  result["phoneme_events"],
        "word_boundaries": result.get("word_boundaries", []),
    })

    asyncio.create_task(_reset_speaking(result["duration_ms"]))

    # Ne pas renvoyer audio_b64 en WS (trop gros) — uniquement en REST
    return JSONResponse({
        "ok":             True,
        "audio_b64":      result["audio_b64"],
        "mime":           result["mime"],
        "phoneme_events": result["phoneme_events"],
        "duration_ms":    result["duration_ms"],
    })


async def _reset_speaking(delay_ms: float):
    await asyncio.sleep(delay_ms / 1000 + 0.3)
    robot_state["speaking"] = False
    await manager.broadcast({"type": "speak_end"})


class EmotionRequest(BaseModel):
    emotion: str


@app.post("/api/emotion")
async def set_emotion(req: EmotionRequest):
    robot_state["emotion"] = req.emotion
    await manager.broadcast({"type": "emotion", "emotion": req.emotion})
    return {"ok": True}


class MotorCommand(BaseModel):
    speed: float = 0.0   # -100..100
    turn: float  = 0.0   # -100..100


@app.post("/api/control")
async def control(cmd: MotorCommand):
    controller.command(cmd.speed, cmd.turn)
    return {"ok": True}


class PIDRequest(BaseModel):
    kp: float
    ki: float
    kd: float


@app.post("/api/pid")
async def set_pid(req: PIDRequest):
    controller.pid.kp = req.kp
    controller.pid.ki = req.ki
    controller.pid.kd = req.kd
    controller.pid.reset()
    await manager.broadcast({"type": "pid_update", "kp": req.kp, "ki": req.ki, "kd": req.kd})
    return {"ok": True}


# ── WebSocket ────────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    await ws.send_json({"type": "state", **robot_state, **controller.get_telemetry()})
    try:
        while True:
            data = await ws.receive_json()
            await _handle_ws(data)
    except WebSocketDisconnect:
        manager.disconnect(ws)
    except Exception as e:
        log.error(f"WS error: {e}")
        manager.disconnect(ws)


async def _handle_ws(data: dict):
    t = data.get("type")
    if t == "control":
        controller.command(data.get("speed", 0), data.get("turn", 0))
    elif t == "emotion":
        robot_state["emotion"] = data.get("emotion", "neutral")
        await manager.broadcast(data)
    elif t == "stop_speak":
        robot_state["speaking"] = False
        await manager.broadcast({"type": "speak_end"})
    elif t == "pid":
        controller.pid.kp = data.get("kp", controller.pid.kp)
        controller.pid.ki = data.get("ki", controller.pid.ki)
        controller.pid.kd = data.get("kd", controller.pid.kd)


# ── Startup ──────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def on_startup():
    asyncio.create_task(controller.run_loop(manager.broadcast))
    log.info("PID balance loop started")


@app.on_event("shutdown")
async def on_shutdown():
    controller.stop_loop()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=5000, reload=False)
