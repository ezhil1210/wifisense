import subprocess
import re
import time
import asyncio
import httpx
from typing import Tuple

def sync_run_ping(host: str = "8.8.8.8") -> Tuple[float, float]:
    """Run ping and return (latency_ms, packet_loss_percent)."""
    latency = 0.0
    loss = 0.0
    try:
        output = subprocess.check_output(
            ["ping", "-n", "2", host],
            encoding="oem",
            errors="replace",
            timeout=3.0
        )
        latencies = []
        for line in output.split("\n"):
            line = line.strip()
            if "Lost = " in line:
                m = re.search(r"\((\d+)% loss\)", line)
                if m: 
                    loss = float(m.group(1))
            if "time=" in line or "time<" in line:
                m = re.search(r"time[=<](\d+)ms", line)
                if m: 
                    latencies.append(float(m.group(1)))
        if latencies:
            latency = sum(latencies) / len(latencies)
    except Exception:
        loss = 100.0
    return latency, loss

async def run_ping(host: str = "8.8.8.8") -> Tuple[float, float]:
    return await asyncio.to_thread(sync_run_ping, host)

import socket

async def run_http_probe(url: str = "http://www.google.com") -> Tuple[bool, float]:
    """Check DNS resolution speed and HTTP reachability."""
    dns_start = time.time()
    dns_ms = 15.0
    try:
        await asyncio.to_thread(socket.gethostbyname, "www.google.com")
        dns_ms = (time.time() - dns_start) * 1000.0
    except Exception:
        dns_ms = 1500.0

    success = False
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(url)
            success = (resp.status_code == 200)
    except Exception:
        pass

    return success, round(dns_ms, 1)

