"""
African Mask Robot — Backend
Sprint 2: WebSocket + TTS + Robot control bridge
"""

import asyncio
import json
import logging
from typing import Set
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

app = FastAPI(title="African Mask Robot API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Connection manager ──────────────────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self.clients: Set[WebSocket] = set()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.clients.add(ws)
        log.info(f"Client connected. Total: {len(self.clients)}")

    def disconnect(self, ws: WebSocket):
        self.clients.discard(ws)
        log.info(f"Client disconnected. Total: {len(self.clients)}")

    async def broadcast(self, data: dict):
        dead = set()
        for ws in self.clients:
            try:
                await ws.send_json(data)
            except Exception:
                dead.add(ws)
        self.clients -= dead


manager = ConnectionManager()

# ── Robot state ─────────────────────────────────────────────────────────────

robot_state = {
    "balance": 0.0,
    "speed": 0.0,
    "battery": 85,
    "emotion": "neutral",
    "lastMessage": "",
    "connected": False,
}


# ── REST endpoints ───────────────────────────────────────────────────────────

@app.get("/api/status")
async def get_status():
    return robot_state


class SpeakRequest(BaseModel):
    text: str
    emotion: str = "neutral"
    lang: str = "fr"


@app.post("/api/speak")
async def speak(req: SpeakRequest):
    robot_state["emotion"] = req.emotion
    robot_state["lastMessage"] = req.text
    await manager.broadcast({
        "type": "speak",
        "text": req.text,
        "emotion": req.emotion,
    })
    return {"ok": True}


class EmotionRequest(BaseModel):
    emotion: str


@app.post("/api/emotion")
async def set_emotion(req: EmotionRequest):
    robot_state["emotion"] = req.emotion
    await manager.broadcast({"type": "emotion", "emotion": req.emotion})
    return {"ok": True}


# ── WebSocket ────────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    # Send current state on connection
    await ws.send_json({"type": "state", **robot_state})
    try:
        while True:
            data = await ws.receive_json()
            await handle_ws_message(ws, data)
    except WebSocketDisconnect:
        manager.disconnect(ws)
    except Exception as e:
        log.error(f"WS error: {e}")
        manager.disconnect(ws)


async def handle_ws_message(ws: WebSocket, data: dict):
    msg_type = data.get("type")

    if msg_type == "speak":
        robot_state["lastMessage"] = data.get("text", "")
        robot_state["emotion"] = data.get("emotion", "neutral")
        # Broadcast to all other clients (e.g., robot display)
        await manager.broadcast(data)

    elif msg_type == "emotion":
        robot_state["emotion"] = data.get("emotion", "neutral")
        await manager.broadcast(data)

    elif msg_type == "stop":
        await manager.broadcast({"type": "stop"})

    elif msg_type == "robot_telemetry":
        # Data coming from the robot hardware
        robot_state.update({
            "balance": data.get("balance", robot_state["balance"]),
            "speed": data.get("speed", robot_state["speed"]),
            "battery": data.get("battery", robot_state["battery"]),
        })
        await manager.broadcast({"type": "telemetry", **robot_state})


# ── Simulated robot telemetry (for development without hardware) ─────────────

@app.on_event("startup")
async def start_simulation():
    asyncio.create_task(simulate_telemetry())


async def simulate_telemetry():
    import math, time
    t = 0
    while True:
        await asyncio.sleep(0.5)
        t += 0.5
        robot_state["balance"] = round(math.sin(t * 0.4) * 3.5, 2)
        robot_state["speed"] = round(math.sin(t * 0.2) * 12, 1)
        robot_state["battery"] = max(10, robot_state["battery"] - 0.01)
        await manager.broadcast({
            "type": "telemetry",
            "balance": robot_state["balance"],
            "speed": robot_state["speed"],
            "battery": round(robot_state["battery"], 1),
        })


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=5000, reload=True)
