/* ===========================================================
   Microtubule Resonance Simulator — Main Simulation Engine
   Pure JS, Canvas-based visualizations
   =========================================================== */

// ---- Utility ----
const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const easeOut = t => 1 - Math.pow(1 - t, 3);

function formatFreq(hz) {
  if (hz >= 1e9) return (hz / 1e9).toFixed(1) + ' GHz';
  if (hz >= 1e6) return (hz / 1e6).toFixed(1) + ' MHz';
  if (hz >= 1e3) return (hz / 1e3).toFixed(1) + ' kHz';
  return hz.toFixed(1) + ' Hz';
}

// Store original dimensions and last setup sizes
const canvasOriginals = {};
const canvasLastSize = {};

function setupCanvas(canvas) {
  // Save original dimensions on first call
  if (!canvasOriginals[canvas.id]) {
    canvasOriginals[canvas.id] = { w: canvas.width, h: canvas.height };
  }
  const orig = canvasOriginals[canvas.id];
  const aspect = orig.h / orig.w;
  const dpr = window.devicePixelRatio || 1;
  const container = canvas.parentElement;
  const containerW = container ? container.clientWidth - 2 : 0;
  const w = containerW > 100 ? containerW : orig.w; // fallback if hidden
  const h = Math.round(w * aspect);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  canvasLastSize[canvas.id] = { w, h };
  return { ctx, w, h };
}

function sizeCanvas(canvas) {
  // Lightweight re-size check per frame; only re-setup if container changed
  const orig = canvasOriginals[canvas.id];
  if (!orig) return setupCanvas(canvas);
  const dpr = window.devicePixelRatio || 1;
  const container = canvas.parentElement;
  const containerW = container ? container.clientWidth - 2 : 0;
  if (containerW < 100) return null; // panel hidden, skip render
  const last = canvasLastSize[canvas.id];
  if (last && Math.abs(last.w - containerW) < 2) {
    // Same size, just get ctx
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: last.w, h: last.h };
  }
  return setupCanvas(canvas);
}

// ---- Color Palette ----
const COLORS = {
  hz:    { main: '#42a5f5', glow: 'rgba(66,165,245,', dim: '#1565c0' },
  khz:   { main: '#69f0ae', glow: 'rgba(105,240,174,', dim: '#2e7d32' },
  mhz:   { main: '#ffb300', glow: 'rgba(255,179,0,',   dim: '#e65100' },
  ghz:   { main: '#ff5252', glow: 'rgba(255,82,82,',   dim: '#b71c1c' },
  cyan:  '#00e5ff',
  amber: '#ffb300',
  purple:'#b388ff',
};

const SCALE_COLORS = [COLORS.hz, COLORS.khz, COLORS.mhz, COLORS.ghz];
const SCALE_NAMES  = ['Hz', 'kHz', 'MHz', 'GHz'];
const SCALE_BASES  = [1, 1e3, 1e6, 1e9]; // base frequency for each scale

// ---- Triplet-of-Triplet Frequency Model ----
// Each scale band spans roughly f0 to 40*f0
// 3 main peaks at ~f0*{2, 10, 30} (roughly)
// Each main peak has 3 sub-peaks offset by ~{0.7, 1.0, 1.4} ratio

function generateTripletFrequencies(baseHz) {
  const mainRatios = [2, 10, 30];
  const subRatios  = [0.7, 1.0, 1.4];
  const peaks = [];
  for (let i = 0; i < 3; i++) {
    const mainF = baseHz * mainRatios[i];
    for (let j = 0; j < 3; j++) {
      peaks.push({
        freq: mainF * subRatios[j],
        mainIdx: i,
        subIdx: j,
        amplitude: 0.4 + (j === 1 ? 0.6 : 0.2) + (i === 1 ? 0.15 : 0), // center sub-peak tallest
      });
    }
  }
  return peaks;
}

// Generate all peaks across all scales
const ALL_PEAKS = [];
for (let s = 0; s < 4; s++) {
  const peaks = generateTripletFrequencies(SCALE_BASES[s]);
  peaks.forEach(p => {
    p.scale = s;
    p.color = SCALE_COLORS[s];
    ALL_PEAKS.push(p);
  });
}


/* ===========================================================
   PANEL 1: Fractal Resonance Spectrum
   =========================================================== */
const spectrumState = {
  zoomLevel: 0,     // 0=all, 1=single scale, 2=single peak triplet
  zoomScale: -1,
  zoomPeak: -1,
  animating: true,
  driveFreq: 0,     // 0 = off
  time: 0,
  hoveredPeak: -1,
};

function initSpectrum() {
  const canvas = document.getElementById('spectrumCanvas');
  const { ctx, w, h } = setupCanvas(canvas);

  const slider = document.getElementById('driveFreqSlider');
  const freqLabel = document.getElementById('driveFreqValue');
  const animBtn = document.getElementById('spectrumAnimToggle');
  const resetBtn = document.getElementById('spectrumResetZoom');

  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    if (v === 0) {
      spectrumState.driveFreq = 0;
      freqLabel.textContent = 'Off';
    } else {
      // Map 1-1000 to log scale Hz-GHz
      const freq = Math.pow(10, (v / 1000) * 10); // 1 Hz to 10 GHz
      spectrumState.driveFreq = freq;
      freqLabel.textContent = formatFreq(freq);
    }
  });

  animBtn.addEventListener('click', () => {
    spectrumState.animating = !spectrumState.animating;
    animBtn.textContent = spectrumState.animating ? 'Pulse Off' : 'Pulse On';
    animBtn.classList.toggle('active', spectrumState.animating);
  });

  resetBtn.addEventListener('click', () => {
    spectrumState.zoomLevel = 0;
    spectrumState.zoomScale = -1;
    spectrumState.zoomPeak = -1;
    updateBreadcrumbs();
  });

  // Click-to-zoom
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const cs = canvasLastSize[canvas.id] || { w: 1100, h: 400 };
    handleSpectrumClick(mx, my, cs.w, cs.h);
  });

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const cs = canvasLastSize[canvas.id] || { w: 1100, h: 400 };
    handleSpectrumHover(mx, my, cs.w, cs.h, canvas);
  });

  canvas.addEventListener('mouseleave', () => {
    spectrumState.hoveredPeak = -1;
    canvas.style.cursor = 'default';
  });

  function tick() {
    spectrumState.time += 0.016;
    const size = sizeCanvas(canvas);
    if (size) drawSpectrum(size.ctx, size.w, size.h);
    requestAnimationFrame(tick);
  }
  tick();
}

function getVisiblePeaks() {
  const st = spectrumState;
  if (st.zoomLevel === 0) return ALL_PEAKS;
  if (st.zoomLevel === 1) return ALL_PEAKS.filter(p => p.scale === st.zoomScale);
  if (st.zoomLevel === 2) return ALL_PEAKS.filter(p => p.scale === st.zoomScale && p.mainIdx === st.zoomPeak);
  return ALL_PEAKS;
}

function getFreqRange() {
  const st = spectrumState;
  if (st.zoomLevel === 0) return [0.5, 5e10];
  if (st.zoomLevel === 1) {
    const base = SCALE_BASES[st.zoomScale];
    return [base * 0.5, base * 50];
  }
  if (st.zoomLevel === 2) {
    const peaks = getVisiblePeaks();
    if (peaks.length === 0) return [0.5, 5e10];
    const minF = Math.min(...peaks.map(p => p.freq)) * 0.4;
    const maxF = Math.max(...peaks.map(p => p.freq)) * 2;
    return [minF, maxF];
  }
  return [0.5, 5e10];
}

// Store peak positions for hit-testing
let peakHitAreas = [];

