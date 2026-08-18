function formatIST(timestampSeconds) {
    if (!timestampSeconds) return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium' });
    const ms = timestampSeconds > 10000000000 ? timestampSeconds : timestampSeconds * 1000;
    return new Date(ms).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
        timeStyle: 'medium'
    });
}

async function fetchTickets() {
    try {
        const res = await fetch('/api/tickets');
        if (!res.ok) throw new Error('API Error');
        const tickets = await res.json();
        renderTickets(tickets);
    } catch (err) {
        console.error(err);
        document.getElementById('ticket-list').innerHTML = `<div class="text-muted">Failed to load tickets. Is backend running?</div>`;
    }
}

async function clearAllTickets() {
    if (confirm("Are you sure you want to clear all existing tickets?")) {
        try {
            await fetch('/api/tickets', { method: 'DELETE' });
            fetchTickets();
        } catch (err) {
            console.error("Failed to clear tickets", err);
        }
    }
}

let ws;

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host || '127.0.0.1:8765';
    ws = new WebSocket(`${protocol}//${host}/ws/telemetry`);
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'isp_escalation' || data.type === 'diagnosis') {
                fetchTickets();
            }
        } catch (e) {}
    };
    
    ws.onclose = () => setTimeout(connectWebSocket, 2000);
}

function renderTickets(tickets) {
    const container = document.getElementById('ticket-list');
    if (!tickets || tickets.length === 0) {
        container.innerHTML = `<div class="text-muted" style="padding: 24px; text-align: center; background: rgba(255,255,255,0.02); border-radius: 8px;">No active tickets.</div>`;
        return;
    }
    
    container.innerHTML = '';
    tickets.forEach(ticket => {
        const card = document.createElement('div');
        card.className = 'ticket-card';
        card.onclick = () => toggleTicket(ticket.id);
        
        let priorityColor = 'var(--status-neutral)';
        if (ticket.priority === 'High' || ticket.priority === 'high') priorityColor = 'var(--status-critical)';
        else if (ticket.priority === 'Medium' || ticket.priority === 'medium') priorityColor = 'var(--status-warning)';
        
        const isEscalated = ticket.pushed_to_isp || ticket.status === 'pushed_to_isp';

        card.innerHTML = `
            <div class="ticket-header">
                <div>
                    <span class="badge" style="background: ${priorityColor}; color: #000; margin-right: 8px; padding: 4px 8px; border-radius: 4px; font-weight: 700;">${ticket.priority}</span>
                    ${isEscalated ? `<span class="badge" style="background: var(--status-critical); color: #fff; margin-right: 8px;">🚨 Escalated to ISP (${ticket.isp_request_id || 'Ref: ISP'})</span>` : ''}
                    <span style="font-weight: 600; font-size: 17px;">${ticket.number} — ${ticket.root_cause}</span>
                </div>
                <div class="text-sm text-secondary mono" style="font-weight: 500;">Status: <strong style="color: var(--status-good); text-transform: uppercase;">${ticket.status}</strong> | ${formatIST(ticket.timestamp)} IST</div>
            </div>
            
            <div class="ticket-details" id="ticket-details-${ticket.id}">
                ${isEscalated ? `
                <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid var(--status-critical); padding: 12px; border-radius: 6px; margin-bottom: 16px;">
                    <div style="font-weight: 700; color: var(--status-critical); font-size: 14px;">🚨 Subscriber Escalation Request</div>
                    <div style="font-size: 13px; color: var(--text-primary); margin-top: 4px;">ISP Request Ref: <span class="mono fw-bold">${ticket.isp_request_id || 'N/A'}</span></div>
                    <div style="font-size: 13px; color: var(--text-secondary); margin-top: 2px;">Subscriber Notes: "${ticket.subscriber_notes || 'No extra notes provided'}"</div>
                </div>
                ` : ''}

                <div style="margin-bottom: 16px;">
                    <strong>AI Diagnostic Explanation:</strong>
                    <p class="text-secondary" style="margin-top: 8px; line-height: 1.5;">${ticket.human_explanation}</p>
                </div>
                
                <div style="margin-bottom: 16px;">
                    <strong>Evidence Pointers:</strong>
                    <ul class="text-secondary" style="margin-top: 8px; padding-left: 20px;">
                        ${(ticket.evidence || []).map(e => `<li>${e}</li>`).join('')}
                    </ul>
                </div>

                <div style="margin-bottom: 16px;">
                    <strong>Recommended Action:</strong>
                    <p class="text-secondary" style="margin-top: 8px;">${ticket.recommended_fix}</p>
                </div>

                ${ticket.remediation_steps && ticket.remediation_steps.length > 0 ? `
                <div style="margin-bottom: 16px;">
                    <strong>Structured Remediation Steps:</strong>
                    <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px;">
                        ${ticket.remediation_steps.map(s => `
                            <div style="background: rgba(255,255,255,0.04); padding: 10px; border-radius: 6px; border: 1px solid var(--border)">
                                <div style="font-weight: 600; font-size: 13px;">Step ${s.step_number}: ${s.title}</div>
                                <div class="mono text-xs" style="color: var(--status-good); margin-top: 4px;">${s.command_or_guide}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
                ` : ''}
                
                <div style="margin-bottom: 16px;">
                    <strong>Raw Telemetry Snapshot:</strong>
                    <pre class="raw-json mono" style="margin-top: 8px;">${JSON.stringify(ticket, null, 2)}</pre>
                </div>
                
                <div style="display: flex; gap: 12px; margin-top: 24px; border-top: 1px solid var(--border); padding-top: 16px;">
                    <button class="btn btn-primary" onclick="event.stopPropagation(); updateTicketStatus('${ticket.id}', 'in_progress')">👨‍💻 Assign Engineer</button>
                    <button class="btn" style="border-color: var(--status-warning); color: var(--status-warning)" onclick="event.stopPropagation(); updateTicketStatus('${ticket.id}', 'dispatch_field_tech')">🚚 Dispatch Field Tech</button>
                    <button class="btn" style="border-color: var(--status-excellent); color: var(--status-excellent)" onclick="event.stopPropagation(); updateTicketStatus('${ticket.id}', 'resolved')">✅ Resolve & Notify Subscriber</button>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

function toggleTicket(id) {
    const details = document.getElementById(`ticket-details-${id}`);
    if (details) {
        if (details.classList.contains('expanded')) {
            details.classList.remove('expanded');
        } else {
            document.querySelectorAll('.ticket-details').forEach(el => el.classList.remove('expanded'));
            details.classList.add('expanded');
        }
    }
}

async function updateTicketStatus(id, status) {
    const notes = prompt(`Enter ISP resolution note for status '${status}' (optional):`, "ISP edge node reset performed.");
    try {
        await fetch(`/api/tickets/${id}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status, isp_notes: notes || "" })
        });
        fetchTickets();
    } catch (err) {
        console.error("Failed to update status", err);
    }
}

// Initial fetch, WebSocket & polling fallback
fetchTickets();
connectWebSocket();
setInterval(fetchTickets, 8000);

