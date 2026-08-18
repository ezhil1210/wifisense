function createSparkline(containerId, data, color) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // Create SVG element
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.style.overflow = "visible";
    
    const polyline = document.createElementNS(svgNS, "polyline");
    polyline.setAttribute("fill", "none");
    polyline.setAttribute("stroke", color);
    polyline.setAttribute("stroke-width", "2");
    polyline.setAttribute("stroke-linejoin", "round");
    polyline.setAttribute("stroke-linecap", "round");
    
    // Optional area under the curve
    const gradient = document.createElementNS(svgNS, "linearGradient");
    gradient.id = "grad-" + containerId;
    gradient.setAttribute("x1", "0");
    gradient.setAttribute("x2", "0");
    gradient.setAttribute("y1", "0");
    gradient.setAttribute("y2", "1");
    gradient.innerHTML = `
        <stop offset="0%" stop-color="${color}" stop-opacity="0.3" />
        <stop offset="100%" stop-color="${color}" stop-opacity="0" />
    `;
    
    const defs = document.createElementNS(svgNS, "defs");
    defs.appendChild(gradient);
    svg.appendChild(defs);
    
    const area = document.createElementNS(svgNS, "polygon");
    area.setAttribute("fill", `url(#${gradient.id})`);
    
    svg.appendChild(area);
    svg.appendChild(polyline);
    container.innerHTML = '';
    container.appendChild(svg);
    
    updateSparkline(containerId, data, color);
}

function updateSparkline(containerId, data, color) {
    const container = document.getElementById(containerId);
    if (!container || !data || data.length === 0) return;
    const svg = container.querySelector('svg');
    if (!svg) return;
    
    const rect = container.getBoundingClientRect();
    const width = rect.width || 200; // fallback
    const height = rect.height || 60;
    
    const max = Math.max(...data, 1); // Avoid div by 0
    const min = Math.min(...data, 0);
    const range = max - min;
    
    const points = data.map((val, i) => {
        const x = (i / (data.length - 1)) * width;
        const y = height - (((val - min) / (range || 1)) * (height - 10)) - 5;
        return `${x},${y}`;
    });
    
    const polyline = svg.querySelector('polyline');
    polyline.setAttribute("points", points.join(" "));
    polyline.setAttribute("stroke", color);
    
    const area = svg.querySelector('polygon');
    const areaPoints = `0,${height} ${points.join(" ")} ${width},${height}`;
    area.setAttribute("points", areaPoints);
    
    const gradient = svg.querySelector('stop');
    if (gradient) {
        gradient.setAttribute("stop-color", color);
    }
}

function getStatusColor(metric, value) {
    const styles = getComputedStyle(document.documentElement);
    const exc = styles.getPropertyValue('--status-excellent').trim() || '#00F59B';
    const good = styles.getPropertyValue('--status-good').trim() || '#38BDF8';
    const warn = styles.getPropertyValue('--status-warning').trim() || '#FBBF24';
    const crit = styles.getPropertyValue('--status-critical').trim() || '#FF4757';
    
    if (metric === 'rssi') {
        if (value > -55) return exc;
        if (value > -67) return good;
        if (value > -78) return warn;
        return crit;
    } else if (metric === 'latency' || metric === 'ping') {
        if (value < 20) return exc;
        if (value < 50) return good;
        if (value < 100) return warn;
        return crit;
    } else if (metric === 'loss') {
        if (value === 0) return exc;
        if (value < 2) return warn;
        return crit;
    }
    return good;
}

function updateSignalBars(containerId, rssi) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    let level = 0;
    if (rssi > -67) level = 4;
    else if (rssi > -75) level = 3;
    else if (rssi > -85) level = 2;
    else if (rssi <= -85) level = 1;
    
    const color = getStatusColor('rssi', rssi);
    
    const bars = container.querySelectorAll('.bar');
    bars.forEach((bar, i) => {
        if (i < level) {
            bar.classList.add('active');
            bar.style.backgroundColor = color;
            bar.style.boxShadow = `0 0 8px ${color}`;
        } else {
            bar.classList.remove('active');
            bar.style.backgroundColor = 'var(--surface-elevated)';
            bar.style.boxShadow = 'none';
        }
    });
}

function colorToRgba(color, alpha = 0.3) {
    if (!color) return `rgba(56, 189, 248, ${alpha})`;
    color = color.trim();
    if (color.startsWith('#')) {
        let hex = color.slice(1);
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const num = parseInt(hex, 16);
        if (!isNaN(num)) {
            const r = (num >> 16) & 255;
            const g = (num >> 8) & 255;
            const b = num & 255;
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }
    }
    if (color.startsWith('rgb(')) {
        return color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
    }
    return `rgba(56, 189, 248, ${alpha})`;
}

function drawLargeChart(canvasId, data, color, unit = '') {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !data || data.length === 0) return;

    const container = canvas.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const width = rect.width > 0 ? rect.width : 600;
    const height = rect.height > 0 ? rect.height : 260;

    canvas.width = width * (window.devicePixelRatio || 1);
    canvas.height = height * (window.devicePixelRatio || 1);

    const ctx = canvas.getContext('2d');
    if (ctx.resetTransform) {
        ctx.resetTransform();
    } else {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

    const W = width;
    const H = height;

    const padL = 50;
    const padB = 30;
    const padR = 25;
    const padT = 20;

    const graphW = W - padL - padR;
    const graphH = H - padB - padT;

    ctx.clearRect(0, 0, W, H);

    // Fallback safe stroke & fill colors
    let strokeColor = color || '#38BDF8';
    if (strokeColor.includes('var(')) strokeColor = '#38BDF8';
    const fillColor = colorToRgba(strokeColor, 0.3);

    // Min & Max
    let minVal = Math.min(...data);
    let maxVal = Math.max(...data);
    if (minVal === maxVal) {
        minVal = Math.max(0, minVal - 5);
        maxVal += 5;
    }
    const range = maxVal - minVal;

    // Grid lines & Y-axis labels
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#94A3B8';
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    const steps = 4;
    for (let i = 0; i <= steps; i++) {
        const yVal = minVal + (range * (i / steps));
        const yPos = H - padB - (graphH * (i / steps));

        ctx.beginPath();
        ctx.moveTo(padL, yPos);
        ctx.lineTo(W - padR, yPos);
        ctx.stroke();

        ctx.fillText(yVal.toFixed(unit === '%' ? 1 : 0) + unit, padL - 8, yPos);
    }

    if (data.length < 2) return;

    // Calculate Points
    const points = data.map((val, i) => {
        const x = padL + (i / (data.length - 1)) * graphW;
        const y = H - padB - (((val - minVal) / range) * graphH);
        return { x, y, val };
    });

    // Area Gradient Fill
    try {
        const grad = ctx.createLinearGradient(0, padT, 0, H - padB);
        grad.addColorStop(0, fillColor);
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

        ctx.beginPath();
        ctx.moveTo(points[0].x, H - padB);
        points.forEach(pt => ctx.lineTo(pt.x, pt.y));
        ctx.lineTo(points[points.length - 1].x, H - padB);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
    } catch (e) {
        console.error("Gradient fill error:", e);
    }

    // Chart Line
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Data Point Dots
    points.forEach((pt, idx) => {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, idx === points.length - 1 ? 5 : 3, 0, Math.PI * 2);
        ctx.fillStyle = idx === points.length - 1 ? '#FFFFFF' : strokeColor;
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    });

    // Label
    ctx.fillStyle = '#64748B';
    ctx.textAlign = 'left';
    ctx.fillText('Recent Telemetry Samples ➔', padL, H - 10);
}


