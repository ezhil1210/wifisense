const historyData = {
    rssi: Array(25).fill(-50),
    latency: Array(25).fill(15),
    loss: Array(25).fill(0),
    dns: Array(25).fill(20),
    health: Array(25).fill(100)
};

let ws;
let currentTicket = null;
let activeChartMetric = null;

function formatISTTime(timestampSeconds) {
    const d = timestampSeconds ? new Date(timestampSeconds > 10000000000 ? timestampSeconds : timestampSeconds * 1000) : new Date();
    return d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }) + ' IST';
}


function init() {
    createSparkline('spark-rssi', historyData.rssi, getStatusColor('rssi', -50));
    createSparkline('spark-latency', historyData.latency, getStatusColor('latency', 15));
    createSparkline('spark-loss', historyData.loss, getStatusColor('loss', 0));
    createSparkline('spark-dns', historyData.dns, getStatusColor('latency', 20));
    
    connectWebSocket();
    fetchStatusFallback();
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host || '127.0.0.1:8765';
    ws = new WebSocket(`${protocol}//${host}/ws/telemetry`);
    
    ws.onopen = () => {
        console.log("Connected to telemetry WebSocket");
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'diagnosis') {
                handleDiagnosis(data.ticket);
            } else if (data.signal_percent !== undefined || data.rssi !== undefined) {
                updateDashboard(data);
            }
        } catch (e) {
            console.error("Error parsing WebSocket message:", e);
        }
    };
    
    ws.onclose = () => {
        console.log("WebSocket disconnected, retrying in 2s...");
        setTimeout(connectWebSocket, 2000);
    };
    
    ws.onerror = (err) => {
        console.error("WebSocket error:", err);
    };
}

function fetchStatusFallback() {
    setInterval(() => {
        fetch('/api/status')
            .then(res => res.json())
            .then(res => {
                if (res.latest) {
                    updateDashboard(res.latest);
                }
            })
            .catch(err => console.log("HTTP poll fallback waiting...", err));
    }, 3000);
}

