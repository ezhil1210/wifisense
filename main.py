import asyncio
import time
import json
import uuid
import os
from typing import List, Dict, Any, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from models.schemas import TelemetryData, Ticket
from collectors.wifi_telemetry import get_wifi_telemetry
from collectors.health_probe import run_ping, run_http_probe
from collectors.diagnostic_suite import run_speed_test
from engine.anomaly_detector import AnomalyDetector
from engine.diagnosis import run_ai_diagnosis
from engine.ticket_manager import TicketManager

detector = AnomalyDetector()
ticket_mgr = TicketManager()

# Clear existing tickets on startup as requested
ticket_mgr.clear_all_tickets()

active_connections: List[WebSocket] = []
current_scenario: Optional[str] = None
latest_telemetry: Optional[TelemetryData] = None

SCENARIOS: Dict[str, Any] = {}
if os.path.exists("data/scenarios.json"):
    with open("data/scenarios.json", "r") as f:
        SCENARIOS = json.load(f)

async def collect_telemetry() -> TelemetryData:
    if current_scenario and current_scenario in SCENARIOS:
        data = SCENARIOS[current_scenario]
        tel = TelemetryData(
            timestamp=time.time(),
            **data
        )
    else:
        # Real collection
        wifi_data = await get_wifi_telemetry()
        lat, loss = await run_ping()
        http_ok, dns_ms = await run_http_probe()

        tel = TelemetryData(
            timestamp=time.time(),
            signal_percent=wifi_data.get("signal_percent", 0),
            rssi=wifi_data.get("rssi", -100),
            bssid=wifi_data.get("bssid", ""),
            ssid=wifi_data.get("ssid", ""),
            channel=wifi_data.get("channel", 0),
            rx_rate=int(wifi_data.get("rx_rate", 0)),
            tx_rate=int(wifi_data.get("tx_rate", 0)),
            latency_ms=lat,
            jitter_ms=round(abs(lat - 15.0) * 0.4, 1),
            packet_loss_percent=loss,
            dns_resolution_ms=dns_ms,
            http_probe_success=http_ok
        )

    # Process through AnomalyDetector to calculate health score and anomaly status
    detector.add_data(tel)
    return tel

async def telemetry_loop():
    global latest_telemetry
    while True:
        try:
            telemetry = await collect_telemetry()
            latest_telemetry = telemetry
            
            # Broadcast live metrics to all WebSocket clients
            for ws in list(active_connections):
                try:
                    await ws.send_text(telemetry.model_dump_json())
                except Exception:
                    if ws in active_connections:
                        active_connections.remove(ws)

        except Exception as e:
            print(f"Telemetry loop error: {e}")
        
        await asyncio.sleep(2)

async def handle_anomaly(telemetry: TelemetryData):
    print("User initiated diagnosis, running AI diagnostic suite...")
    diag_res = await run_speed_test()
    ai_result = await run_ai_diagnosis(telemetry.model_dump(), diag_res.model_dump())
    
    sev = ai_result.get("severity", "Warning")
    prio = "High" if sev == "Critical" else ("Medium" if sev == "Warning" else "Low")

    ticket = Ticket(
        id=str(uuid.uuid4()),
        number=f"WFS-{int(time.time()) % 10000:04d}",
        timestamp=time.time(),
        priority=prio,
        severity=sev,
        root_cause=ai_result.get("root_cause", "Unknown"),
        confidence=ai_result.get("confidence", "Low"),
        evidence=ai_result.get("evidence", []),
        human_explanation=ai_result.get("human_explanation", "Anomaly detected."),
        recommended_fix=ai_result.get("recommended_fix", "Please investigate."),
        remediation_steps=ai_result.get("remediation_steps", []),
        raw_telemetry=telemetry.model_dump(),
        status="open"
    )
    ticket_mgr.create_ticket(ticket)
    print(f"User Ticket Created: {ticket.number} [{sev}]")
    
    # Broadcast diagnosis event to WebSockets
    event = {
        "type": "diagnosis",
        "ticket": ticket.model_dump()
    }
    for ws in list(active_connections):
        try:
            await ws.send_text(json.dumps(event))
        except Exception:
            pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(telemetry_loop())
    yield
    task.cancel()

app = FastAPI(title="WiFiSense API", lifespan=lifespan)

os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def serve_index():
    idx_path = "static/index.html"
    if os.path.exists(idx_path):
        return FileResponse(idx_path)
    return JSONResponse(content={"message": "API is running. Frontend static/index.html missing."})

@app.websocket("/ws/telemetry")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        if websocket in active_connections:
            active_connections.remove(websocket)

@app.get("/api/status")
async def get_status():
    return {"status": "running", "latest": latest_telemetry.model_dump() if latest_telemetry else None}

@app.get("/api/history")
async def get_history():
    return [t.model_dump() for t in detector.history]

@app.get("/api/tickets")
async def list_tickets():
    return [t.model_dump() for t in ticket_mgr.get_tickets()]

@app.delete("/api/tickets")
async def clear_tickets():
    ticket_mgr.clear_all_tickets()
    return {"status": "tickets cleared"}

@app.get("/api/tickets/{ticket_id}")
async def get_ticket(ticket_id: str):
    for t in ticket_mgr.get_tickets():
        if t.id == ticket_id:
            return t.model_dump()
    return JSONResponse(status_code=404, content={"detail": "Not found"})

class StatusUpdate(BaseModel):
    status: str
    isp_notes: Optional[str] = None

class PushRequest(BaseModel):
    subscriber_notes: Optional[str] = ""

@app.post("/api/tickets/{ticket_id}/status")
async def update_ticket_status(ticket_id: str, update: StatusUpdate):
    ticket_mgr.update_status(ticket_id, update.status, update.isp_notes)
    return {"status": "updated"}

@app.post("/api/tickets/{ticket_id}/push")
async def push_ticket_to_isp(ticket_id: str, req: PushRequest = PushRequest()):
    t = ticket_mgr.push_to_isp(ticket_id, req.subscriber_notes or "")
    if not t:
        return JSONResponse(status_code=404, content={"detail": "Ticket not found"})
    
    # Broadcast ISP escalation event to all WebSockets
    event = {
        "type": "isp_escalation",
        "ticket": t.model_dump()
    }
    for ws in list(active_connections):
        try:
            await ws.send_text(json.dumps(event))
        except Exception:
            pass
            
    return {"status": "pushed_to_isp", "ticket": t.model_dump()}


@app.post("/api/diagnose")
async def manual_diagnose():
    if not latest_telemetry:
        return JSONResponse(status_code=400, content={"detail": "No telemetry yet"})
    await handle_anomaly(latest_telemetry)
    return {"status": "diagnosed"}

@app.post("/api/scenario/{name}")
async def set_scenario(name: str):
    global current_scenario, latest_telemetry
    if name == "clear":
        current_scenario = None
        # Immediately collect real-time telemetry and push via WebSocket
        tel = await collect_telemetry()
        latest_telemetry = tel
        for ws in list(active_connections):
            try:
                await ws.send_text(tel.model_dump_json())
            except Exception:
                pass
        return {"status": "cleared", "latest": tel.model_dump()}

    if name not in SCENARIOS:
        return JSONResponse(status_code=404, content={"detail": "Scenario not found"})
    
    current_scenario = name
    # Automatically run diagnosis for the scenario
    asyncio.create_task(handle_anomaly(latest_telemetry if latest_telemetry else await collect_telemetry()))
    return {"status": f"scenario {name} loaded and diagnosed"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)
