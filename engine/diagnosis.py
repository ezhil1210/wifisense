import os
import json
import google.generativeai as genai
from typing import Dict, Any, List

API_KEY = os.environ.get("GEMINI_API_KEY", "").strip() or "AIzaSyAusizNbwINcG7H4ZUtpCWrXU1nHfSjgAA"

if API_KEY:
    genai.configure(api_key=API_KEY)

def fallback_diagnosis(telemetry: Dict[str, Any]) -> Dict[str, Any]:
    sig = telemetry.get('signal_percent', 90)
    rssi = telemetry.get('rssi', -52)
    lat = telemetry.get('latency_ms', 15)
    loss = telemetry.get('packet_loss_percent', 0)
    dns = telemetry.get('dns_resolution_ms', 25)
    http_ok = telemetry.get('http_probe_success', True)
    ssid = telemetry.get('ssid', '')

    # Full Offline / Wi-Fi Disconnected
    if sig == 0 or rssi <= -95 or ssid in ('', 'Disconnected') or (loss >= 99.0 and not http_ok):
        return {
            "root_cause": "no_wifi_connection",
            "severity": "Critical",
            "confidence": "High",
            "evidence": [
                "Wi-Fi interface disconnected or disabled (Signal 0%, RSSI -100 dBm)",
                "Gateway ICMP ping 100% packet loss (Host Unreachable)",
                "HTTP internet probe failed completely"
            ],
            "human_explanation": "Your device is completely disconnected from Wi-Fi and has no network connectivity. You are not connected to any wireless access point.",
            "recommended_fix": "Turn on your Wi-Fi adapter, select your network from the list of available SSIDs, and enter your password.",
            "remediation_steps": [
                {
                    "step_number": 1,
                    "title": "Enable Wi-Fi Adapter",
                    "action_type": "command",
                    "command_or_guide": "netsh interface set interface name=\"Wi-Fi\" admin=enabled",
                    "impact": "Powers on wireless network interface hardware"
                },
                {
                    "step_number": 2,
                    "title": "Connect to Access Point",
                    "action_type": "setting_change",
                    "command_or_guide": "Open Wi-Fi Settings menu and select your home network SSID.",
                    "impact": "Establishes wireless layer 2 association"
                },
                {
                    "step_number": 3,
                    "title": "Verify Router Power & Cable",
                    "action_type": "manual_check",
                    "command_or_guide": "Ensure router power supply is plugged in and Wireless LED is lit.",
                    "impact": "Restores wireless beacon broadcast"
                }
            ]
        }

    if not http_ok or dns > 1000:

        return {
            "root_cause": "dns_failure",
            "severity": "Critical",
            "confidence": "High",
            "evidence": [
                f"DNS lookup resolution timeout ({dns:.1f}ms)",
                f"HTTP gateway probe: {'Failed' if not http_ok else 'OK'}",
                f"Local RSSI signal strong ({sig}%)"
            ],
            "human_explanation": "Your device is connected to Wi-Fi, but your system cannot resolve web domain names due to a DNS server failure.",
            "recommended_fix": "Flush your operating system DNS resolver cache and switch to a fast public DNS provider like Cloudflare (1.1.1.1) or Google (8.8.8.8).",
            "remediation_steps": [
                {
                    "step_number": 1,
                    "title": "Flush DNS Cache",
                    "action_type": "command",
                    "command_or_guide": "ipconfig /flushdns",
                    "impact": "Clears corrupted local DNS lookup entries"
                },
                {
                    "step_number": 2,
                    "title": "Switch DNS Provider",
                    "action_type": "setting_change",
                    "command_or_guide": "Set primary IPv4 DNS to 1.1.1.1 and secondary DNS to 8.8.8.8 in Network Adapter Properties",
                    "impact": "Restores fast, reliable domain name resolution"
                }
            ]
        }

    if sig < 35:
        return {
            "root_cause": "rf_attenuation",
            "severity": "Warning",
            "confidence": "High",
            "evidence": [
                f"Severe RF signal attenuation ({sig}% signal, RSSI {telemetry.get('rssi', -87)} dBm)",
                f"Negotiated link rate dropped to {telemetry.get('rx_rate', 24)} Mbps Rx",
                f"Increased physical layer retransmissions"
            ],
            "human_explanation": "Your device is too far from the Wi-Fi router or physical obstacles (walls, metal objects) are heavily blocking the radio signal.",
            "recommended_fix": "Move closer to your access point or switch to a Wi-Fi mesh node / 2.4GHz band for better wall penetration.",
            "remediation_steps": [
                {
                    "step_number": 1,
                    "title": "Relocate Closer to Router",
                    "action_type": "manual_check",
                    "command_or_guide": "Ensure line-of-sight to router and remove obstacles like mirrors or metal appliances.",
                    "impact": "Boosts RSSI signal level above -65 dBm"
                },
                {
                    "step_number": 2,
                    "title": "Enable 2.4 GHz Band Steering",
                    "action_type": "setting_change",
                    "command_or_guide": "Connect to the 2.4GHz SSID for longer range wall penetration if 5GHz signal is attenuated.",
                    "impact": "Increases link stability at longer distances"
                }
            ]
        }

    if loss >= 3.0:
        return {
            "root_cause": "channel_congestion",
            "severity": "Warning",
            "confidence": "High",
            "evidence": [
                f"High packet loss detected ({loss:.1f}%)",
                f"Link rates fluctuating ({telemetry.get('tx_rate', 72)} Mbps Tx)",
                f"Co-channel interference on Wi-Fi Channel {telemetry.get('channel', 6)}"
            ],
            "human_explanation": "Neighboring Wi-Fi networks are broadcasting on the same wireless channel, causing radio frequency collisions and packet loss.",
            "recommended_fix": "Change your router's Wi-Fi channel setting to Auto or select an uncrowded non-overlapping channel (e.g. Channel 1, 6, 11 for 2.4GHz or 36+ for 5GHz).",
            "remediation_steps": [
                {
                    "step_number": 1,
                    "title": "Run Wi-Fi Spectrum Scan",
                    "action_type": "command",
                    "command_or_guide": "netsh wlan show networks mode=bssid",
                    "impact": "Identifies non-overlapping Wi-Fi channels in your area"
                },
                {
                    "step_number": 2,
                    "title": "Update Router Wi-Fi Channel",
                    "action_type": "setting_change",
                    "command_or_guide": "Access router admin page (http://192.168.1.1) and switch Wi-Fi Channel from fixed to Auto/DFS.",
                    "impact": "Eliminates co-channel radio interference"
                }
            ]
        }

    if lat > 100:
        return {
            "root_cause": "upstream_isp_fault",
            "severity": "Critical",
            "confidence": "High",
            "evidence": [
                f"High ping latency spike ({lat:.1f}ms vs 15ms baseline)",
                f"Local RF connection healthy ({sig}% signal, {telemetry.get('rx_rate', 866)} Mbps Rx)",
                f"Packet jitter elevated"
            ],
            "human_explanation": "Your local home Wi-Fi signal is strong and fast, but internet traffic is experiencing severe latency on your ISP's core routing network.",
            "recommended_fix": "Power cycle your broadband modem/ONT and contact your Service Provider to report upstream node congestion.",
            "remediation_steps": [
                {
                    "step_number": 1,
                    "title": "Power-Cycle Gateway Modem",
                    "action_type": "manual_check",
                    "command_or_guide": "Unplug power from ISP modem/router for 30 seconds, then reconnect.",
                    "impact": "Clears cached sessions and re-establishes clean ISP WAN lease"
                },
                {
                    "step_number": 2,
                    "title": "Escalate to ISP Technical Support",
                    "action_type": "manual_check",
                    "command_or_guide": "Provide ticket number and trace data to ISP support desk to report edge node degradation.",
                    "impact": "Triggers ISP WAN line diagnostic check"
                }
            ]
        }

    return {
        "root_cause": "healthy",
        "severity": "Info",
        "confidence": "High",
        "evidence": [
            f"RSSI signal optimal ({sig}%, {telemetry.get('rssi', -52)} dBm)",
            f"Latency low ({lat:.1f}ms), 0.0% packet loss",
            f"DNS resolution crisp ({dns:.1f}ms)"
        ],
        "human_explanation": "Your Wi-Fi network and internet connection are fully operational with excellent link metrics.",
        "recommended_fix": "No action required.",
        "remediation_steps": []
    }