function updateDashboard(data) {
    const rssi = data.rssi !== undefined ? data.rssi : -100;
    const latency = data.latency_ms !== undefined ? data.latency_ms : 0;
    const jitter = data.jitter_ms !== undefined ? data.jitter_ms : 0;
    const loss = data.packet_loss_percent !== undefined ? data.packet_loss_percent : 0;
    const dns = data.dns_resolution_ms !== undefined ? data.dns_resolution_ms : 0;
    const ssid = data.ssid || 'Connecting...';
    const channel = data.channel || 0;
    const rxRate = data.rx_rate || 0;
    const txRate = data.tx_rate || 0;
    const httpOk = data.http_probe_success !== false;
    const healthScore = data.health_score !== undefined ? data.health_score : 100;
    
    // Band inference
    let band = "5 GHz";
    if (channel > 0 && channel <= 14) band = "2.4 GHz";
    else if (channel > 165) band = "6 GHz";

    // History arrays
    historyData.rssi.push(rssi); historyData.rssi.shift();
    historyData.latency.push(latency); historyData.latency.shift();
    historyData.loss.push(loss); historyData.loss.shift();
    historyData.dns.push(dns); historyData.dns.shift();
    historyData.health.push(healthScore); historyData.health.shift();

    
    // Update KPI card metrics
    document.getElementById('val-rssi').innerText = rssi;
    document.getElementById('val-latency').innerText = latency.toFixed(1);
    document.getElementById('val-jitter').innerText = `±${jitter.toFixed(1)} ms`;
    document.getElementById('val-loss').innerText = loss.toFixed(1);
    document.getElementById('val-dns').innerText = dns.toFixed(1);
    
    // Sparklines
    const rssiColor = getStatusColor('rssi', rssi);
    updateSparkline('spark-rssi', historyData.rssi, rssiColor);
    updateSignalBars('signal-bars', rssi);
    
    const latColor = getStatusColor('latency', latency);
    updateSparkline('spark-latency', historyData.latency, latColor);
    const badgeLat = document.getElementById('badge-latency');
    if (badgeLat) {
        badgeLat.style.color = latColor;
        badgeLat.innerText = latency < 50 ? 'GOOD' : (latency < 100 ? 'FAIR' : 'POOR');
    }
    
    const lossColor = getStatusColor('loss', loss);
    updateSparkline('spark-loss', historyData.loss, lossColor);
    const badgeLoss = document.getElementById('badge-loss');
    if (badgeLoss) {
        badgeLoss.innerText = loss === 0 ? '0.0%' : `${loss.toFixed(1)}%`;
        badgeLoss.style.color = lossColor;
    }
    
    updateSparkline('spark-dns', historyData.dns, getStatusColor('latency', dns));
    
    // Health Radial Meter
    updateHealthMeter(healthScore);

    // Spectrum Bar
    const specFill = document.getElementById('spectrum-fill');
    const specText = document.getElementById('spectrum-channel-text');
    if (specFill && specText) {
        specText.innerText = `Channel ${channel || '--'} (${band})`;
        const fillPct = Math.min(100, Math.max(10, (channel / 48) * 100));
        specFill.style.width = `${fillPct}%`;
        if (channel <= 14) specFill.style.background = 'linear-gradient(90deg, #F97316, #EF4444)';
        else specFill.style.background = 'linear-gradient(90deg, #38BDF8, #10B981)';
    }

    // Network Topology Map Update
    updateTopologyNodes(rssi, latency, loss, dns, httpOk, ssid, channel, band);

    // Details Card
    document.getElementById('det-ssid').innerText = ssid;
    const bandEl = document.getElementById('det-band');
    if (bandEl) {
        bandEl.innerText = band;
        bandEl.style.color = band.includes('2.4') ? 'var(--band-24)' : 'var(--band-5)';
    }
    document.getElementById('det-channel').innerText = channel;
    document.getElementById('det-radio').innerText = data.signal_percent > 0 ? 'Wi-Fi 6 (802.11ax)' : 'Ethernet/Cellular';
    document.getElementById('det-rates').innerText = `${rxRate} / ${txRate} Mbps`;
    
    // Global Status Beacon
    const beacon = document.getElementById('global-status-beacon');
    if (beacon) {
        if (healthScore > 80) beacon.style.backgroundColor = 'var(--status-excellent)';
        else if (healthScore > 50) beacon.style.backgroundColor = 'var(--status-warning)';
        else beacon.style.backgroundColor = 'var(--status-critical)';
    }

    // Trigger toast on new anomaly flag
    if (data.is_anomaly && !window.lastAnomalyToastTime) {
        window.lastAnomalyToastTime = Date.now();
        showToast("Anomaly Detected", `Wi-Fi health dropped to ${healthScore}/100. AI diagnosis recommended.`, "warning");
    }

    // Refresh active enlarged modal chart if open
    if (activeChartMetric) {
        updateActiveChartModal();
    }
}


function updateHealthMeter(score) {
    const el = document.getElementById('val-health-score');
    const ring = document.getElementById('health-ring-bar');
    const badge = document.getElementById('health-score-status');
    if (!el || !ring) return;
    
    el.innerText = score;
    const circumference = 314.15; // 2 * pi * r (50)
    const offset = circumference - (score / 100) * circumference;
    ring.style.strokeDashoffset = offset;
    
    let color = 'var(--status-excellent)';
    let text = 'Excellent';
    if (score < 50) {
        color = 'var(--status-critical)'; text = 'Critical';
    } else if (score < 75) {
        color = 'var(--status-warning)'; text = 'Degraded';
    } else if (score < 90) {
        color = 'var(--status-good)'; text = 'Healthy';
    }
    
    ring.style.stroke = color;
    if (badge) {
        badge.innerText = text;
        badge.style.color = color;
        badge.style.borderColor = color;
    }
}

