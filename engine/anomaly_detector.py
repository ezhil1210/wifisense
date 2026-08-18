import time
import math
from typing import List, Tuple
from models.schemas import TelemetryData

class AnomalyDetector:
    def __init__(self):
        self.history: List[TelemetryData] = []
        self.last_trigger = 0.0
        self.debounce_s = 15.0

    def add_data(self, data: TelemetryData):
        # Calculate health score & anomaly flag
        data.health_score = self.calculate_health_score(data)
        data.is_anomaly = self.detect(data)
        self.history.append(data)
        if len(self.history) > 120:
            self.history.pop(0)

    def calculate_health_score(self, data: TelemetryData) -> int:
        # Full offline / Wi-Fi Disconnected check
        if data.signal_percent == 0 or data.rssi <= -95 or (data.packet_loss_percent >= 99.0 and not data.http_probe_success):
            return 0

        score = 100.0

        # Signal Penalty (Max -35 points)
        if data.signal_percent < 30:
            score -= 35
        elif data.signal_percent < 50:
            score -= 20
        elif data.signal_percent < 75:
            score -= 8


        # Packet Loss Penalty (Max -40 points)
        if data.packet_loss_percent > 10.0:
            score -= 40
        elif data.packet_loss_percent > 3.0:
            score -= 25
        elif data.packet_loss_percent > 0.5:
            score -= 10

        # Latency & Jitter Penalty (Max -30 points)
        if data.latency_ms > 200.0:
            score -= 30
        elif data.latency_ms > 100.0:
            score -= 18
        elif data.latency_ms > 50.0:
            score -= 8

        if data.jitter_ms > 40.0:
            score -= 15
        elif data.jitter_ms > 15.0:
            score -= 7

        # DNS Resolution Penalty (Max -25 points)
        if not data.http_probe_success or data.dns_resolution_ms > 1000:
            score -= 25
        elif data.dns_resolution_ms > 300:
            score -= 12

        return max(0, min(100, int(score)))

    def compute_z_score(self, values: List[float], current: float) -> float:
        if len(values) < 5:
            return 0.0
        mean = sum(values) / len(values)
        variance = sum((x - mean) ** 2 for x in values) / len(values)
        std_dev = math.sqrt(variance)
        if std_dev < 1e-4:
            return 0.0
        return (current - mean) / std_dev

    def detect(self, data: TelemetryData) -> bool:
        now = time.time()
        
        # Hard limits
        if not data.http_probe_success:
            self.last_trigger = now
            return True
        if data.packet_loss_percent >= 3.0:
            self.last_trigger = now
            return True
        if data.signal_percent <= 35:
            self.last_trigger = now
            return True
        if data.dns_resolution_ms >= 500:
            self.last_trigger = now
            return True
        if data.latency_ms >= 120.0:
            self.last_trigger = now
            return True

        # Dynamic Z-Score Analysis against rolling window (last 30 samples)
        if len(self.history) >= 10:
            recent = self.history[-30:]
            latencies = [x.latency_ms for x in recent]
            loss = [x.packet_loss_percent for x in recent]
            
            lat_z = self.compute_z_score(latencies, data.latency_ms)
            loss_z = self.compute_z_score(loss, data.packet_loss_percent)

            if lat_z > 2.5 and data.latency_ms > 45.0:
                self.last_trigger = now
                return True
            if loss_z > 2.5 and data.packet_loss_percent > 1.0:
                self.last_trigger = now
                return True

        return False