function drawSpectrum(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  const padL = 60, padR = 30, padT = 30, padB = 50;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  // Background grid
  ctx.strokeStyle = 'rgba(30,42,74,0.5)';
  ctx.lineWidth = 0.5;
  const [fMin, fMax] = getFreqRange();
  const logMin = Math.log10(fMin);
  const logMax = Math.log10(fMax);

  // Vertical grid lines at decade boundaries
  for (let dec = Math.floor(logMin); dec <= Math.ceil(logMax); dec++) {
    const x = padL + ((dec - logMin) / (logMax - logMin)) * plotW;
    if (x < padL || x > padL + plotW) continue;
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();

    // Label
    ctx.fillStyle = '#556688';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(formatFreq(Math.pow(10, dec)), x, padT + plotH + 18);
  }

  // Horizontal grid
  for (let i = 0; i <= 4; i++) {
    const y = padT + (i / 4) * plotH;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
  }

  // Axis labels
  ctx.fillStyle = '#8899bb';
  ctx.font = '11px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Frequency (log scale)', padL + plotW / 2, h - 5);
  ctx.save();
  ctx.translate(15, padT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Amplitude', 0, 0);
  ctx.restore();

  // Scale band backgrounds
  if (spectrumState.zoomLevel === 0) {
    for (let s = 0; s < 4; s++) {
      const lo = Math.log10(SCALE_BASES[s] * 0.8);
      const hi = Math.log10(SCALE_BASES[s] * 45);
      const x1 = padL + clamp((lo - logMin) / (logMax - logMin), 0, 1) * plotW;
      const x2 = padL + clamp((hi - logMin) / (logMax - logMin), 0, 1) * plotW;
      ctx.fillStyle = SCALE_COLORS[s].glow + '0.05)';
      ctx.fillRect(x1, padT, x2 - x1, plotH);
    }
  }

  // Draw peaks
  const peaks = getVisiblePeaks();
  const t = spectrumState.time;
  peakHitAreas = [];

  for (let i = 0; i < peaks.length; i++) {
    const p = peaks[i];
    const logF = Math.log10(p.freq);
    const nx = (logF - logMin) / (logMax - logMin);
    if (nx < -0.05 || nx > 1.05) continue;

    const cx = padL + nx * plotW;
    let amp = p.amplitude;

    // Pulse animation
    if (spectrumState.animating) {
      amp *= 0.85 + 0.15 * Math.sin(t * 2 + p.mainIdx * 1.5 + p.subIdx * 0.8);
    }

    // Drive frequency resonance boost
    if (spectrumState.driveFreq > 0) {
      const logDrive = Math.log10(spectrumState.driveFreq);
      const dist = Math.abs(logF - logDrive);
      if (dist < 0.3) {
        const resonance = 1 - dist / 0.3;
        amp *= 1 + resonance * 0.5;
        // Extra glow at resonance
        const gr = ctx.createRadialGradient(cx, padT + plotH, 0, cx, padT + plotH, plotH * 0.6);
        gr.addColorStop(0, p.color.glow + (0.3 * resonance) + ')');
        gr.addColorStop(1, 'transparent');
        ctx.fillStyle = gr;
        ctx.fillRect(cx - plotH * 0.3, padT, plotH * 0.6, plotH);
      }
    }

    // Hover boost
    const isHovered = spectrumState.hoveredPeak === i;
    if (isHovered) amp *= 1.15;

    const peakH = amp * plotH * 0.85;
    const baseY = padT + plotH;

    // Peak width depends on zoom level
    const peakW = spectrumState.zoomLevel === 0 ? plotW * 0.012 : plotW * 0.04;

    // Gaussian-ish peak shape
    ctx.beginPath();
    const steps = 30;
    for (let s = 0; s <= steps; s++) {
      const sx = cx - peakW * 2 + (s / steps) * peakW * 4;
      const dx = (sx - cx) / peakW;
      const sy = baseY - peakH * Math.exp(-dx * dx * 0.8);
      if (s === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.lineTo(cx + peakW * 2, baseY);
    ctx.lineTo(cx - peakW * 2, baseY);
    ctx.closePath();

    // Fill gradient
    const grad = ctx.createLinearGradient(cx, baseY, cx, baseY - peakH);
    grad.addColorStop(0, p.color.glow + '0.1)');
    grad.addColorStop(0.5, p.color.glow + '0.4)');
    grad.addColorStop(1, p.color.main);
    ctx.fillStyle = grad;
    ctx.fill();

    // Outline
    ctx.strokeStyle = isHovered ? '#ffffff' : p.color.main;
    ctx.lineWidth = isHovered ? 2 : 1;
    ctx.beginPath();
    for (let s = 0; s <= steps; s++) {
      const sx = cx - peakW * 2 + (s / steps) * peakW * 4;
      const dx = (sx - cx) / peakW;
      const sy = baseY - peakH * Math.exp(-dx * dx * 0.8);
      if (s === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();

    // Glow tip
    if (spectrumState.animating || isHovered) {
      ctx.beginPath();
      ctx.arc(cx, baseY - peakH, 3, 0, TAU);
      ctx.fillStyle = p.color.main;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, baseY - peakH, 6 + (isHovered ? 4 : 0), 0, TAU);
      ctx.fillStyle = p.color.glow + '0.3)';
      ctx.fill();
    }

    // Frequency label on hover
    if (isHovered) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(formatFreq(p.freq), cx, baseY - peakH - 15);
    }

    // Hit area
    peakHitAreas.push({
      x: cx - peakW * 2,
      y: baseY - peakH,
      w: peakW * 4,
      h: peakH,
      idx: i,
      peak: p,
    });
  }

  // Scale labels (when zoomed out)
  if (spectrumState.zoomLevel === 0) {
    for (let s = 0; s < 4; s++) {
      const midF = SCALE_BASES[s] * 10;
      const nx = (Math.log10(midF) - logMin) / (logMax - logMin);
      const x = padL + nx * plotW;
      ctx.fillStyle = SCALE_COLORS[s].main;
      ctx.font = 'bold 12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(SCALE_NAMES[s], x, padT + 15);
    }
  }

  // Drive frequency indicator line
  if (spectrumState.driveFreq > 0) {
    const logDrive = Math.log10(spectrumState.driveFreq);
    const nx = (logDrive - logMin) / (logMax - logMin);
    const dx = padL + nx * plotW;
    if (dx >= padL && dx <= padL + plotW) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(dx, padT);
      ctx.lineTo(dx, padT + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#ffffff';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('DRIVE', dx, padT - 5);
    }
  }
}

function handleSpectrumClick(mx, my, w, h) {
  for (const hit of peakHitAreas) {
    if (mx >= hit.x && mx <= hit.x + hit.w && my >= hit.y && my <= hit.y + hit.h) {
      const p = hit.peak;
      if (spectrumState.zoomLevel === 0) {
        spectrumState.zoomLevel = 1;
        spectrumState.zoomScale = p.scale;
      } else if (spectrumState.zoomLevel === 1 && spectrumState.zoomScale === p.scale) {
        spectrumState.zoomLevel = 2;
        spectrumState.zoomPeak = p.mainIdx;
      }
      updateBreadcrumbs();
      return;
    }
  }
}

function handleSpectrumHover(mx, my, w, h, canvas) {
  let found = false;
  for (const hit of peakHitAreas) {
    if (mx >= hit.x && mx <= hit.x + hit.w && my >= hit.y && my <= hit.y + hit.h) {
      spectrumState.hoveredPeak = hit.idx;
      canvas.style.cursor = 'pointer';
      found = true;
      break;
    }
  }
  if (!found) {
    spectrumState.hoveredPeak = -1;
    canvas.style.cursor = 'default';
  }
}

function updateBreadcrumbs() {
  const el = document.getElementById('spectrumBreadcrumbs');
  const st = spectrumState;
  let html = '';

  if (st.zoomLevel >= 0) {
    const isCurrent = st.zoomLevel === 0;
    html += `<span class="breadcrumb ${isCurrent ? 'current' : ''}" data-level="0" onclick="spectrumState.zoomLevel=0;spectrumState.zoomScale=-1;spectrumState.zoomPeak=-1;updateBreadcrumbs()">All Scales</span>`;
  }
  if (st.zoomLevel >= 1) {
    html += `<span class="breadcrumb-sep">&rsaquo;</span>`;
    const isCurrent = st.zoomLevel === 1;
    html += `<span class="breadcrumb ${isCurrent ? 'current' : ''}" data-level="1" onclick="spectrumState.zoomLevel=1;spectrumState.zoomPeak=-1;updateBreadcrumbs()">${SCALE_NAMES[st.zoomScale]} Band</span>`;
  }
  if (st.zoomLevel >= 2) {
    html += `<span class="breadcrumb-sep">&rsaquo;</span>`;
    html += `<span class="breadcrumb current">Peak ${st.zoomPeak + 1} Triplet</span>`;
  }

  el.innerHTML = html;
}

// Make these accessible globally for inline onclick
window.spectrumState = spectrumState;
window.updateBreadcrumbs = updateBreadcrumbs;


/* ===========================================================
   PANEL 2: Microtubule Cross-Section
   =========================================================== */
const mtState = {
  view: 'cross', // 'cross' or 'side'
  showHelix: false,
  driveFreq: 0,
  time: 0,
  resonanceIntensity: 0,
  wavePhase: 0,
};

function initMicrotubule() {
  const canvas = document.getElementById('mtCanvas');
  const { ctx, w, h } = setupCanvas(canvas);

  const slider = document.getElementById('mtFreqSlider');
  const freqLabel = document.getElementById('mtFreqValue');
  const crossBtn = document.getElementById('mtViewCross');
  const sideBtn = document.getElementById('mtViewSide');
  const helixBtn = document.getElementById('mtHelixToggle');

  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    if (v === 0) {
      mtState.driveFreq = 0;
      freqLabel.textContent = 'Off';
    } else {
      const freq = Math.pow(10, (v / 1000) * 10);
      mtState.driveFreq = freq;
      freqLabel.textContent = formatFreq(freq);
    }
  });

  crossBtn.addEventListener('click', () => {
    mtState.view = 'cross';
    crossBtn.classList.add('active');
    sideBtn.classList.remove('active');
  });

  sideBtn.addEventListener('click', () => {
    mtState.view = 'side';
    sideBtn.classList.add('active');
    crossBtn.classList.remove('active');
  });

  helixBtn.addEventListener('click', () => {
    mtState.showHelix = !mtState.showHelix;
    helixBtn.classList.toggle('active', mtState.showHelix);
    helixBtn.textContent = mtState.showHelix ? 'Hide 3-Start' : 'Show 3-Start';
  });

  function tick() {
    mtState.time += 0.016;

    // Compute resonance intensity
    let maxRes = 0;
    if (mtState.driveFreq > 0) {
      const logDrive = Math.log10(mtState.driveFreq);
      for (const p of ALL_PEAKS) {
        const dist = Math.abs(Math.log10(p.freq) - logDrive);
        if (dist < 0.2) {
          maxRes = Math.max(maxRes, 1 - dist / 0.2);
        }
      }
    }
    mtState.resonanceIntensity = lerp(mtState.resonanceIntensity, maxRes, 0.05);
    mtState.wavePhase += 0.03 * (1 + mtState.resonanceIntensity * 3);

    const size = sizeCanvas(canvas);
    if (size) drawMicrotubule(size.ctx, size.w, size.h);
    requestAnimationFrame(tick);
  }
  tick();
}

function drawMicrotubule(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  const res = mtState.resonanceIntensity;

  if (mtState.view === 'cross') {
    drawMTCross(ctx, w, h, res);
  } else {
    drawMTSide(ctx, w, h, res);
  }
}

function drawMTCross(ctx, w, h, res) {
  const cx = w * 0.35;
  const cy = h * 0.5;
  const outerR = Math.min(w, h) * 0.3;
  const innerR = outerR * 0.7;
  const nProto = 13;

  // Outer glow at resonance
  if (res > 0.1) {
    const glowR = outerR * (1.1 + res * 0.3);
    const grad = ctx.createRadialGradient(cx, cy, outerR, cx, cy, glowR);
    grad.addColorStop(0, `rgba(0,229,255,${res * 0.3})`);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, TAU);
    ctx.fill();
  }

  // Hollow center
  const centerGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, innerR);
  centerGrad.addColorStop(0, 'rgba(10,14,26,0.9)');
  centerGrad.addColorStop(1, 'rgba(15,21,38,0.5)');
  ctx.fillStyle = centerGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, TAU);
  ctx.fill();

  // Draw 13 protofilaments
  for (let i = 0; i < nProto; i++) {
    const angle = (i / nProto) * TAU - Math.PI / 2;
    const midR = (outerR + innerR) / 2;
    const px = cx + Math.cos(angle) * midR;
    const py = cy + Math.sin(angle) * midR;
    const protoR = (outerR - innerR) / 2 * 0.8;

    // Helix coloring for 3-start
    let color, glowColor;
    if (mtState.showHelix) {
      const helixGroup = i % 3;
      const hcolors = [
        { c: COLORS.cyan, g: 'rgba(0,229,255,' },
        { c: COLORS.amber, g: 'rgba(255,179,0,' },
        { c: COLORS.purple, g: 'rgba(179,136,255,' },
      ];
      color = hcolors[helixGroup].c;
      glowColor = hcolors[helixGroup].g;
    } else {
      color = COLORS.cyan;
      glowColor = 'rgba(0,229,255,';
    }

    // Resonance pulsing per protofilament
    const pulseFactor = res > 0.1 ? 1 + res * 0.15 * Math.sin(mtState.time * 5 + i * 0.5) : 1;

    // Glow
    if (res > 0.1) {
      ctx.beginPath();
      ctx.arc(px, py, protoR * pulseFactor * 1.5, 0, TAU);
      ctx.fillStyle = glowColor + (res * 0.25) + ')';
      ctx.fill();
    }

    // Protofilament circle
    ctx.beginPath();
    ctx.arc(px, py, protoR * pulseFactor, 0, TAU);
    ctx.fillStyle = glowColor + (0.15 + res * 0.3) + ')';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Tubulin dimers (inner dots)
    const dimerAngle = angle;
    const d1x = px + Math.cos(dimerAngle) * protoR * 0.35;
    const d1y = py + Math.sin(dimerAngle) * protoR * 0.35;
    const d2x = px - Math.cos(dimerAngle) * protoR * 0.35;
    const d2y = py - Math.sin(dimerAngle) * protoR * 0.35;

    ctx.beginPath();
    ctx.arc(d1x, d1y, protoR * 0.2, 0, TAU);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(d2x, d2y, protoR * 0.2, 0, TAU);
    ctx.fillStyle = glowColor + '0.5)';
    ctx.fill();

    // Protofilament number
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(i + 1, px, py);
  }

  // Center label
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.font = '11px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('hollow', cx, cy - 8);
  ctx.fillText('lumen', cx, cy + 8);

  // Dimensions annotation
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);

  // Outer diameter line
  const dimY = cy + outerR + 30;
  ctx.beginPath();
  ctx.moveTo(cx - outerR, dimY);
  ctx.lineTo(cx + outerR, dimY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - outerR, dimY - 5);
  ctx.lineTo(cx - outerR, dimY + 5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + outerR, dimY - 5);
  ctx.lineTo(cx + outerR, dimY + 5);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#8899bb';
  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('~25 nm', cx, dimY + 15);

  // Right side: info text
  const textX = w * 0.65;
  let textY = h * 0.15;
  const lineH = 22;

  ctx.textAlign = 'left';
  ctx.font = 'bold 14px Inter, sans-serif';
  ctx.fillStyle = COLORS.cyan;
  ctx.fillText('Microtubule Structure', textX, textY); textY += lineH * 1.5;

  const infoLines = [
    ['Protofilaments:', '13'],
    ['Outer diameter:', '~25 nm'],
    ['Inner diameter:', '~15 nm'],
    ['Tubulin dimers:', '8 nm each'],
    ['Lattice:', '3-start helix'],
    ['Chirality:', 'Left-handed'],
  ];

  ctx.font = '12px Inter, sans-serif';
  for (const [label, value] of infoLines) {
    ctx.fillStyle = '#8899bb';
    ctx.fillText(label, textX, textY);
    ctx.fillStyle = '#e0e6f0';
    ctx.fillText(value, textX + 130, textY);
    textY += lineH;
  }

  // Resonance meter
  textY += lineH;
  ctx.font = 'bold 12px Inter, sans-serif';
  ctx.fillStyle = res > 0.5 ? COLORS.cyan : '#8899bb';
  ctx.fillText('Resonance:', textX, textY);

  const barX = textX + 100;
  const barW = 150;
  const barH = 12;
  ctx.fillStyle = 'rgba(30,42,74,0.8)';
  ctx.fillRect(barX, textY - 10, barW, barH);
  const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
  grad.addColorStop(0, 'rgba(0,229,255,0.3)');
  grad.addColorStop(1, COLORS.cyan);
  ctx.fillStyle = grad;
  ctx.fillRect(barX, textY - 10, barW * res, barH);
  ctx.strokeStyle = 'rgba(0,229,255,0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, textY - 10, barW, barH);
}