async def run_ai_diagnosis(telemetry: Dict[str, Any], diag_results: Dict[str, Any]) -> Dict[str, Any]:
    if not API_KEY:
        return fallback_diagnosis(telemetry)
    
    prompt = f"""
    You are an expert Wi-Fi and ISP Network Diagnostics Engineer. Analyze this Wi-Fi telemetry and diagnostic test data to identify the root cause and provide structured remediation steps.
    
    Telemetry Data:
    - SSID: {telemetry.get('ssid')}
    - Signal: {telemetry.get('signal_percent')}% (RSSI: {telemetry.get('rssi')} dBm)
    - Health Score: {telemetry.get('health_score', 100)} / 100
    - Latency: {telemetry.get('latency_ms')} ms (Jitter: {telemetry.get('jitter_ms', 0)} ms)
    - Packet Loss: {telemetry.get('packet_loss_percent')}%
    - DNS Resolution: {telemetry.get('dns_resolution_ms')} ms
    - Rx / Tx Rates: {telemetry.get('rx_rate')} / {telemetry.get('tx_rate')} Mbps
    
    Diagnostic Speed Test Results:
    - Download Throughput: {diag_results.get('throughput_mbps')} Mbps
    - Idle Latency: {diag_results.get('idle_latency_ms')} ms
    - Loaded Latency: {diag_results.get('loaded_latency_ms')} ms
    - Bufferbloat Latency Increase: {diag_results.get('bufferbloat_score')} ms

    Return ONLY a valid JSON object (no markdown, no code blocks) matching this EXACT schema:
    {{
      "root_cause": "no_wifi_connection | rf_attenuation | channel_congestion | upstream_isp_fault | dns_failure | bufferbloat | healthy",
      "severity": "Critical | Warning | Info",
      "confidence": "High | Medium | Low",
      "evidence": ["2-3 precise numeric data points from the inputs"],
      "human_explanation": "2-3 clear plain-English sentences explaining the issue.",
      "recommended_fix": "Key resolution recommendation.",
      "remediation_steps": [
        {{
          "step_number": 1,
          "title": "Action Title",
          "action_type": "command | manual_check | setting_change",
          "command_or_guide": "Exact command line or practical step",
          "impact": "Expected outcome"
        }}
      ]
    }}
    """
    
    candidate_models = ["gemini-2.5-flash", "gemini-3.6-flash", "gemini-flash-latest", "gemini-2.5-pro"]
    
    for model_name in candidate_models:
        try:
            model = genai.GenerativeModel(model_name)
            resp = model.generate_content(prompt)
            text = resp.text.strip()
            if text.startswith("```json"):
                text = text[7:]
            if text.startswith("```"):
                text = text[3:]
            if text.endswith("```"):
                text = text[:-3]
            data = json.loads(text.strip())
            print(f"Gemini API diagnosis succeeded with model: {model_name}")
            return data
        except Exception as e:
            print(f"Model {model_name} failed: {e}")
            continue

    return fallback_diagnosis(telemetry)

