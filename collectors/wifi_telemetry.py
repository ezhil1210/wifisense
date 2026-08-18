import subprocess
import re
import asyncio
from typing import Dict, Any

def sync_get_wifi_telemetry() -> Dict[str, Any]:
    """Run netsh wlan show interfaces and parse output."""
    data = {
        "signal_percent": 0,
        "rssi": -100,
        "bssid": "",
        "ssid": "",
        "channel": 0,
        "rx_rate": 0,
        "tx_rate": 0
    }
    try:
        output = subprocess.check_output(
            ["netsh", "wlan", "show", "interfaces"],
            encoding="oem",
            errors="replace",
            timeout=3.0
        )
        for line in output.split("\n"):
            line = line.strip()
            if not line: 
                continue
            if ":" in line:
                key, val = [x.strip() for x in line.split(":", 1)]
                if key == "Signal":
                    try:
                        sig = int(val.replace("%", ""))
                        data["signal_percent"] = sig
                        data["rssi"] = int((sig / 2) - 100)
                    except Exception:
                        pass
                elif key == "SSID":
                    data["ssid"] = val
                elif key == "BSSID":
                    data["bssid"] = val
                elif key == "Channel":
                    try:
                        data["channel"] = int(val)
                    except Exception:
                        pass
                elif key == "Receive rate (Mbps)":
                    try:
                        data["rx_rate"] = float(val)
                    except Exception:
                        pass
                elif key == "Transmit rate (Mbps)":
                    try:
                        data["tx_rate"] = float(val)
                    except Exception:
                        pass
    except Exception:
        pass
    return data

async def get_wifi_telemetry() -> Dict[str, Any]:
    return await asyncio.to_thread(sync_get_wifi_telemetry)