function updateTopologyNodes(rssi, latency, loss, dns, httpOk, ssid, channel, band) {
    const nodeDev = document.getElementById('node-device');
    const nodeRouter = document.getElementById('node-router');
    const nodeIsp = document.getElementById('node-isp');
    const nodeCloud = document.getElementById('node-cloud');

    const linkWifi = document.getElementById('link-wifi');
    const linkGw = document.getElementById('link-gateway');
    const linkInet = document.getElementById('link-internet');

    document.getElementById('topo-ssid-badge').innerText = `SSID: ${ssid}`;
    document.getElementById('topo-sub-router').innerText = `Ch ${channel} (${band})`;
    document.getElementById('topo-sub-isp').innerText = `Ping ${latency.toFixed(0)}ms`;

    // Reset classes
    [nodeDev, nodeRouter, nodeIsp, nodeCloud].forEach(n => {
        if (n) n.className = 'topo-node active';
    });
    [linkWifi, linkGw, linkInet].forEach(l => {
        if (l) l.className = 'topo-link';
    });

    if (rssi <= -95 || ssid === 'Disconnected' || ssid === 'Connecting...') {
        document.getElementById('topo-sub-device').innerText = 'Disconnected';
        if (nodeDev) nodeDev.className = 'topo-node critical';
        if (nodeRouter) nodeRouter.className = 'topo-node critical';
        if (nodeIsp) nodeIsp.className = 'topo-node critical';
        if (nodeCloud) nodeCloud.className = 'topo-node critical';
        if (linkWifi) linkWifi.className = 'topo-link broken';
        if (linkGw) linkGw.className = 'topo-link broken';
        if (linkInet) linkInet.className = 'topo-link broken';
        return;
    } else {
        document.getElementById('topo-sub-device').innerText = 'Connected';
    }

    if (rssi < -80) {
        if (nodeRouter) nodeRouter.className = 'topo-node warning';
        if (linkWifi) linkWifi.className = 'topo-link degraded';
    }
    if (loss > 3.0) {
        if (nodeRouter) nodeRouter.className = 'topo-node critical';
        if (linkWifi) linkWifi.className = 'topo-link broken';
    }
    if (latency > 100) {
        if (nodeIsp) nodeIsp.className = 'topo-node critical';
        if (linkGw) linkGw.className = 'topo-link broken';
    }
    if (!httpOk || dns > 1000) {
        if (nodeCloud) nodeCloud.className = 'topo-node critical';
        if (linkInet) linkInet.className = 'topo-link broken';
    }
}