function drawMTSide(ctx, w, h, res) {
  const cx = w / 2;
  const cy = h / 2;
  const tubeLen = w * 0.7;
  const tubeH = h * 0.25;
  const startX = cx - tubeLen / 2;
  const endX = cx + tubeLen / 2;
  const nProto = 13;
  const nSegments = 24;

  // Outer glow at resonance
  if (res > 0.1) {
    const grad = ctx.createRadialGradient(cx, cy, tubeH * 0.5, cx, cy, tubeH * 1.5);
    grad.addColorStop(0, `rgba(0,229,255,${res * 0.15})`);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(startX - 50, cy - tubeH * 1.5, tubeLen + 100, tubeH * 3);
  }

  // Draw tube body
  for (let seg = 0; seg < nSegments; seg++) {
    const segX = startX + (seg / nSegments) * tubeLen;
    const segW = tubeLen / nSegments;

    // Only draw visible protofilaments (top half of cylinder)
    for (let p = 0; p < nProto; p++) {
      const angle = (p / nProto) * TAU + mtState.time * 0.2;
      const yOff = Math.sin(angle) * tubeH / 2;
      const visible = Math.cos(angle);

      if (visible < -0.1) continue; // behind the tube

      const opacity = 0.2 + visible * 0.5;
      const dimerY = cy + yOff;

      // Helix coloring
      let color;
      if (mtState.showHelix) {
        const helixGroup = p % 3;
        const hcolors = [COLORS.cyan, COLORS.amber, COLORS.purple];
        color = hcolors[helixGroup];
      } else {
        color = COLORS.cyan;
      }

      // Wave propagation at resonance
      let wave = 0;
      if (res > 0.1) {
        wave = Math.sin(mtState.wavePhase - seg * 0.5) * res;
      }

      const dimW = segW * 0.85;
      const dimH = (tubeH / nProto) * 2.2;

      // Dimer rectangle
      ctx.globalAlpha = opacity + wave * 0.3;
      ctx.fillStyle = color;
      ctx.fillRect(segX + 1, dimerY - dimH / 2, dimW, dimH);

      if (res > 0.1 && wave > 0.3) {
        ctx.fillStyle = `rgba(255,255,255,${wave * 0.3})`;
        ctx.fillRect(segX + 1, dimerY - dimH / 2, dimW, dimH);
      }

      ctx.globalAlpha = 1;
    }
  }

  // Tube outline
  ctx.strokeStyle = `rgba(0,229,255,${0.3 + res * 0.4})`;
  ctx.lineWidth = 1.5;

  // Top edge
  ctx.beginPath();
  ctx.moveTo(startX, cy - tubeH / 2);
  ctx.lineTo(endX, cy - tubeH / 2);
  ctx.stroke();

  // Bottom edge
  ctx.beginPath();
  ctx.moveTo(startX, cy + tubeH / 2);
  ctx.lineTo(endX, cy + tubeH / 2);
  ctx.stroke();

  // End caps (ellipses)
  ctx.beginPath();
  ctx.ellipse(startX, cy, tubeH / 6, tubeH / 2, 0, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(endX, cy, tubeH / 6, tubeH / 2, 0, 0, TAU);
  ctx.stroke();

  // 3-start helix lines
  if (mtState.showHelix) {
    const helixColors = [COLORS.cyan, COLORS.amber, COLORS.purple];
    for (let h = 0; h < 3; h++) {
      ctx.strokeStyle = helixColors[h];
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      for (let x = 0; x <= tubeLen; x += 2) {
        const px = startX + x;
        const angle = (x / tubeLen) * TAU * 3 + (h / 3) * TAU;
        const py = cy + Math.sin(angle) * tubeH / 2 * 0.95;
        if (Math.cos(angle) > 0) {
          if (x === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        } else {
          ctx.moveTo(px, py);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }

  // Wave propagation indicator
  if (res > 0.3) {
    ctx.fillStyle = `rgba(0,229,255,${res * 0.5})`;
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Wave propagating at resonance', cx, cy + tubeH / 2 + 40);

    // Arrow
    const arrowY = cy + tubeH / 2 + 55;
    ctx.strokeStyle = `rgba(0,229,255,${res * 0.5})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 60, arrowY);
    ctx.lineTo(cx + 60, arrowY);
    ctx.lineTo(cx + 50, arrowY - 5);
    ctx.moveTo(cx + 60, arrowY);
    ctx.lineTo(cx + 50, arrowY + 5);
    ctx.stroke();
  }

  // Scale bar
  ctx.fillStyle = '#8899bb';
  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  const scaleW = tubeLen * 0.1;
  const scaleY = h - 30;
  ctx.strokeStyle = '#8899bb';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - scaleW / 2, scaleY);
  ctx.lineTo(cx + scaleW / 2, scaleY);
  ctx.stroke();
  ctx.fillText('~200 nm', cx, scaleY + 15);
}


/* ===========================================================
   PANEL 3: Temporal Cascade
   =========================================================== */
const cascadeState = {
  playing: true,
  speed: 3,
  time: 0,
  model: 'bandyopadhyay', // or 'hh'
  flipped: false,
};

function initCascade() {
  const canvas = document.getElementById('cascadeCanvas');
  const { ctx, w, h } = setupCanvas(canvas);

  const playBtn = document.getElementById('cascadePlayBtn');
  const resetBtn = document.getElementById('cascadeResetBtn');
  const speedSlider = document.getElementById('cascadeSpeedSlider');
  const speedLabel = document.getElementById('cascadeSpeedValue');
  const bandyBtn = document.getElementById('cascadeBandyBtn');
  const hhBtn = document.getElementById('cascadeHHBtn');
  const flipBtn = document.getElementById('cascadeFlipBtn');

  playBtn.addEventListener('click', () => {
    cascadeState.playing = !cascadeState.playing;
    playBtn.textContent = cascadeState.playing ? 'Pause' : 'Play';
    playBtn.classList.toggle('active', cascadeState.playing);
  });

  resetBtn.addEventListener('click', () => {
    cascadeState.time = 0;
  });

  speedSlider.addEventListener('input', () => {
    cascadeState.speed = parseFloat(speedSlider.value);
    speedLabel.textContent = cascadeState.speed + 'x';
  });

  bandyBtn.addEventListener('click', () => {
    cascadeState.model = 'bandyopadhyay';
    bandyBtn.classList.add('active');
    hhBtn.classList.remove('active');
  });

  hhBtn.addEventListener('click', () => {
    cascadeState.model = 'hh';
    hhBtn.classList.add('active');
    bandyBtn.classList.remove('active');
  });

  flipBtn.addEventListener('click', () => {
    cascadeState.flipped = !cascadeState.flipped;
    flipBtn.classList.toggle('active', cascadeState.flipped);
    flipBtn.textContent = cascadeState.flipped ? 'Normal Order' : 'Flip Order';
    cascadeState.time = 0;
  });

  function tick() {
    if (cascadeState.playing) {
      cascadeState.time += 0.016 * cascadeState.speed;
    }
    const size = sizeCanvas(canvas);
    if (size) drawCascade(size.ctx, size.w, size.h);
    requestAnimationFrame(tick);
  }
  tick();
}

function drawCascade(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  const padL = 160, padR = 40, padT = 50, padB = 60;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const model = cascadeState.model;
  const flipped = cascadeState.flipped;
  const cycleLen = 6; // seconds per full cycle
  const t = (cascadeState.time % cycleLen) / cycleLen; // 0-1 normalized time

  // Title
  ctx.fillStyle = '#e0e6f0';
  ctx.font = 'bold 13px Inter, sans-serif';
  ctx.textAlign = 'center';
  if (model === 'bandyopadhyay') {
    ctx.fillText(
      flipped ? 'Bandyopadhyay Model — FLIPPED ORDER (membrane first)' : 'Bandyopadhyay Model — Filaments Fire First',
      w / 2, 25
    );
  } else {
    ctx.fillText('Classical Hodgkin-Huxley Model — Membrane Only', w / 2, 25);
  }

  // Time axis
  ctx.strokeStyle = 'rgba(30,42,74,0.5)';
  ctx.lineWidth = 0.5;
  const timeLabels = ['0 ms', '0.5 ms', '1.0 ms', '1.5 ms', '2.0 ms'];
  for (let i = 0; i < 5; i++) {
    const x = padL + (i / 4) * plotW;
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
    ctx.fillStyle = '#556688';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(timeLabels[i], x, padT + plotH + 20);
  }

  ctx.fillStyle = '#8899bb';
  ctx.font = '11px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Time', padL + plotW / 2, h - 10);

  if (model === 'bandyopadhyay') {
    drawBandyopadhyayCascade(ctx, padL, padT, plotW, plotH, t, flipped);
  } else {
    drawHHCascade(ctx, padL, padT, plotW, plotH, t);
  }

  // Playhead
  const playX = padL + t * plotW;
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(playX, padT);
  ctx.lineTo(playX, padT + plotH);
  ctx.stroke();

  // Playhead glow
  ctx.beginPath();
  ctx.arc(playX, padT - 5, 4, 0, TAU);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}

function drawBandyopadhyayCascade(ctx, padL, padT, plotW, plotH, t, flipped) {
  const rowH = plotH / 3;

  // Row labels
  const labels = flipped
    ? ['Membrane Spike (kHz)', 'Filament Burst 1-2 (MHz)', 'Filament Burst 3-4 (MHz)']
    : ['Filament Burst 1-2 (MHz)', 'Filament Burst 3-4 (MHz)', 'Membrane Spike (kHz)'];
  const rowColors = flipped
    ? [COLORS.khz, COLORS.mhz, COLORS.mhz]
    : [COLORS.mhz, COLORS.mhz, COLORS.khz];

  for (let r = 0; r < 3; r++) {
    const rowY = padT + r * rowH;

    // Label
    ctx.fillStyle = rowColors[r].main;
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(labels[r], padL - 8, rowY + rowH / 2 + 4);

    // Row separator
    ctx.strokeStyle = 'rgba(30,42,74,0.3)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(padL, rowY + rowH);
    ctx.lineTo(padL + plotW, rowY + rowH);
    ctx.stroke();
  }

  // Signal generation
  // Bandyopadhyay timing: ~4 filament bursts in ~250μs, then membrane spike
  // Normalized to fit our 2ms window

  if (!flipped) {
    // Normal order: filaments first, then membrane
    // Row 0: filament bursts 1-2 at t=0.05, t=0.12
    // Row 1: filament bursts 3-4 at t=0.19, t=0.26
    // Row 2: membrane spike at t=0.35

    drawSignalBurst(ctx, padL, padT, plotW, rowH, 0, [0.05, 0.12], t, COLORS.mhz, 'fast');
    drawSignalBurst(ctx, padL, padT + rowH, plotW, rowH, 0, [0.19, 0.26], t, COLORS.mhz, 'fast');
    drawSignalBurst(ctx, padL, padT + 2 * rowH, plotW, rowH, 0, [0.35], t, COLORS.khz, 'slow');

    // Second cycle
    drawSignalBurst(ctx, padL, padT, plotW, rowH, 0, [0.55, 0.62], t, COLORS.mhz, 'fast');
    drawSignalBurst(ctx, padL, padT + rowH, plotW, rowH, 0, [0.69, 0.76], t, COLORS.mhz, 'fast');
    drawSignalBurst(ctx, padL, padT + 2 * rowH, plotW, rowH, 0, [0.85], t, COLORS.khz, 'slow');

    // Causal arrows
    if (t > 0.12 && t < 0.55) {
      drawCausalArrow(ctx, padL + 0.12 * plotW, padT + rowH * 0.5,
                       padL + 0.19 * plotW, padT + rowH * 1.5, t, 0.12, 0.19);
    }
    if (t > 0.26 && t < 0.55) {
      drawCausalArrow(ctx, padL + 0.26 * plotW, padT + rowH * 1.5,
                       padL + 0.35 * plotW, padT + rowH * 2.5, t, 0.26, 0.35);
    }
  } else {
    // Flipped: membrane first, then filaments (testing H4)
    drawSignalBurst(ctx, padL, padT, plotW, rowH, 0, [0.10], t, COLORS.khz, 'slow');

    // Filaments respond chaotically
    drawSignalBurst(ctx, padL, padT + rowH, plotW, rowH, 0, [0.20, 0.28], t, COLORS.mhz, 'noisy');
    drawSignalBurst(ctx, padL, padT + 2 * rowH, plotW, rowH, 0, [0.32, 0.40], t, COLORS.mhz, 'noisy');

    // Second cycle - degraded
    drawSignalBurst(ctx, padL, padT, plotW, rowH, 0, [0.60], t, COLORS.khz, 'slow');
    drawSignalBurst(ctx, padL, padT + rowH, plotW, rowH, 0, [0.72, 0.78], t, COLORS.mhz, 'noisy');
    drawSignalBurst(ctx, padL, padT + 2 * rowH, plotW, rowH, 0, [0.82, 0.90], t, COLORS.mhz, 'noisy');

    // Warning label
    ctx.fillStyle = COLORS.red;
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('DECOHERENT — timing jitter, signal degradation', padL + plotW / 2, padT - 8);
  }

  // 250μs annotation
  if (!flipped) {
    const arrowY = padT + plotH + 35;
    const x1 = padL + 0.05 * plotW;
    const x2 = padL + 0.35 * plotW;
    ctx.strokeStyle = 'rgba(255,179,0,0.6)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x1, arrowY);
    ctx.lineTo(x2, arrowY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLORS.amber;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('~250 μs (filaments lead)', (x1 + x2) / 2, arrowY + 14);
  }
}

function drawSignalBurst(ctx, padL, rowY, plotW, rowH, rowIdx, peakTimes, t, color, mode) {
  const midY = rowY + rowH / 2;
  const ampH = rowH * 0.35;

  ctx.beginPath();
  ctx.moveTo(padL, midY);

  for (let x = 0; x <= plotW; x += 1) {
    const normX = x / plotW;
    let y = 0;

    for (const pt of peakTimes) {
      const dx = normX - pt;
      if (mode === 'fast') {
        // Sharp MHz burst
        y += Math.exp(-(dx * dx) / 0.0003) * Math.sin(dx * 400);
        y += Math.exp(-(dx * dx) / 0.0008) * 0.8;
      } else if (mode === 'slow') {
        // Broader kHz spike
        y += Math.exp(-(dx * dx) / 0.002) * 1.2;
        y += Math.exp(-(dx * dx) / 0.001) * Math.sin(dx * 100) * 0.3;
      } else if (mode === 'noisy') {
        // Degraded signal
        y += Math.exp(-(dx * dx) / 0.0005) * (0.6 + 0.4 * Math.sin(dx * 800 + normX * 50));
        // Add random-looking jitter
        y += Math.exp(-(dx * dx) / 0.001) * 0.3 * Math.sin(normX * 200 + pt * 100);
      }
    }

    // Fade in with time
    const fadeIn = clamp((t - 0) * 8, 0, 1);
    y *= fadeIn;

    ctx.lineTo(padL + x, midY - y * ampH);
  }

  const grad = ctx.createLinearGradient(0, midY - ampH, 0, midY + ampH * 0.3);
  grad.addColorStop(0, color.main);
  grad.addColorStop(1, color.glow + '0.1)');
  ctx.strokeStyle = grad;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Baseline
  ctx.strokeStyle = color.glow + '0.15)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(padL, midY);
  ctx.lineTo(padL + plotW, midY);
  ctx.stroke();
}

function drawCausalArrow(ctx, x1, y1, x2, y2, t, tStart, tEnd) {
  const progress = clamp((t - tStart) / (tEnd - tStart), 0, 1);
  if (progress < 0.1) return;

  const curX = lerp(x1, x2, progress);
  const curY = lerp(y1, y2, progress);

  ctx.strokeStyle = `rgba(255,179,0,${0.5 * progress})`;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(curX, curY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Arrowhead
  if (progress > 0.8) {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(curX, curY);
    ctx.lineTo(curX - 8 * Math.cos(angle - 0.4), curY - 8 * Math.sin(angle - 0.4));
    ctx.moveTo(curX, curY);
    ctx.lineTo(curX - 8 * Math.cos(angle + 0.4), curY - 8 * Math.sin(angle + 0.4));
    ctx.stroke();
  }
}

function drawHHCascade(ctx, padL, padT, plotW, plotH, t) {
  // Classical model: single membrane channel
  const midY = padT + plotH / 2;

  ctx.fillStyle = COLORS.khz.main;
  ctx.font = '11px Inter, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('Membrane Potential (mV)', padL - 8, midY + 4);

  // Hodgkin-Huxley action potential shape
  ctx.beginPath();
  ctx.moveTo(padL, midY + plotH * 0.15); // resting at -70mV

  for (let x = 0; x <= plotW; x += 1) {
    const normX = x / plotW;
    let v = 0;

    // Two action potentials
    for (const spike of [0.25, 0.7]) {
      const dx = normX - spike;
      // Classic AP shape: fast rise, slow fall
      if (dx > -0.02 && dx < 0.12) {
        const phase = (dx + 0.02) / 0.14;
        if (phase < 0.15) {
          v += (phase / 0.15) * 1.0; // depolarization
        } else if (phase < 0.3) {
          v += 1.0 - ((phase - 0.15) / 0.15) * 1.3; // repolarization
        } else if (phase < 0.6) {
          v += -0.3 + ((phase - 0.3) / 0.3) * 0.3; // hyperpolarization recovery
        }
      }
    }

    const fadeIn = clamp((t - 0) * 5, 0, 1);
    v *= fadeIn;

    ctx.lineTo(padL + x, midY - v * plotH * 0.3);
  }

  ctx.strokeStyle = COLORS.khz.main;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Labels
  ctx.fillStyle = '#8899bb';
  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText('+40 mV', padL + 5, midY - plotH * 0.28);
  ctx.fillText('-70 mV', padL + 5, midY + plotH * 0.17);
  ctx.fillText('-90 mV', padL + 5, midY + plotH * 0.25);

  // Note
  ctx.fillStyle = '#556688';
  ctx.font = '11px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Classical model: membrane-only, no filament precursor signal', padL + plotW / 2, padT + plotH + 35);
  ctx.fillText('Millisecond timescale only — no MHz component', padL + plotW / 2, padT + plotH + 52);
}


/* ===========================================================
   PANEL 4: Holographic Projection
   =========================================================== */
const holoState = {
  stimulation: 50,
  activeClock: 'mhz', // 'mhz', 'ghz', 'thz', 'all'
  time: 0,
  particles: [],
};

function initHolographic() {
  const canvas = document.getElementById('holoCanvas');
  const { ctx, w, h } = setupCanvas(canvas);

  const stimSlider = document.getElementById('holoStimSlider');
  const stimLabel = document.getElementById('holoStimValue');
  const clock1 = document.getElementById('holoClock1');
  const clock2 = document.getElementById('holoClock2');
  const clock3 = document.getElementById('holoClock3');
  const clockAll = document.getElementById('holoClockAll');

  stimSlider.addEventListener('input', () => {
    holoState.stimulation = parseFloat(stimSlider.value);
    stimLabel.textContent = holoState.stimulation + '%';
  });

  const clockBtns = { mhz: clock1, ghz: clock2, thz: clock3, all: clockAll };
  for (const [key, btn] of Object.entries(clockBtns)) {
    btn.addEventListener('click', () => {
      holoState.activeClock = key;
      Object.values(clockBtns).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  }

  // Initialize particles
  for (let i = 0; i < 200; i++) {
    holoState.particles.push({
      angle: Math.random() * TAU,
      r: 30 + Math.random() * 200,
      speed: 0.002 + Math.random() * 0.008,
      size: 1 + Math.random() * 2,
      clock: ['mhz', 'ghz', 'thz'][Math.floor(Math.random() * 3)],
      phase: Math.random() * TAU,
    });
  }

  function tick() {
    holoState.time += 0.016;
    const size = sizeCanvas(canvas);
    if (size) drawHolographic(size.ctx, size.w, size.h);
    requestAnimationFrame(tick);
  }
  tick();
}

function drawHolographic(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const stim = holoState.stimulation / 100;
  const t = holoState.time;

  const clockColors = {
    mhz:  { main: COLORS.cyan,   glow: 'rgba(0,229,255,',   r: [60, 110, 160] },
    ghz:  { main: COLORS.amber,  glow: 'rgba(255,179,0,',   r: [80, 130, 180] },
    thz:  { main: COLORS.purple, glow: 'rgba(179,136,255,',  r: [100, 150, 200] },
  };

  // Central microtubule representation
  const coreR = 25;
  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 2);
  coreGrad.addColorStop(0, 'rgba(255,255,255,0.2)');
  coreGrad.addColorStop(0.5, 'rgba(0,229,255,0.15)');
  coreGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, coreR * 2, 0, TAU);
  ctx.fill();

  // Core structure (simplified MT cross-section)
  for (let i = 0; i < 13; i++) {
    const angle = (i / 13) * TAU;
    const px = cx + Math.cos(angle) * coreR;
    const py = cy + Math.sin(angle) * coreR;
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, TAU);
    ctx.fillStyle = `rgba(0,229,255,${0.3 + stim * 0.5})`;
    ctx.fill();
  }

  // Optical vortex rings
  const activeClocks = holoState.activeClock === 'all'
    ? ['mhz', 'ghz', 'thz']
    : [holoState.activeClock];

  for (const clockKey of activeClocks) {
    const clock = clockColors[clockKey];
    const rings = clock.r;

    for (let ri = 0; ri < rings.length; ri++) {
      const baseR = rings[ri];
      const r = baseR + Math.sin(t * (1 + ri * 0.3) + ri) * 5;
      const opacity = stim * (0.15 + ri * 0.05);

      // Vortex ring
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.strokeStyle = clock.glow + opacity + ')';
      ctx.lineWidth = 2 + stim * 2;
      ctx.stroke();

      // Inner glow
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.strokeStyle = clock.glow + (opacity * 0.3) + ')';
      ctx.lineWidth = 8 + stim * 4;
      ctx.stroke();

      // Angular momentum indicator (rotating dash)
      const nDashes = 6 + ri * 2;
      for (let d = 0; d < nDashes; d++) {
        const dAngle = (d / nDashes) * TAU + t * (1.5 + ri * 0.5);
        const dLen = 0.15;
        const x1 = cx + Math.cos(dAngle) * r;
        const y1 = cy + Math.sin(dAngle) * r;
        const x2 = cx + Math.cos(dAngle + dLen) * r;
        const y2 = cy + Math.sin(dAngle + dLen) * r;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = clock.main;
        ctx.lineWidth = 2;
        ctx.globalAlpha = stim * 0.6;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  // Particles (photons with angular momentum)
  for (const p of holoState.particles) {
    if (holoState.activeClock !== 'all' && p.clock !== holoState.activeClock) continue;

    p.angle += p.speed * (1 + stim);
    p.phase += 0.02;

    const clock = clockColors[p.clock];
    const px = cx + Math.cos(p.angle) * p.r;
    const py = cy + Math.sin(p.angle) * p.r;
    const brightness = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(p.phase));

    ctx.beginPath();
    ctx.arc(px, py, p.size * (0.8 + stim * 0.5), 0, TAU);
    ctx.fillStyle = clock.glow + (brightness * stim * 0.7) + ')';
    ctx.fill();
  }

  // Labels for active clocks
  let labelY = 30;
  ctx.textAlign = 'left';
  ctx.font = '12px Inter, sans-serif';
  for (const clockKey of activeClocks) {
    const clock = clockColors[clockKey];
    ctx.fillStyle = clock.main;
    ctx.globalAlpha = stim;
    ctx.fillText(
      clockKey.toUpperCase() + ' clock — angular momentum = ' + (clockKey === 'mhz' ? '1' : clockKey === 'ghz' ? '2' : '3'),
      20, labelY
    );
    labelY += 20;
    ctx.globalAlpha = 1;
  }

  // Corner annotation
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.font = '10px Inter, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('Each ring = distinct angular momentum state', w - 20, h - 20);
  ctx.fillText('EM stimulation selectively brightens components', w - 20, h - 35);
}


/* ===========================================================
   PANEL 5: Hypothesis Lab
   =========================================================== */
const hypotheses = [
  {
    id: 'H1', title: 'Fractal Coherent Amplification',
    status: 'untested',
    claim: 'The 50-1000x CISS amplification gap is explained by coherent Berry phase accumulation across fractal frequency scales — not stronger spin-orbit coupling.',
    test: 'Model nested chiral boundaries (tube-in-tube). Compare phase accumulation: random (sqrt(N)) vs coherent (N). If 4 frequency decades x 9 sub-modes = 36 coherent contributions -> 36-1000x amplification range.',
    falsification: 'If phases add randomly at resonance, amplification stays at ~6x (sqrt(36)). Insufficient.',
    panel: 'spectrum',
    notes: '',
  },
  {
    id: 'H2', title: 'Chirality Is Necessary for Resonance',
    status: 'untested',
    claim: 'The triplet-of-triplet resonance pattern requires chiral geometry — achiral tubes won\'t produce it.',
    test: 'Run the same driving frequencies through a straight cylinder (no helical pitch) vs the 13-protofilament chiral microtubule. Compare resonance spectra.',
    falsification: 'If achiral geometry produces the same fractal resonance pattern, chirality isn\'t the mechanism.',
    panel: 'crosssection',
    notes: '',
  },
  {
    id: 'H3', title: 'Boundary Dominates Bulk',
    status: 'untested',
    claim: 'Amplification happens at the interface (membrane/surface), not in the bulk of the chiral structure — matching CISS spinterface theory.',
    test: 'Model energy distribution: what fraction concentrates at the boundary vs propagates through bulk? Vary tube length — if amplification scales with length, it\'s bulk. If it plateaus, it\'s boundary.',
    falsification: 'Linear scaling with tube length = bulk transport wins.',
    panel: 'crosssection',
    notes: '',
  },
  {
    id: 'H4', title: 'Filament-First Temporal Ordering',
    status: 'untested',
    claim: 'In a coupled oscillator model (fast MHz filament + slow kHz membrane), the filament must fire first to produce coherent output. Reversing the order produces noise.',
    test: 'Panel 3\'s temporal cascade — flip the firing order. Does membrane-first produce coherent downstream signal? Predict: no, it produces decoherent mess.',
    falsification: 'If membrane-first produces equally coherent output, the temporal ordering isn\'t causal.',
    panel: 'cascade',
    notes: '',
  },
  {
    id: 'H5', title: 'Golden Ratio Geometry Maximizes Coupling',
    status: 'untested',
    claim: 'The specific pitch angle of microtubules (~1/phi relationship) maximizes energy focusing. Other pitch angles couple less efficiently.',
    test: 'Sweep helix pitch angle from 0 deg to 45 deg. Plot coupling efficiency. Predict: peak near the microtubule\'s actual pitch angle (~12 deg for 3-start helix).',
    falsification: 'If coupling efficiency is flat across angles, geometry doesn\'t matter.',
    panel: 'crosssection',
    notes: '',
  },
  {
    id: 'H6', title: 'Thermal Noise as Fuel, Not Enemy',
    status: 'untested',
    claim: 'The fractal resonance structure extracts energy from broadband thermal noise (5-6 THz) — noise drives the system rather than degrading it.',
    test: 'Feed white noise into the resonator. Measure output SNR at resonant frequencies. Predict: SNR increases with noise amplitude up to a threshold (stochastic resonance).',
    falsification: 'If SNR degrades monotonically with noise, the system needs clean input.',
    panel: 'spectrum',
    notes: '',
  },
  {
    id: 'H7', title: 'Scale Invariance Predicts New Resonances',
    status: 'untested',
    claim: 'If the triplet pattern is truly fractal, it should extend BELOW Hz (sub-Hz, matching Schumann harmonics) and ABOVE GHz (THz, matching thermal IR).',
    test: 'Extrapolate the fractal pattern. Do predicted sub-Hz peaks align with Schumann resonance harmonics (7.83, 14.3, 20.8, 27.3, 33.8 Hz)? Do predicted THz peaks align with Bandyopadhyay\'s 5-6 THz thermal driver?',
    falsification: 'If extrapolated frequencies don\'t match known values at either end, the fractal model breaks at scale boundaries.',
    panel: 'spectrum',
    notes: '',
  },
];

function initHypothesisLab() {
  const grid = document.getElementById('hypothesisGrid');
  grid.innerHTML = '';

  // Load saved notes from localStorage
  const savedNotes = JSON.parse(localStorage.getItem('hypo_notes') || '{}');
  const savedStatuses = JSON.parse(localStorage.getItem('hypo_statuses') || '{}');

  for (const hypo of hypotheses) {
    if (savedNotes[hypo.id]) hypo.notes = savedNotes[hypo.id];
    if (savedStatuses[hypo.id]) hypo.status = savedStatuses[hypo.id];
  }

  for (const hypo of hypotheses) {
    const card = document.createElement('div');
    card.className = 'hypothesis-card';
    card.dataset.id = hypo.id;

    const statusLabel = {
      untested: 'Untested',
      supported: 'Supported',
      plausible: 'Plausible',
      consistent: 'Consistent',
      unvalidated: 'Unvalidated',
      inconclusive: 'Inconclusive',
      falsified: 'Falsified'
    };

    card.innerHTML = `
      <div class="hypo-header">
        <span class="hypo-id">${hypo.id}</span>
        <span class="status-badge ${hypo.status}">${statusLabel[hypo.status]}</span>
      </div>
      <div class="hypo-title">${hypo.title}</div>
      <div class="hypo-claim"><strong>Claim:</strong> ${hypo.claim}</div>
      <div class="hypo-detail">
        <div class="hypo-test"><strong>Test:</strong> ${hypo.test}</div>
        <div class="hypo-falsification"><strong>Falsification:</strong> ${hypo.falsification}</div>
        <div class="hypo-actions">
          <button class="btn" onclick="goToPanel('${hypo.panel}')">Go to Panel</button>
          <button class="btn" onclick="cycleStatus('${hypo.id}')">Cycle Status</button>
          <button class="btn physics-action-btn" onclick="runHypothesisTest('${hypo.id}', this)">Run Computation</button>
        </div>
        <textarea class="hypo-notes" placeholder="Add notes/observations..."
          onchange="saveHypoNote('${hypo.id}', this.value)">${hypo.notes}</textarea>
      </div>
    `;

    card.addEventListener('click', (e) => {
      // Don't toggle if clicking on interactive elements
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'TEXTAREA') return;
      card.classList.toggle('expanded');
    });

    grid.appendChild(card);
  }
}

window.goToPanel = function(panelId) {
  const tabs = document.querySelectorAll('.panel-tab');
  const panels = document.querySelectorAll('.panel');
  tabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.panel === panelId);
  });
  panels.forEach(p => {
    p.classList.toggle('active', p.id === 'panel-' + panelId);
  });
};

window.cycleStatus = function(hypoId) {
  const order = ['untested', 'supported', 'plausible', 'consistent', 'unvalidated', 'inconclusive', 'falsified'];
  const hypo = hypotheses.find(h => h.id === hypoId);
  if (!hypo) return;
  const idx = order.indexOf(hypo.status);
  hypo.status = order[(idx + 1) % order.length];

  // Save
  const saved = JSON.parse(localStorage.getItem('hypo_statuses') || '{}');
  saved[hypoId] = hypo.status;
  localStorage.setItem('hypo_statuses', JSON.stringify(saved));

  // Update UI
  const card = document.querySelector(`.hypothesis-card[data-id="${hypoId}"]`);
  if (card) {
    const badge = card.querySelector('.status-badge');
    badge.className = 'status-badge ' + hypo.status;
    badge.textContent = { untested: 'Untested', supported: 'Supported', plausible: 'Plausible', consistent: 'Consistent', unvalidated: 'Unvalidated', inconclusive: 'Inconclusive', falsified: 'Falsified' }[hypo.status];
  }
};

window.saveHypoNote = function(hypoId, value) {
  const saved = JSON.parse(localStorage.getItem('hypo_notes') || '{}');
  saved[hypoId] = value;
  localStorage.setItem('hypo_notes', JSON.stringify(saved));
};

window.runHypothesisTest = async function(hypoId, btn) {
  if (!window.HypothesisRunner) {
    alert('Physics engine not loaded');
    return;
  }

  const origText = btn.textContent;
  btn.textContent = 'Computing...';
  btn.disabled = true;

  await new Promise(r => setTimeout(r, 50));

  try {
    const result = await HypothesisRunner.runTest(hypoId);
    updateHypothesisCard(hypoId, result);
  } catch (e) {
    console.error('Hypothesis test error:', e);
  }

  btn.textContent = origText;
  btn.disabled = false;
};


/* ===========================================================
   Panel Navigation & Initialization
   =========================================================== */
function initNavigation() {
  const tabs = document.querySelectorAll('.panel-tab');
  const panels = document.querySelectorAll('.panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.panel;
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('panel-' + target).classList.add('active');
    });
  });
}

// Initialize everything
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initSpectrum();
  initMicrotubule();
  initCascade();
  initHolographic();
  initHypothesisLab();
  initPhysicsToggle();
  initPhysicsControls();
  initMetaAnalysis();
});


/* ===========================================================
   META-ANALYSIS: Sensitivity, Structure Comparison, Energy Budget
   =========================================================== */
function initMetaAnalysis() {
  const resultsDiv = document.getElementById('metaResults');
  if (!resultsDiv) return;

  // ---- Sensitivity Analysis ----
  const sensBtn = document.getElementById('runSensitivityBtn');
  if (sensBtn) {
    sensBtn.addEventListener('click', async () => {
      sensBtn.disabled = true;
      sensBtn.textContent = 'Computing (~30s)...';
      await new Promise(r => setTimeout(r, 50));

      try {
        const result = Engine8.run({ perturbRange: 0.3, nSamples: 5 });
        PhysicsResults.engine8 = result;
        renderSensitivityResults(result, resultsDiv);
      } catch (e) {
        console.error('Sensitivity analysis error:', e);
      }

      sensBtn.disabled = false;
      sensBtn.innerHTML = '<span class="meta-btn-icon">&#x2194;</span> Run Sensitivity Analysis';
    });
  }

  // ---- Structure Comparison ----
  const structBtn = document.getElementById('runStructureBtn');
  if (structBtn) {
    structBtn.addEventListener('click', async () => {
      structBtn.disabled = true;
      structBtn.textContent = 'Computing...';
      await new Promise(r => setTimeout(r, 50));

      try {
        const result = Engine9.run({ nModes: 36, nRandomTrials: 10000 });
        PhysicsResults.engine9 = result;
        renderStructureResults(result, resultsDiv);
      } catch (e) {
        console.error('Structure comparison error:', e);
      }

      structBtn.disabled = false;
      structBtn.innerHTML = '<span class="meta-btn-icon">&#x25B3;</span> Run Structure Comparison';
    });
  }

  // ---- Energy Budget ----
  const energyBtn = document.getElementById('runEnergyBtn');
  if (energyBtn) {
    energyBtn.addEventListener('click', async () => {
      energyBtn.disabled = true;
      energyBtn.textContent = 'Computing...';
      await new Promise(r => setTimeout(r, 50));

      try {
        const result = Engine10.run();
        PhysicsResults.engine10 = result;
        renderEnergyResults(result, resultsDiv);
      } catch (e) {
        console.error('Energy budget error:', e);
      }

      energyBtn.disabled = false;
      energyBtn.innerHTML = '<span class="meta-btn-icon">&#x26A1;</span> Run Energy Budget';
    });
  }
}

function renderSensitivityResults(result, container) {
  // Remove existing sensitivity card if present
  const existing = container.querySelector('#sensitivityCard');
  if (existing) existing.remove();

  const card = document.createElement('div');
  card.className = 'meta-result-card';
  card.id = 'sensitivityCard';

  const details = result.summary.details;
  let tableRows = '';
  for (const d of details) {
    const cls = d.robustness === 'robust' ? 'robust' : d.robustness === 'moderate' ? 'moderate' : 'fragile';
    const pct = d.score !== undefined ? (d.score * 100).toFixed(0) + '%' : 'N/A';
    const barW = d.score !== undefined ? Math.round(d.score * 120) : 0;
    const barColor = d.robustness === 'robust' ? 'green' : d.robustness === 'moderate' ? 'amber' : 'red';
    const fragile = d.fragileParams && d.fragileParams.length > 0
      ? d.fragileParams.map(f => f.name + ' (' + f.robustness + ')').join(', ')
      : 'none';

    tableRows += `<tr>
      <td>${d.id}</td>
      <td class="${cls}">${d.robustness}</td>
      <td class="bar-cell"><span class="bar-fill ${barColor}" style="width:${barW}px"></span>${pct}</td>
      <td>${fragile}</td>
    </tr>`;
  }

  // Add H3 and H7
  tableRows += `<tr><td>H3</td><td style="color:#9e9e9e">N/A</td><td>—</td><td>Tautological</td></tr>`;
  tableRows += `<tr><td>H7</td><td style="color:#9e9e9e">N/A</td><td>—</td><td>Has Monte Carlo null</td></tr>`;

  card.innerHTML = `
    <h4>Sensitivity Analysis</h4>
    <div class="result-summary">
      Parameter perturbation ±30%. Overall robustness: <strong>${result.summary.overallRobustness}</strong>
      across ${result.summary.analyzed} hypotheses.
      <br><em>How stable are verdicts when we jiggle the model's assumptions?</em>
    </div>
    <table class="meta-table">
      <thead><tr><th>Hypo</th><th>Stability</th><th>Score</th><th>Fragile Parameters</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  `;

  container.prepend(card);
}

function renderStructureResults(result, container) {
  const existing = container.querySelector('#structureCard');
  if (existing) existing.remove();

  const card = document.createElement('div');
  card.className = 'meta-result-card';
  card.id = 'structureCard';

  const maxAmp = result.comparison[0].amplitude; // sorted desc
  let tableRows = '';
  for (const c of result.comparison) {
    const barW = Math.round((c.amplitude / maxAmp) * 160);
    const isFractal = c.name.includes('our model');
    const isPerfect = c.name.includes('Perfect');
    const isRandom = c.name.includes('Random');
    const cls = isFractal ? 'winner' : '';
    const barColor = isFractal ? 'cyan' : isPerfect ? 'green' : isRandom ? 'grey' : 'purple';

    tableRows += `<tr>
      <td class="${cls}">${c.name}</td>
      <td class="bar-cell"><span class="bar-fill ${barColor}" style="width:${barW}px"></span>${c.amplitude.toFixed(1)}</td>
      <td>${c.relativeToRandom.toFixed(2)}x</td>
      <td>${c.efficiency}</td>
    </tr>`;
  }

  const fractalSpecial = result.fractalIsSpecial;
  const summaryText = fractalSpecial
    ? `The fractal triplet-of-triplet pattern <strong>beats all ${result.totalAlternatives} alternative structures</strong>. The inter-scale nesting provides coherence that simpler ordered arrangements don't achieve.`
    : `The fractal pattern ranks <strong>#${result.fractalRank}</strong> out of ${result.comparison.length}. It beats ${result.fractalBeatsOthers}/${result.totalAlternatives} alternatives. ${result.bestAlternative ? 'Best alternative: ' + result.bestAlternative.name + ' at ' + result.bestAlternative.amplitude.toFixed(1) + '.' : ''}`;

  card.innerHTML = `
    <h4>Alternative Structure Comparison (H1 Deep Null)</h4>
    <div class="result-summary">
      ${summaryText}
      <br><em>Does the fractal pattern beat other plausible ordered arrangements, or does any order work?</em>
    </div>
    <table class="meta-table">
      <thead><tr><th>Structure</th><th>Coherent Amplitude (N=36)</th><th>vs Random</th><th>Efficiency</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  `;

  container.prepend(card);
}

function renderEnergyResults(result, container) {
  const existing = container.querySelector('#energyCard');
  if (existing) existing.remove();

  const card = document.createElement('div');
  card.className = 'meta-result-card';
  card.id = 'energyCard';

  const vcls = result.verdict === 'feasible' ? 'feasible' : result.verdict === 'marginal' ? 'marginal' : 'implausible';

  card.innerHTML = `
    <h4>Energy Budget — Can a Neuron Afford This?</h4>
    <div class="result-summary">
      <strong class="${vcls}">${result.verdict.toUpperCase()}</strong> — ${result.summary}
    </div>
    <table class="meta-table">
      <thead><tr><th>Parameter</th><th>Value</th></tr></thead>
      <tbody>
        <tr><td>Frequency</td><td>${result.scenario.freqMHz} MHz</td></tr>
        <tr><td>Active dimers per MT</td><td>${result.scenario.activeDimersPerMT} (${result.scenario.activeFraction} of ${Engine10.CONSTANTS.dimers_per_MT})</td></tr>
        <tr><td>Power per microtubule</td><td>${result.energetics.powerPerMT_label}</td></tr>
        <tr><td>Total MT power (${(Engine10.CONSTANTS.MT_per_neuron/1000).toFixed(0)}k MTs)</td><td>${result.energetics.totalMTPower_label}</td></tr>
        <tr><td>Fraction of neuron budget</td><td class="${vcls}">${result.energetics.budgetFraction}</td></tr>
        <tr><td>ATP molecules/sec needed</td><td>${result.energetics.ATPperSecond}</td></tr>
        <tr><td>Fraction of neuron ATP</td><td>${result.energetics.ATPbudgetFraction}</td></tr>
        <tr><td colspan="2" style="color:var(--text-dim);padding-top:0.6rem;font-style:italic">Viscous dissipation (${result.dissipation.amplitude_angstroms}Å amplitude)</td></tr>
        <tr><td>Drag per dimer</td><td>${result.dissipation.dragPerDimer_label}</td></tr>
        <tr><td>Total drag power</td><td>${result.dissipation.totalDragPower_label}</td></tr>
        <tr><td>Drag budget fraction</td><td class="${vcls}">${result.dissipation.dragBudgetFraction}</td></tr>
        <tr><td colspan="2" style="color:var(--text-dim);padding-top:0.6rem;font-style:italic">Thermal noise</td></tr>
        <tr><td>kT/2 at 37°C</td><td>${result.thermal.thermalEnergyPerMode_J} J</td></tr>
        <tr><td>Thermal sufficient?</td><td>${result.thermal.thermalSufficient ? 'Yes' : 'No'} — ${result.thermal.thermalNote}</td></tr>
      </tbody>
    </table>
  `;

  container.prepend(card);
}


/* ===========================================================
   PHYSICS ENGINE INTEGRATION
   Wires physics.js engines into the visual panels
   =========================================================== */

function initPhysicsToggle() {
  const btn = document.getElementById('physicsToggle');
  const hint = document.getElementById('physicsHint');
  if (!btn) return;

  btn.addEventListener('click', () => {
    PhysicsMode.active = !PhysicsMode.active;
    btn.textContent = PhysicsMode.active ? 'Physics: Computed' : 'Physics: Visual';
    btn.classList.toggle('active', PhysicsMode.active);
    hint.textContent = PhysicsMode.active
      ? 'Real numerical models active'
      : 'Switch to computed physics engine';

    // Show/hide physics controls
    document.querySelectorAll('.physics-controls').forEach(el => {
      el.style.display = PhysicsMode.active ? 'flex' : 'none';
    });

    // When entering physics mode, run Engine 1 for cascade
    if (PhysicsMode.active && !PhysicsResults.engine1) {
      PhysicsResults.engine1 = Engine1.run({
        coupling: PhysicsMode.couplingStrength,
        damping: PhysicsMode.damping,
      });
    }
  });
}

function initPhysicsControls() {
  // ---- Panel 1: Spectrum physics controls ----
  const noiseSlider = document.getElementById('noiseAmpSlider');
  const noiseLabel = document.getElementById('noiseAmpValue');
  if (noiseSlider) {
    noiseSlider.addEventListener('input', () => {
      PhysicsMode.noiseAmplitude = parseFloat(noiseSlider.value) / 100;
      noiseLabel.textContent = PhysicsMode.noiseAmplitude.toFixed(2);
    });
  }

  const mcBtn = document.getElementById('runMonteCarloBtn');
  const mcStatus = document.getElementById('monteCarloStatus');
  if (mcBtn) {
    mcBtn.addEventListener('click', async () => {
      mcStatus.textContent = 'Computing...';
      mcStatus.className = 'computation-badge computing';
      await new Promise(r => setTimeout(r, 50));

      try {
        const result = Engine2.run({ noiseLevels: 16, nTrials: 500 });
        PhysicsResults.engine2 = result;
        mcStatus.textContent = 'Done';
        mcStatus.className = 'computation-badge done';
        showSpectrumResults(result);
      } catch (e) {
        mcStatus.textContent = 'Error';
        mcStatus.className = 'computation-badge error';
      }
    });
  }

  const extendBtn = document.getElementById('extendScaleBtn');
  if (extendBtn) {
    extendBtn.addEventListener('click', () => {
      PhysicsMode.showExtendedScale = !PhysicsMode.showExtendedScale;
      extendBtn.classList.toggle('active', PhysicsMode.showExtendedScale);
      extendBtn.textContent = PhysicsMode.showExtendedScale ? 'Hide Extended' : 'Show Sub-Hz / THz';

      if (PhysicsMode.showExtendedScale && !PhysicsResults.engine6) {
        PhysicsResults.engine6 = Engine6.run();
      }
    });
  }

  // ---- Panel 2: Microtubule physics controls ----
  const pitchSlider = document.getElementById('pitchAngleSlider');
  const pitchLabel = document.getElementById('pitchAngleValue');
  if (pitchSlider) {
    pitchSlider.addEventListener('input', () => {
      PhysicsMode.pitchAngle = parseFloat(pitchSlider.value);
      pitchLabel.textContent = PhysicsMode.pitchAngle.toFixed(1) + ' deg';
    });
  }

  const achiralBtn = document.getElementById('compareAchiralBtn');
  if (achiralBtn) {
    achiralBtn.addEventListener('click', () => {
      PhysicsMode.showAchiral = !PhysicsMode.showAchiral;
      achiralBtn.classList.toggle('active', PhysicsMode.showAchiral);
      achiralBtn.textContent = PhysicsMode.showAchiral ? 'Hide Achiral' : 'Show Achiral';

      if (PhysicsMode.showAchiral && !PhysicsResults.engine4) {
        PhysicsResults.engine4 = Engine4.run({ pitchAngle: PhysicsMode.pitchAngle });
      }
    });
  }

  const pitchSweepBtn = document.getElementById('runPitchSweepBtn');
  const pitchSweepStatus = document.getElementById('pitchSweepStatus');
  if (pitchSweepBtn) {
    pitchSweepBtn.addEventListener('click', async () => {
      pitchSweepStatus.textContent = 'Computing...';
      pitchSweepStatus.className = 'computation-badge computing';
      await new Promise(r => setTimeout(r, 50));

      try {
        const result = Engine5.run({ nProtofilaments: 13 });
        PhysicsResults.engine5 = result;
        pitchSweepStatus.textContent = 'Done';
        pitchSweepStatus.className = 'computation-badge done';
        showMTResults(result);
      } catch (e) {
        pitchSweepStatus.textContent = 'Error';
        pitchSweepStatus.className = 'computation-badge error';
      }
    });
  }

  // ---- Panel 3: Cascade physics controls ----
  const couplingSlider = document.getElementById('couplingSlider');
  const couplingLabel = document.getElementById('couplingValue');
  if (couplingSlider) {
    couplingSlider.addEventListener('input', () => {
      PhysicsMode.couplingStrength = parseFloat(couplingSlider.value) / 100;
      couplingLabel.textContent = PhysicsMode.couplingStrength.toFixed(2);
    });
  }

  const dampingSlider = document.getElementById('dampingSlider');
  const dampingLabel = document.getElementById('dampingValue');
  if (dampingSlider) {
    dampingSlider.addEventListener('input', () => {
      PhysicsMode.damping = parseFloat(dampingSlider.value) / 100;
      dampingLabel.textContent = PhysicsMode.damping.toFixed(2);
    });
  }

  const rk4Btn = document.getElementById('runCoupledOscBtn');
  const rk4Status = document.getElementById('rk4Status');
  if (rk4Btn) {
    rk4Btn.addEventListener('click', async () => {
      rk4Status.textContent = 'Computing...';
      rk4Status.className = 'computation-badge computing';
      await new Promise(r => setTimeout(r, 50));

      try {
        PhysicsResults.engine1 = Engine1.run({
          coupling: PhysicsMode.couplingStrength,
          damping: PhysicsMode.damping,
        });
        rk4Status.textContent = 'Done';
        rk4Status.className = 'computation-badge done';
      } catch (e) {
        rk4Status.textContent = 'Error';
        rk4Status.className = 'computation-badge error';
      }
    });
  }

  // ---- Hypothesis Lab: Run All Tests ----
  const runAllBtn = document.getElementById('runAllTestsBtn');
  const allStatus = document.getElementById('allTestsStatus');
  if (runAllBtn) {
    runAllBtn.addEventListener('click', async () => {
      allStatus.textContent = 'Running...';
      allStatus.className = 'computation-badge computing';

      const results = await PhysicsController.runAllTests((hypoId, status, result) => {
        if (status === 'done' && result) {
          updateHypothesisCard(hypoId, result);
        }
      });

      allStatus.textContent = 'All Done';
      allStatus.className = 'computation-badge done';
    });
  }
}

/* ---- Results Display Helpers ---- */

function showSpectrumResults(result) {
  const overlay = document.getElementById('spectrumResults');
  const content = document.getElementById('spectrumResultsContent');
  if (!overlay || !content) return;

  overlay.style.display = 'block';
  content.innerHTML = `
    <div class="metric-row">
      <span class="metric-label">Optimal noise level</span>
      <span class="metric-value">${result.optimalNoise.toFixed(3)}</span>
    </div>
    <div class="metric-row">
      <span class="metric-label">Peak SNR</span>
      <span class="metric-value good">${result.peakSNR.toFixed(4)}</span>
    </div>
    <div class="metric-row">
      <span class="metric-label">SNR at zero noise</span>
      <span class="metric-value">${result.meanSNR[0].toFixed(4)}</span>
    </div>
    <div class="metric-row">
      <span class="metric-label">Peak/baseline ratio</span>
      <span class="metric-value ${result.peakSNR > result.meanSNR[0] * 2 ? 'good' : 'warn'}">${(result.peakSNR / (result.meanSNR[0] + 1e-10)).toFixed(2)}x</span>
    </div>
    <div class="metric-row">
      <span class="metric-label">Stochastic resonance</span>
      <span class="metric-value ${result.peakSNR > result.meanSNR[0] * 1.5 ? 'good' : 'warn'}">${result.peakSNR > result.meanSNR[0] * 1.5 ? 'CONFIRMED' : 'WEAK'}</span>
    </div>
  `;
}

function showMTResults(result) {
  const overlay = document.getElementById('mtResults');
  const content = document.getElementById('mtResultsContent');
  if (!overlay || !content) return;

  overlay.style.display = 'block';
  content.innerHTML = `
    <div class="metric-row">
      <span class="metric-label">Peak coupling angle</span>
      <span class="metric-value">${result.peakAngle.toFixed(1)} deg</span>
    </div>
    <div class="metric-row">
      <span class="metric-label">Actual MT pitch</span>
      <span class="metric-value">${result.actualMTAngle} deg</span>
    </div>
    <div class="metric-row">
      <span class="metric-label">Angle difference</span>
      <span class="metric-value ${Math.abs(result.peakAngle - result.actualMTAngle) < 3 ? 'good' : 'warn'}">${Math.abs(result.peakAngle - result.actualMTAngle).toFixed(1)} deg</span>
    </div>
    <div class="metric-row">
      <span class="metric-label">Peak combined score</span>
      <span class="metric-value">${result.peakScore.toFixed(4)}</span>
    </div>
  `;
}

/* ---- Hypothesis Card Update with Computed Results ---- */

window.updateHypothesisCard = function updateHypothesisCard(hypoId, result) {
  const card = document.querySelector(`.hypothesis-card[data-id="${hypoId}"]`);
  if (!card) return;

  // Update status badge
  const badge = card.querySelector('.status-badge');
  if (badge && result.verdict !== 'error') {
    const statusLabels = { supported: 'Supported', plausible: 'Plausible', consistent: 'Consistent', unvalidated: 'Unvalidated', inconclusive: 'Inconclusive', falsified: 'Falsified' };
    badge.className = 'status-badge ' + result.verdict;
    badge.textContent = statusLabels[result.verdict] || result.verdict;

    // Save to localStorage
    const saved = JSON.parse(localStorage.getItem('hypo_statuses') || '{}');
    saved[hypoId] = result.verdict;
    localStorage.setItem('hypo_statuses', JSON.stringify(saved));

    // Update in-memory hypothesis too
    const hypo = hypotheses.find(h => h.id === hypoId);
    if (hypo) hypo.status = result.verdict;
  }

  // Remove existing computed results
  const existing = card.querySelector('.hypo-computed-results');
  if (existing) existing.remove();

  // Add computed results section
  const detail = card.querySelector('.hypo-detail');
  if (!detail) return;

  const resultsDiv = document.createElement('div');
  resultsDiv.className = 'hypo-computed-results';

  let metricsHtml = '';
  if (result.metrics) {
    for (const [key, value] of Object.entries(result.metrics)) {
      metricsHtml += `<div class="metric-line"><span>${key}</span><span>${value}</span></div>`;
    }
  }

  resultsDiv.innerHTML = `
    <h5>Computed Result</h5>
    <div class="hypo-verdict ${result.verdict}">${result.verdict.toUpperCase()}</div>
    <div class="hypo-metrics">${metricsHtml}</div>
    ${result.detail ? `<div class="hypo-detail-text">${result.detail}</div>` : ''}
  `;

  detail.appendChild(resultsDiv);

  // Auto-expand the card to show results
  card.classList.add('expanded');
}

/* ---- Physics-Driven Rendering Enhancements ---- */

// Override cascade drawing when physics mode is active
const originalDrawCascade = typeof drawCascade === 'function' ? drawCascade : null;

// Enhance the cascade panel to render RK4 data when in physics mode
function drawPhysicsCascade(ctx, w, h) {
  if (!PhysicsMode.active || !PhysicsResults.engine1) {
    return false; // fall through to visual mode
  }

  const ts = PhysicsResults.engine1.timeSeries;
  const phaseLead = PhysicsResults.engine1.phaseLead;
  if (!ts || ts.t.length === 0) return false;

  ctx.clearRect(0, 0, w, h);
  const padL = 160, padR = 40, padT = 50, padB = 60;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  // Title
  ctx.fillStyle = '#b388ff';
  ctx.font = 'bold 13px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('RK4 Coupled Oscillator — Real Physics', w / 2, 25);

  // Time axis
  ctx.strokeStyle = 'rgba(30,42,74,0.5)';
  ctx.lineWidth = 0.5;
  const maxT = ts.t[ts.t.length - 1];
  for (let i = 0; i <= 4; i++) {
    const x = padL + (i / 4) * plotW;
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
    ctx.fillStyle = '#556688';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText((maxT * i / 4).toFixed(0) + ' us', x, padT + plotH + 20);
  }

  ctx.fillStyle = '#8899bb';
  ctx.font = '11px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Time (microseconds)', padL + plotW / 2, h - 10);

  // Two rows: fast oscillator (top) and slow oscillator (bottom)
  const rowH = plotH / 2;

  // Row labels
  ctx.fillStyle = COLORS.mhz.main;
  ctx.font = '11px Inter, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('Fast (MHz filament)', padL - 8, padT + rowH * 0.5 + 4);
  ctx.fillStyle = COLORS.khz.main;
  ctx.fillText('Slow (kHz membrane)', padL - 8, padT + rowH * 1.5 + 4);

  // Row separator
  ctx.strokeStyle = 'rgba(30,42,74,0.3)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(padL, padT + rowH);
  ctx.lineTo(padL + plotW, padT + rowH);
  ctx.stroke();

  // Normalize amplitudes
  const maxFast = Math.max(...ts.xFast.map(Math.abs)) || 1;
  const maxSlow = Math.max(...ts.xSlow.map(Math.abs)) || 1;

  // Draw fast oscillator
  ctx.beginPath();
  const midY1 = padT + rowH * 0.5;
  const ampH1 = rowH * 0.35;
  for (let i = 0; i < ts.t.length; i++) {
    const x = padL + (ts.t[i] / maxT) * plotW;
    const y = midY1 - (ts.xFast[i] / maxFast) * ampH1;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = COLORS.mhz.main;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Draw slow oscillator
  ctx.beginPath();
  const midY2 = padT + rowH * 1.5;
  const ampH2 = rowH * 0.35;
  for (let i = 0; i < ts.t.length; i++) {
    const x = padL + (ts.t[i] / maxT) * plotW;
    const y = midY2 - (ts.xSlow[i] / maxSlow) * ampH2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = COLORS.khz.main;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Baselines
  ctx.strokeStyle = 'rgba(255,179,0,0.1)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(padL, midY1);
  ctx.lineTo(padL + plotW, midY1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(padL, midY2);
  ctx.lineTo(padL + plotW, midY2);
  ctx.stroke();

  // Phase lead annotation
  if (phaseLead.leadTime_us !== 0) {
    const arrowY = padT + plotH + 35;
    const x1 = padL + (phaseLead.fastPeakTime / maxT) * plotW;
    const x2 = padL + (phaseLead.slowPeakTime / maxT) * plotW;

    if (x1 > padL && x2 > padL && x1 < padL + plotW && x2 < padL + plotW) {
      ctx.strokeStyle = 'rgba(255,179,0,0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x1, arrowY);
      ctx.lineTo(x2, arrowY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COLORS.amber;
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`Phase lead: ${phaseLead.leadTime_us.toFixed(0)} us`, (x1 + x2) / 2, arrowY + 14);
    }
  }

  // Physics parameters annotation
  ctx.fillStyle = 'rgba(179,136,255,0.6)';
  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`coupling=${PhysicsMode.couplingStrength.toFixed(2)}  damping=${PhysicsMode.damping.toFixed(2)}`, w - padR, padT - 8);

  return true; // handled
}

// Patch drawCascade to check physics mode first
const _origDrawCascade = drawCascade;
drawCascade = function(ctx, w, h) {
  if (drawPhysicsCascade(ctx, w, h)) return;
  _origDrawCascade(ctx, w, h);
};

// Enhance spectrum drawing: overlay extended scale markers when active
const _origDrawSpectrum = drawSpectrum;
drawSpectrum = function(ctx, w, h) {
  _origDrawSpectrum(ctx, w, h);

  // Draw extended scale markers if active
  if (PhysicsMode.active && PhysicsMode.showExtendedScale && PhysicsResults.engine6) {
    drawExtendedScaleOverlay(ctx, w, h, PhysicsResults.engine6);
  }

  // Draw stochastic resonance overlay if active
  if (PhysicsMode.active && PhysicsResults.engine2) {
    drawStochasticOverlay(ctx, w, h, PhysicsResults.engine2);
  }
};

function drawExtendedScaleOverlay(ctx, w, h, result) {
  if (spectrumState.zoomLevel !== 0) return; // only on full view

  const padL = 60, padR = 30, padT = 30, padB = 50;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const [fMin, fMax] = getFreqRange();
  const logMin = Math.log10(fMin);
  const logMax = Math.log10(fMax);

  // Draw Schumann harmonic markers
  ctx.fillStyle = 'rgba(179,136,255,0.3)';
  ctx.font = '9px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';

  for (const match of result.schumannMatches) {
    const logF = Math.log10(match.schumannFreq);
    const nx = (logF - logMin) / (logMax - logMin);
    if (nx < 0 || nx > 1) continue;
    const x = padL + nx * plotW;

    // Vertical marker
    ctx.strokeStyle = match.isMatch ? 'rgba(105,240,174,0.6)' : 'rgba(179,136,255,0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    // Label
    ctx.fillStyle = match.isMatch ? 'rgba(105,240,174,0.8)' : 'rgba(179,136,255,0.5)';
    ctx.fillText('S' + (result.schumannMatches.indexOf(match) + 1), x, padT + plotH + 35);
  }

  // Annotation
  ctx.fillStyle = 'rgba(179,136,255,0.5)';
  ctx.font = '10px Inter, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('S = Schumann harmonic', padL + plotW, padT + plotH + 45);
}

function drawStochasticOverlay(ctx, w, h, result) {
  // Small inset SNR curve in bottom-right corner
  const insetW = 160, insetH = 80;
  const insetX = w - 30 - insetW;
  const insetY = 30;

  // Background
  ctx.fillStyle = 'rgba(10,14,26,0.85)';
  ctx.fillRect(insetX, insetY, insetW, insetH);
  ctx.strokeStyle = 'rgba(179,136,255,0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(insetX, insetY, insetW, insetH);

  // Title
  ctx.fillStyle = 'rgba(179,136,255,0.8)';
  ctx.font = '9px Inter, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('SNR vs Noise', insetX + 5, insetY + 12);

  // Plot SNR curve
  const snr = result.meanSNR;
  if (!snr || snr.length === 0) return;

  const maxSNR = Math.max(...snr);
  const padI = 5;
  const plotIW = insetW - padI * 2;
  const plotIH = insetH - 25;

  ctx.beginPath();
  for (let i = 0; i < snr.length; i++) {
    const x = insetX + padI + (i / (snr.length - 1)) * plotIW;
    const y = insetY + insetH - padI - (snr[i] / (maxSNR || 1)) * plotIH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#b388ff';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Mark optimal noise
  const optIdx = result.noiseLevels.indexOf(result.optimalNoise);
  if (optIdx >= 0) {
    const optX = insetX + padI + (optIdx / (snr.length - 1)) * plotIW;
    const optY = insetY + insetH - padI - (snr[optIdx] / (maxSNR || 1)) * plotIH;
    ctx.beginPath();
    ctx.arc(optX, optY, 3, 0, TAU);
    ctx.fillStyle = '#69f0ae';
    ctx.fill();
  }
}

// Enhance microtubule panel with chiral comparison
const _origDrawMicrotubule = drawMicrotubule;
drawMicrotubule = function(ctx, w, h) {
  _origDrawMicrotubule(ctx, w, h);

  // Draw pitch sweep inset if available
  if (PhysicsMode.active && PhysicsResults.engine5) {
    drawPitchSweepInset(ctx, w, h, PhysicsResults.engine5);
  }
};

function drawPitchSweepInset(ctx, w, h, result) {
  if (mtState.view !== 'cross') return; // only in cross-section view

  const insetW = 200, insetH = 100;
  const insetX = w - 20 - insetW;
  const insetY = h - 20 - insetH;

  // Background
  ctx.fillStyle = 'rgba(10,14,26,0.85)';
  ctx.fillRect(insetX, insetY, insetW, insetH);
  ctx.strokeStyle = 'rgba(179,136,255,0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(insetX, insetY, insetW, insetH);

  // Title
  ctx.fillStyle = 'rgba(179,136,255,0.8)';
  ctx.font = '9px Inter, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Coupling vs Pitch Angle', insetX + 5, insetY + 12);

  // Plot combined score
  const scores = result.combinedScore;
  const angles = result.angles;
  if (!scores || scores.length === 0) return;

  const maxScore = Math.max(...scores);
  const padI = 5;
  const plotIW = insetW - padI * 2;
  const plotIH = insetH - 25;

  ctx.beginPath();
  for (let i = 0; i < scores.length; i++) {
    const x = insetX + padI + (i / (scores.length - 1)) * plotIW;
    const y = insetY + insetH - padI - (scores[i] / (maxScore || 1)) * plotIH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#b388ff';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Mark actual MT angle (12 deg)
  const mtIdx = Math.round(12 / 0.5) - 1;
  if (mtIdx >= 0 && mtIdx < scores.length) {
    const mtX = insetX + padI + (mtIdx / (scores.length - 1)) * plotIW;
    const mtY = insetY + insetH - padI - (scores[mtIdx] / (maxScore || 1)) * plotIH;
    ctx.beginPath();
    ctx.arc(mtX, mtY, 4, 0, TAU);
    ctx.fillStyle = '#00e5ff';
    ctx.fill();
    ctx.fillStyle = '#00e5ff';
    ctx.font = '8px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('MT', mtX, mtY - 7);
  }

  // Mark peak
  const peakIdx = Math.round(result.peakAngle / 0.5) - 1;
  if (peakIdx >= 0 && peakIdx < scores.length && peakIdx !== mtIdx) {
    const peakX = insetX + padI + (peakIdx / (scores.length - 1)) * plotIW;
    const peakY = insetY + insetH - padI - (scores[peakIdx] / (maxScore || 1)) * plotIH;
    ctx.beginPath();
    ctx.arc(peakX, peakY, 3, 0, TAU);
    ctx.fillStyle = '#69f0ae';
    ctx.fill();
  }

  // Axis labels
  ctx.fillStyle = '#556688';
  ctx.font = '8px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText('0', insetX + padI, insetY + insetH - 1);
  ctx.textAlign = 'right';
  ctx.fillText('45 deg', insetX + insetW - padI, insetY + insetH - 1);
}
