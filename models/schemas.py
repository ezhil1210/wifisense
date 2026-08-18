from pydantic import BaseModel
from typing import Optional, List, Dict, Any

class TelemetryData(BaseModel):
    timestamp: float
    signal_percent: int
    rssi: int
    bssid: str
    ssid: str
    channel: int
    rx_rate: int
    tx_rate: int
    latency_ms: float
    jitter_ms: float = 0.0
    packet_loss_percent: float
    dns_resolution_ms: float
    http_probe_success: bool
    health_score: int = 100
    is_anomaly: bool = False
    
class DiagnosticResult(BaseModel):
    throughput_mbps: float
    idle_latency_ms: float
    loaded_latency_ms: float
    bufferbloat_score: float

class RemediationStep(BaseModel):
    step_number: int
    title: str
    action_type: str  # 'command', 'manual_check', 'setting_change'
    command_or_guide: str
    impact: str

class Ticket(BaseModel):
    id: str
    number: str
    timestamp: float
    priority: str
    severity: str = "Warning" # Critical, Warning, Info
    root_cause: str
    confidence: str
    evidence: List[str]
    human_explanation: str
    recommended_fix: str
    remediation_steps: List[Dict[str, Any]] = []
    raw_telemetry: Dict[str, Any]
    status: str = "open"
    pushed_to_isp: bool = False
    isp_request_id: Optional[str] = None
    pushed_at: Optional[float] = None
    subscriber_notes: Optional[str] = None
    isp_notes: Optional[str] = None