function showToast(title, message, severity = "info") {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${severity}`;
    toast.innerHTML = `
        <div style="font-size: 20px">${severity === 'critical' ? '🚨' : (severity === 'warning' ? '⚠️' : 'ℹ️')}</div>
        <div>
            <div style="font-weight: 600; font-size: 14px;">${title}</div>
            <div style="font-size: 12px; color: var(--text-secondary)">${message}</div>
        </div>
    `;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function addTimelineEvent(type, message, color, extraHtml = '', timestampSeconds = null) {
    const tl = document.getElementById('timeline');
    if (!tl) return;
    if (tl.innerText.includes('Waiting')) tl.innerHTML = '';
    
    const timeStr = formatISTTime(timestampSeconds);
    
    const ev = document.createElement('div');
    ev.className = 'timeline-event';
    ev.innerHTML = `
        <div class="timeline-dot" style="background: ${color}"></div>
        <div class="timeline-content">
            <div class="text-xs text-muted" style="margin-bottom: 6px">${timeStr}</div>
            <div style="font-weight: 600; font-size: 14px;">${message}</div>
            ${extraHtml}
        </div>
    `;
    tl.prepend(ev);
}

function handleDiagnosis(ticket) {
    currentTicket = ticket;
    showToast(`AI Ticket Generated (${ticket.number})`, ticket.human_explanation.substring(0, 70) + "...", ticket.severity === "Critical" ? "critical" : "warning");

    let html = `
        <div style="margin-top: 10px; font-size: 13px;">
            <p style="margin-bottom: 6px;"><strong>Root Cause:</strong> <span class="mono">${ticket.root_cause}</span></p>
            <p style="margin-bottom: 8px; color: var(--text-secondary)">${ticket.human_explanation}</p>
            <button class="btn btn-sm btn-primary" onclick="openFixModalWithTicket()">⚡ Launch Fix Assistant</button>
        </div>
    `;
    
    addTimelineEvent('diagnosis', `Diagnostic Report (${ticket.severity})`, ticket.severity === 'Critical' ? 'var(--status-critical)' : 'var(--status-warning)', html, ticket.timestamp);
    openFixModal(ticket);
}

function openFixModal(ticket) {
    const t = ticket || currentTicket;
    if (!t) return;
    
    document.getElementById('modal-severity-badge').innerText = t.severity || 'Warning';
    document.getElementById('modal-severity-badge').className = `badge ${t.severity === 'Critical' ? 'badge-critical' : 'badge-accent'}`;
    document.getElementById('modal-root-cause').innerText = t.root_cause;
    document.getElementById('modal-explanation').innerText = t.human_explanation;
    
    const evList = document.getElementById('modal-evidence-list');
    evList.innerHTML = '';
    if (t.evidence && Array.isArray(t.evidence)) {
        t.evidence.forEach(e => {
            const li = document.createElement('li');
            li.innerText = e;
            evList.appendChild(li);
        });
    }

    const stepsContainer = document.getElementById('modal-remediation-steps');
    stepsContainer.innerHTML = '';
    if (t.remediation_steps && t.remediation_steps.length > 0) {
        t.remediation_steps.forEach(step => {
            const card = document.createElement('div');
            card.className = 'step-card';
            card.innerHTML = `
                <div class="flex-between">
                    <span class="text-xs font-bold text-muted">STEP ${step.step_number}</span>
                    <span class="badge badge-neutral text-xs">${step.action_type}</span>
                </div>
                <div class="text-sm font-semibold" style="margin-top: 4px;">${step.title}</div>
                <div class="text-xs text-muted" style="margin-top: 2px;">Impact: ${step.impact}</div>
                <div class="step-cmd mono text-xs">
                    <span>${step.command_or_guide}</span>
                    ${step.action_type === 'command' ? `<button class="btn btn-xs" onclick="copyToClipboard('${step.command_or_guide}')">Copy</button>` : ''}
                </div>
            `;
            stepsContainer.appendChild(card);
        });
    } else {
        stepsContainer.innerHTML = `<div class="text-sm text-secondary">${t.recommended_fix}</div>`;
    }

    const pushBtn = document.getElementById('btn-modal-push-isp');
    if (pushBtn) {
        if (t.pushed_to_isp) {
            pushBtn.innerText = `✅ Pushed to ISP Portal (${t.isp_request_id || 'Ref: ISP'})`;
            pushBtn.disabled = true;
            pushBtn.className = "btn btn-secondary";
        } else {
            pushBtn.innerText = "🚀 Push Ticket to ISP Portal";
            pushBtn.disabled = false;
            pushBtn.className = "btn btn-primary";
        }
    }

    const modal = document.getElementById('fix-modal');
    modal.classList.remove('hidden');
}

function pushCurrentTicketToISP() {
    if (!currentTicket) return;
    const notes = prompt("Enter any notes for the ISP Support Desk (optional):", "Experiencing recurring latency/disconnection.");
    if (notes === null) return; // user cancelled

    fetch(`/api/tickets/${currentTicket.id}/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriber_notes: notes })
    })
    .then(res => res.json())
    .then(data => {
        if (data.ticket) {
            currentTicket = data.ticket;
            const reqId = data.ticket.isp_request_id || "ISP-REQ";
            showToast("Escalated to ISP Portal", `Ticket ${data.ticket.number} pushed to ISP support desk (${reqId})`, "critical");
            addTimelineEvent('escalation', `Ticket Escalated to ISP Portal (${reqId})`, 'var(--status-critical)', `<div class="text-xs text-muted">Notes: ${notes}</div>`);
            
            const pushBtn = document.getElementById('btn-modal-push-isp');
            if (pushBtn) {
                pushBtn.innerText = `✅ Pushed to ISP Portal (${reqId})`;
                pushBtn.disabled = true;
                pushBtn.className = "btn btn-secondary";
            }
        }
    })
    .catch(err => {
        console.error("Error pushing ticket to ISP:", err);
        showToast("Error", "Failed to push ticket to ISP portal", "warning");
    });
}

function openFixModalWithTicket() {
    if (currentTicket) openFixModal(currentTicket);
}

function closeFixModal(event) {
    const modal = document.getElementById('fix-modal');
    if (modal) modal.classList.add('hidden');
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text);
    showToast("Copied to Clipboard", text, "info");
}


function clearTimeline() {
    const tl = document.getElementById('timeline');
    if (tl) tl.innerHTML = '<div class="text-muted text-sm">Timeline cleared.</div>';
}

function triggerScenario(name) {
    fetch(`/api/scenario/${name}`, { method: 'POST' })
        .then(r => r.json())
        .then(data => {
            console.log("Scenario loaded:", data);
            showToast("Scenario Active", `Simulating ${name.replace('_', ' ').toUpperCase()}`, "info");
            addTimelineEvent('scenario', `Scenario Loaded: ${name.replace('_', ' ').toUpperCase()}`, 'var(--status-warning)');
        })
        .catch(console.error);
}

function triggerDiagnosis() {
    addTimelineEvent('diagnosing', 'AI Speed Test & Diagnostic Suite Running...', 'var(--status-warning)');
    showToast("Running Diagnostics", "Analyzing telemetry and channel spectrum...", "info");
    fetch('/api/diagnose', { method: 'POST' })
        .then(r => r.json())
        .then(data => {
            console.log("Manual diagnosis triggered:", data);
        })
        .catch(console.error);
}

