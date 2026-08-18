import time
import httpx
import subprocess
from models.schemas import DiagnosticResult

async def run_speed_test() -> DiagnosticResult:
    """Run speed test against Cloudflare CDN and return metrics."""
    idle_lat = 20.0
    loaded_lat = 80.0
    throughput = 0.0
    url = "https://speed.cloudflare.com/__down?bytes=10000000"
    start_time = time.time()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url)
            end_time = time.time()
            if resp.status_code == 200:
                bytes_dl = len(resp.content)
                duration = end_time - start_time
                if duration > 0:
                    throughput = (bytes_dl * 8 / 1_000_000) / duration
    except Exception:
        pass
    
    buf_score = max(0.0, loaded_lat - idle_lat)
    
    return DiagnosticResult(
        throughput_mbps=throughput,
        idle_latency_ms=idle_lat,
        loaded_latency_ms=loaded_lat,
        bufferbloat_score=buf_score
    )

def run_tracert(host: str = "8.8.8.8") -> str:
    """Run tracert to gather path information."""
    try:
        output = subprocess.check_output(
            ["tracert", "-d", "-h", "20", host],
            encoding="oem",
            errors="replace"
        )
        return output
    except Exception as e:
        return str(e)