function openChartModal(metric) {
    activeChartMetric = metric;
    const modal = document.getElementById('chart-modal');
    if (!modal) return;
    
    modal.classList.remove('hidden');
    setTimeout(() => {
        updateActiveChartModal();
    }, 50);
}


function closeChartModal(event) {
    const modal = document.getElementById('chart-modal');
    if (modal) modal.classList.add('hidden');
    activeChartMetric = null;
}

function updateActiveChartModal() {
    if (!activeChartMetric) return;

    let data = historyData[activeChartMetric] || [];
    let title = "Metric Telemetry";
    let unit = "";
    let color = "#38BDF8";
    let thresholdInfo = "";

    if (activeChartMetric === 'rssi') {
        title = "Signal Strength (RSSI)";
        unit = " dBm";
        color = getStatusColor('rssi', data[data.length - 1]);
        thresholdInfo = "• <strong>-30 to -65 dBm</strong>: Excellent / Strong signal<br>• <strong>-67 to -75 dBm</strong>: Medium / Fair signal<br>• <strong>Below -80 dBm</strong>: Weak signal, high risk of frame drops";
    } else if (activeChartMetric === 'latency') {
        title = "Ping Latency (ICMP RTT)";
        unit = " ms";
        color = getStatusColor('latency', data[data.length - 1]);
        thresholdInfo = "• <strong>< 30 ms</strong>: Optimal for real-time voice/gaming<br>• <strong>50 - 100 ms</strong>: Acceptable web browsing<br>• <strong>> 150 ms</strong>: High latency / Upstream ISP bufferbloat";
    } else if (activeChartMetric === 'loss') {
        title = "Packet Loss Percentage";
        unit = "%";
        color = getStatusColor('loss', data[data.length - 1]);
        thresholdInfo = "• <strong>0.0%</strong>: Optimal, no packet retransmissions<br>• <strong>1.0% - 3.0%</strong>: Noticeable video degradation<br>• <strong>> 5.0%</strong>: Critical RF collision or channel congestion";
    } else if (activeChartMetric === 'dns') {
        title = "DNS Lookup Speed";
        unit = " ms";
        color = getStatusColor('latency', data[data.length - 1]);
        thresholdInfo = "• <strong>< 50 ms</strong>: Crisp domain name resolution<br>• <strong>100 - 300 ms</strong>: Slow DNS lookup<br>• <strong>> 1000 ms</strong>: DNS timeout / Unreachable resolver";
    } else if (activeChartMetric === 'health') {
        title = "Wi-Fi Link Health Score";
        unit = "/100";
        color = data[data.length - 1] > 80 ? 'var(--status-excellent)' : (data[data.length - 1] > 50 ? 'var(--status-warning)' : 'var(--status-critical)');
        thresholdInfo = "• <strong>80 - 100</strong>: Excellent overall network health<br>• <strong>50 - 75</strong>: Degraded link stability<br>• <strong>0 - 49</strong>: Critical fault or full disconnection";
    }

    document.getElementById('chart-modal-title').innerText = title;
    document.getElementById('chart-modal-threshold-info').innerHTML = thresholdInfo;

    // Calculate stats
    const current = data[data.length - 1];
    const max = Math.max(...data);
    const min = Math.min(...data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;

    document.getElementById('chart-stat-current').innerText = `${current.toFixed(unit === '%' ? 1 : 0)}${unit}`;
    document.getElementById('chart-stat-avg').innerText = `${avg.toFixed(unit === '%' ? 1 : 0)}${unit}`;
    document.getElementById('chart-stat-max').innerText = `${max.toFixed(unit === '%' ? 1 : 0)}${unit}`;
    document.getElementById('chart-stat-min').innerText = `${min.toFixed(unit === '%' ? 1 : 0)}${unit}`;

    // Draw enlarged high-resolution chart
    drawLargeChart('large-chart-canvas', data, color, unit);
}

function resetToRealTime() {
    fetch('/api/scenario/clear', { method: 'POST' })
        .then(r => r.json())
        .then(data => {
            console.log("Scenario cleared, returned to real-time telemetry:", data);
            if (data.latest) {
                updateDashboard(data.latest);
            }
            showToast("Real-Time Mode Active", "Switched back to live hardware Wi-Fi telemetry", "info");
            addTimelineEvent('scenario', "Switched Back to Live Real-Time Telemetry", 'var(--status-good)');
        })
        .catch(console.error);
}


document.addEventListener('DOMContentLoaded', init);


