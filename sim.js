/* ===========================================================
   Microtubule Resonance Simulator — Main Simulation Engine
   Pure JS, Canvas-based visualizations
   =========================================================== */

// ---- Utility ----
const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const easeOut = t => 1 - Math.pow(1 - t, 3);
// Below this canvas width the panels switch to their phone layout.
const isCompact = w => w < 560;

function formatFreq(hz) {
  if (hz >= 1e9) return (hz / 1e9).toFixed(1) + ' GHz';
  if (hz >= 1e6) return (hz / 1e6).toFixed(1) + ' MHz';
  if (hz >= 1e3) return (hz / 1e3).toFixed(1) + ' kHz';
  return hz.toFixed(1) + ' Hz';
}

// ---- Canvas sizing ----
// Each canvas keeps its markup aspect ratio and fills its .canvas-wrap. Sizing
// happens on init, when a ResizeObserver reports the container changed, and
// when devicePixelRatio changes (zoom / monitor move) — never per frame, so the
// animation loop does no layout reads. canvasLastSize holds CSS-pixel w/h.
const canvasOriginals = {};
// Height / width used below the compact breakpoint (see isCompact).
const PHONE_ASPECT = { spectrumCanvas: 0.95, mtCanvas: 1.6, cascadeCanvas: 1.15, holoCanvas: 1.05 };
const canvasLastSize = {};
const sizedCanvases = new Set();

function setupCanvas(canvas) {
  // Save original dimensions on first call
  if (!canvasOriginals[canvas.id]) {
    canvasOriginals[canvas.id] = { w: canvas.width, h: canvas.height };
  }
  const orig = canvasOriginals[canvas.id];
  const dpr = window.devicePixelRatio || 1;
  const container = canvas.parentElement;
  const containerW = container ? container.clientWidth - 2 : 0;
  // A panel that is display:none measures 0 wide; keep the markup width until
  // the ResizeObserver reports a real size (it fires when the panel is shown).
  const w = containerW > 100 ? containerW : orig.w;
  // On a phone the wide markup aspect would shrink every label to nothing, so
  // narrow canvases get a taller frame and the draw code a compact layout.
  const aspect = isCompact(w) && PHONE_ASPECT[canvas.id] ? PHONE_ASPECT[canvas.id] : orig.h / orig.w;
  const h = Math.round(w * aspect);
  const last = canvasLastSize[canvas.id];
  if (last && last.w === w && last.h === h && last.dpr === dpr) {
    return { ctx: canvas.getContext('2d'), w, h };
  }
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  canvasLastSize[canvas.id] = { w, h, dpr };
  return { ctx, w, h };
}

// Frame-time accessor: cached size + a DPR transform reset. No DOM reads.
function sizeCanvas(canvas) {
  const last = canvasLastSize[canvas.id];
  if (!last) return setupCanvas(canvas);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(last.dpr, 0, 0, last.dpr, 0, 0);
  return { ctx, w: last.w, h: last.h };
}

const canvasResizeObserver = typeof ResizeObserver === 'function'
  ? new ResizeObserver((entries) => {
      for (const entry of entries) {
        const canvas = entry.target.querySelector('canvas');
        if (canvas) setupCanvas(canvas);
      }
    })
  : null;

function watchCanvasSize(canvas) {
  if (sizedCanvases.has(canvas)) return;
  sizedCanvases.add(canvas);
  setupCanvas(canvas);
  if (canvasResizeObserver && canvas.parentElement) {
    canvasResizeObserver.observe(canvas.parentElement);
  }
}

// devicePixelRatio has no event of its own; a resolution media query that
// stops matching is the standard signal. Re-arm after each change because the
// query is bound to the old ratio. Fallback to `resize` where matchMedia or
// ResizeObserver is missing.
(function watchDevicePixelRatio() {
  function resizeAll() { for (const c of sizedCanvases) setupCanvas(c); }
  if (typeof window.matchMedia === 'function' && canvasResizeObserver) {
    const arm = () => {
      const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      const onChange = () => { mq.removeEventListener('change', onChange); resizeAll(); arm(); };
      mq.addEventListener('change', onChange);
    };
    arm();
  } else {
    window.addEventListener('resize', resizeAll);
  }
})();

// ---- Animation loop ----
// One requestAnimationFrame drives every panel. Each panel registers a tick
// that receives real elapsed seconds (from the rAF timestamp, clamped to 50 ms
// so a stalled tab or a debugger pause cannot produce a catch-up jump). Only
// the panel whose <section> is .active is ticked or drawn. The loop stops
// entirely while the document is hidden and restarts, clock reset, on return.
const AnimLoop = (() => {
  const MAX_DT = 0.05; // seconds
  const loops = [];
  let rafId = 0;
  let lastTs = null;
  let frames = 0;

  function frame(ts) {
    rafId = 0;
    if (document.hidden) { lastTs = null; return; }
    let dt = lastTs === null ? 0 : (ts - lastTs) / 1000;
    lastTs = ts;
    if (dt > MAX_DT) dt = MAX_DT;
    for (const loop of loops) {
      if (!loop.panel.classList.contains('active')) continue;
      const size = sizeCanvas(loop.canvas);
      loop.tick(dt, size.ctx, size.w, size.h);
    }
    frames++;
    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (rafId || document.hidden || loops.length === 0) return;
    lastTs = null;
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    lastTs = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(); else start();
  });

  return {
    /** Register a panel: tick(dtSeconds, ctx, w, h) runs while panel is .active. */
    register(canvas, tick) {
      const panel = canvas.closest('.panel') || document.body;
      watchCanvasSize(canvas);
      loops.push({ canvas, panel, tick });
      start();
    },
    /** Read-only frame counter and running flag (used by tests). */
    get frames() { return frames; },
    get running() { return rafId !== 0; },
  };
})();
window.AnimLoop = AnimLoop;

// ---- Color Palette ----
// The four frequency bands read like light: the lowest band is drawn reddest
// and the highest bluest (ember -> amber -> moss -> sky), so color order is
// frequency order wherever a band appears. Every main color clears 4.5:1 on
// the panel background (#1c1510).
const COLORS = {
  hz:    { main: '#e8694c', glow: 'rgba(232,105,76,',  dim: '#9c3f2b' },
  khz:   { main: '#eea54d', glow: 'rgba(238,165,77,',  dim: '#a5691f' },
  mhz:   { main: '#adc983', glow: 'rgba(173,201,131,', dim: '#5f7a3c' },
  ghz:   { main: '#7cbbe0', glow: 'rgba(124,187,224,', dim: '#3a6f8e' },
  cyan:  '#e8833a',
  amber: '#d9a441',
  purple:'#8fa3ad',
  red:   '#e0705a',
};

// Shared drawing vocabulary for every panel.
const MONO = '"JetBrains Mono", "Consolas", monospace';
const INK = {
  text: '#ece1cc',
  dim: '#b8a98c',
  muted: '#a0926f',
  grid: 'rgba(160,146,111,0.09)',
  gridStrong: 'rgba(160,146,111,0.20)',
};
// Computed-physics overlays get one cool accent so they never read as data bands.
const PHYS = { main: '#a9c3d2', glow: 'rgba(169,195,210,' };
const REDUCED_MOTION = typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const monoFont = (px, weight) => `${weight ? weight + ' ' : ''}${px}px ${MONO}`;

// A faint warm vignette behind every instrument, so the canvases read as lit
// glass rather than flat black boxes.
function drawBackdrop(ctx, w, h, glow = 'rgba(232,131,58,', strength = 0.05) {
  const g = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.45, Math.max(w, h) * 0.75);
  g.addColorStop(0, glow + strength + ')');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// A small label pill (used for hover readouts, the drive marker and the playhead).
function drawPill(ctx, text, x, y, color, align = 'center') {
  ctx.font = monoFont(10, 600);
  const tw = ctx.measureText(text).width;
  const pw = tw + 12, ph = 17;
  let px = align === 'center' ? x - pw / 2 : align === 'right' ? x - pw : x;
  ctx.fillStyle = 'rgba(28,21,16,0.92)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(px, y - ph / 2, pw, ph, 8); else ctx.rect(px, y - ph / 2, pw, ph);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, px + pw / 2, y + 0.5);
  ctx.textBaseline = 'alphabetic';
}

// "Color is frequency": interpolate the band colors in log-frequency, for the
// spectral strip under the spectrum axis.
const BAND_RGB = [[232,105,76], [238,165,77], [173,201,131], [124,187,224]];
function freqRGB(logF) {
  const pos = clamp((logF - 1) / 3, 0, 3); // band centres sit at 10x each base: log10 = 1, 4, 7, 10
  const i = Math.min(2, Math.floor(pos));
  const f = pos - i;
  const a = BAND_RGB[i], b = BAND_RGB[i + 1];
  return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
}

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
  // Hit-testing uses the canvas's own CSS-pixel box, which is the coordinate
  // space drawSpectrum draws in (setupCanvas sets style.width/height from the
  // same numbers). No fallback constant needed: the canvas is sized on init.
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    handleSpectrumClick(mx, my, rect.width, rect.height);
  });

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    handleSpectrumHover(mx, my, rect.width, rect.height, canvas);
  });

  canvas.addEventListener('mouseleave', () => {
    spectrumState.hoveredPeak = -1;
    canvas.style.cursor = 'default';
  });

  AnimLoop.register(canvas, (dt, ctx, w, h) => {
    spectrumState.time += dt;
    drawSpectrum(ctx, w, h);
  });
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

// One layout for the spectrum and its computed-physics overlays.
function spectrumLayout(w, h) {
  const compact = isCompact(w);
  const padL = compact ? 26 : 56, padR = compact ? 12 : 28, padT = 36, padB = compact ? 62 : 64;
  return { compact, padL, padR, padT, padB, plotW: w - padL - padR, plotH: h - padT - padB };
}

// A driven, damped resonance has a Lorentzian line shape; each peak is drawn
// as one (positions and heights are the hardcoded ratios, unchanged).
const lorentz = (dx, gamma) => 1 / (1 + (dx / gamma) * (dx / gamma));

function drawSpectrum(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  const { compact, padL, padT, plotW, plotH } = spectrumLayout(w, h);
  const baseY = padT + plotH;
  const st = spectrumState;
  const [fMin, fMax] = getFreqRange();
  const logMin = Math.log10(fMin);
  const logMax = Math.log10(fMax);
  const xOf = logF => padL + ((logF - logMin) / (logMax - logMin)) * plotW;

  drawBackdrop(ctx, w, h);

  // Band columns: a vertical wash in each band's color, brightest at the floor.
  if (st.zoomLevel === 0) {
    for (let s = 0; s < 4; s++) {
      const x1 = clamp(xOf(Math.log10(SCALE_BASES[s] * 0.8)), padL, padL + plotW);
      const x2 = clamp(xOf(Math.log10(SCALE_BASES[s] * 45)), padL, padL + plotW);
      const g = ctx.createLinearGradient(0, padT, 0, baseY);
      g.addColorStop(0, SCALE_COLORS[s].glow + '0)');
      g.addColorStop(1, SCALE_COLORS[s].glow + '0.07)');
      ctx.fillStyle = g;
      ctx.fillRect(x1, padT, x2 - x1, plotH);
    }
  }

  // Grid: decades strong, the 2..9 ticks between them faint.
  ctx.lineWidth = 1;
  for (let dec = Math.floor(logMin); dec <= Math.ceil(logMax); dec++) {
    for (let m = 1; m <= 9; m++) {
      const lf = dec + Math.log10(m);
      const x = xOf(lf);
      if (x < padL - 0.5 || x > padL + plotW + 0.5) continue;
      const major = m === 1;
      if (!major && st.zoomLevel === 0) continue;
      ctx.strokeStyle = major ? INK.gridStrong : INK.grid;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, padT);
      ctx.lineTo(Math.round(x) + 0.5, baseY);
      ctx.stroke();
      if (!major) continue;
      // Label every decade on desktop; on a phone only the band starts (1 Hz, 1 kHz…).
      const bandStart = ((dec % 3) + 3) % 3 === 0;
      if (compact && !bandStart && st.zoomLevel === 0) continue;
      ctx.fillStyle = bandStart ? INK.dim : INK.muted;
      ctx.font = monoFont(compact ? 9 : 10);
      ctx.textAlign = 'center';
      ctx.fillText(formatFreq(Math.pow(10, dec)), x, baseY + 26);
    }
  }
  ctx.setLineDash([2, 6]);
  for (let i = 1; i < 4; i++) {
    const y = Math.round(padT + (i / 4) * plotH) + 0.5;
    ctx.strokeStyle = INK.grid;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = INK.gridStrong;
  ctx.beginPath();
  ctx.moveTo(padL, baseY + 0.5);
  ctx.lineTo(padL + plotW, baseY + 0.5);
  ctx.stroke();

  // Spectral strip: the continuous color-for-frequency key under the axis.
  for (let x = 0; x < plotW; x += 2) {
    const lf = logMin + (x / plotW) * (logMax - logMin);
    const [r, g, b] = freqRGB(lf);
    ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},0.85)`;
    ctx.fillRect(padL + x, baseY + 6, 2, 4);
  }

  // Axis titles
  ctx.fillStyle = INK.muted;
  ctx.font = monoFont(compact ? 9 : 10);
  ctx.textAlign = 'center';
  ctx.fillText('Frequency (log scale)', padL + plotW / 2, h - 10);
  ctx.save();
  ctx.translate(compact ? 11 : 18, padT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Amplitude', 0, 0);
  ctx.restore();

  // Peaks
  const peaks = getVisiblePeaks();
  const t = st.time;
  peakHitAreas = [];
  const peakW = st.zoomLevel === 0 ? plotW * 0.012 : plotW * 0.04;
  const gamma = peakW * 0.55;
  const drawn = [];

  ctx.save();
  ctx.beginPath();
  ctx.rect(padL, padT - 20, plotW, plotH + 20);
  ctx.clip();

  for (let i = 0; i < peaks.length; i++) {
    const p = peaks[i];
    const logF = Math.log10(p.freq);
    const nx = (logF - logMin) / (logMax - logMin);
    if (nx < -0.05 || nx > 1.05) continue;
    const cx = padL + nx * plotW;
    let amp = p.amplitude;

    if (st.animating) {
      amp *= 0.85 + 0.15 * Math.sin(t * 2 + p.mainIdx * 1.5 + p.subIdx * 0.8);
    }

    let resonance = 0;
    if (st.driveFreq > 0) {
      const dist = Math.abs(logF - Math.log10(st.driveFreq));
      if (dist < 0.3) {
        resonance = 1 - dist / 0.3;
        amp *= 1 + resonance * 0.5;
      }
    }

    const isHovered = st.hoveredPeak === i;
    if (isHovered) amp *= 1.15;
    const peakH = amp * plotH * 0.85;
    drawn.push({ p, cx, peakH, isHovered, resonance, i });

    peakHitAreas.push({ x: cx - peakW * 2, y: baseY - peakH, w: peakW * 4, h: peakH, idx: i, peak: p });
  }

  // Fills are additive, so overlapping lines brighten where they stack, the
  // way overlapping emission does.
  ctx.globalCompositeOperation = 'lighter';
  for (const d of drawn) {
    const { p, cx, peakH, resonance } = d;
    if (resonance > 0) {
      const gr = ctx.createRadialGradient(cx, baseY, 0, cx, baseY, plotH * 0.7);
      gr.addColorStop(0, p.color.glow + (0.28 * resonance) + ')');
      gr.addColorStop(1, p.color.glow + '0)');
      ctx.fillStyle = gr;
      ctx.fillRect(cx - plotH * 0.7, padT, plotH * 1.4, plotH);
    }
    const span = gamma * 7;
    ctx.beginPath();
    ctx.moveTo(cx - span, baseY);
    for (let sx = -span; sx <= span; sx += 1.5) {
      ctx.lineTo(cx + sx, baseY - peakH * lorentz(sx, gamma));
    }
    ctx.lineTo(cx + span, baseY);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, baseY, 0, baseY - peakH);
    grad.addColorStop(0, p.color.glow + '0.04)');
    grad.addColorStop(0.6, p.color.glow + '0.16)');
    grad.addColorStop(1, p.color.glow + '0.42)');
    ctx.fillStyle = grad;
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // Line work on top: each resonance as a crisp stroke with a soft glow.
  for (const d of drawn) {
    const { p, cx, peakH, isHovered } = d;
    const span = gamma * 7;
    ctx.beginPath();
    for (let sx = -span; sx <= span; sx += 1.5) {
      const y = baseY - peakH * lorentz(sx, gamma);
      if (sx === -span) ctx.moveTo(cx + sx, y); else ctx.lineTo(cx + sx, y);
    }
    ctx.shadowColor = p.color.glow + '0.8)';
    ctx.shadowBlur = isHovered ? 14 : 6;
    ctx.strokeStyle = isHovered ? '#fff4e2' : p.color.main;
    ctx.lineWidth = isHovered ? 2 : 1.25;
    ctx.stroke();
    ctx.shadowBlur = 0;

    const tipY = baseY - peakH;
    if (st.animating || isHovered) {
      const halo = ctx.createRadialGradient(cx, tipY, 0, cx, tipY, isHovered ? 12 : 8);
      halo.addColorStop(0, p.color.glow + '0.55)');
      halo.addColorStop(1, p.color.glow + '0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, tipY, isHovered ? 12 : 8, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, tipY, isHovered ? 3 : 2.2, 0, TAU);
      ctx.fillStyle = '#fff4e2';
      ctx.fill();
    }
  }

  // The instrument reads the sum: a pale envelope over all visible lines.
  if (drawn.length) {
    ctx.beginPath();
    for (let x = 0; x <= plotW; x += 2) {
      let y = 0;
      for (const d of drawn) {
        const dx = padL + x - d.cx;
        if (Math.abs(dx) < gamma * 12) y += d.peakH * lorentz(dx, gamma);
      }
      const py = baseY - y;
      if (x === 0) ctx.moveTo(padL + x, py); else ctx.lineTo(padL + x, py);
    }
    ctx.strokeStyle = 'rgba(255,244,226,0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();

  // Hover readout
  for (const d of drawn) {
    if (!d.isHovered) continue;
    drawPill(ctx, formatFreq(d.p.freq), clamp(d.cx, padL + 40, padL + plotW - 40), Math.max(padT - 6, baseY - d.peakH - 20), d.p.color.main);
  }

  // Band names along the top
  if (st.zoomLevel === 0) {
    for (let s = 0; s < 4; s++) {
      const x = xOf(Math.log10(SCALE_BASES[s] * 10));
      ctx.fillStyle = SCALE_COLORS[s].main;
      ctx.font = monoFont(compact ? 10 : 11, 700);
      ctx.textAlign = 'center';
      ctx.fillText(SCALE_NAMES[s], x, padT - 14);
    }
  } else {
    const s = st.zoomScale;
    ctx.fillStyle = SCALE_COLORS[s].main;
    ctx.font = monoFont(11, 700);
    ctx.textAlign = 'left';
    ctx.fillText(SCALE_NAMES[s] + (st.zoomLevel === 2 ? ` · peak ${st.zoomPeak + 1}` : ' band'), padL + 4, padT - 14);
  }

  // Drive frequency: a beam with its readout
  if (st.driveFreq > 0) {
    const dx = xOf(Math.log10(st.driveFreq));
    if (dx >= padL && dx <= padL + plotW) {
      const beam = ctx.createLinearGradient(0, padT, 0, baseY);
      beam.addColorStop(0, 'rgba(255,244,226,0.65)');
      beam.addColorStop(1, 'rgba(255,244,226,0.05)');
      ctx.strokeStyle = beam;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(dx) + 0.5, padT);
      ctx.lineTo(Math.round(dx) + 0.5, baseY);
      ctx.stroke();
      drawPill(ctx, 'DRIVE ' + formatFreq(st.driveFreq), clamp(dx, padL + 60, padL + plotW - 60), padT + 10, '#fff4e2');
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
    html += `<span class="breadcrumb ${isCurrent ? 'current' : ''}" data-level="0" role="button" tabindex="0">All Scales</span>`;
  }
  if (st.zoomLevel >= 1) {
    html += `<span class="breadcrumb-sep">&rsaquo;</span>`;
    const isCurrent = st.zoomLevel === 1;
    html += `<span class="breadcrumb ${isCurrent ? 'current' : ''}" data-level="1" role="button" tabindex="0">${SCALE_NAMES[st.zoomScale]} Band</span>`;
  }
  if (st.zoomLevel >= 2) {
    html += `<span class="breadcrumb-sep">&rsaquo;</span>`;
    html += `<span class="breadcrumb current">Peak ${st.zoomPeak + 1} Triplet</span>`;
  }

  el.innerHTML = html;
}

// Breadcrumb zoom-out is delegated: the page ships under an enforced CSP
// (script-src 'self'), which blocks inline onclick= attributes — including the
// ones innerHTML would inject. One listener on the container, keyed by data-level.
function zoomBreadcrumb(level) {
  if (level === 0) {
    spectrumState.zoomLevel = 0; spectrumState.zoomScale = -1; spectrumState.zoomPeak = -1;
  } else if (level === 1) {
    spectrumState.zoomLevel = 1; spectrumState.zoomPeak = -1;
  } else {
    return;
  }
  updateBreadcrumbs();
}
(function wireBreadcrumbs() {
  const el = document.getElementById('spectrumBreadcrumbs');
  if (!el) return;
  el.addEventListener('click', (e) => {
    const crumb = e.target.closest('.breadcrumb[data-level]');
    if (crumb) zoomBreadcrumb(Number(crumb.dataset.level));
  });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const crumb = e.target.closest('.breadcrumb[data-level]');
    if (crumb) { e.preventDefault(); zoomBreadcrumb(Number(crumb.dataset.level)); }
  });
})();
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

  AnimLoop.register(canvas, (dt, ctx, w, h) => {
    mtState.time += dt;

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
    // Rates below were tuned per 16 ms frame (0.05 lerp, 0.03 rad); expressed
    // per second so the look is the same at any refresh rate.
    const smoothing = 1 - Math.pow(0.95, dt * 60);
    mtState.resonanceIntensity = lerp(mtState.resonanceIntensity, maxRes, smoothing);
    mtState.wavePhase += 1.875 * dt * (1 + mtState.resonanceIntensity * 3);

    drawMicrotubule(ctx, w, h);
  });
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

// 3-start helix families share these three colors in both views.
const HELIX_COLORS = [
  { c: '#e8833a', rgb: [232, 131, 58] },
  { c: '#d9a441', rgb: [217, 164, 65] },
  { c: '#9fb4bf', rgb: [159, 180, 191] },
];
const EMBER_RGB = [232, 131, 58];

// A shaded tubulin bead: a sphere lit from the upper left. `light` brightens
// it toward white (resonance), `alpha` fades beads on the far side of the tube.
function drawBead(ctx, x, y, rx, ry, rgb, light = 0, alpha = 1) {
  const r = Math.max(rx, ry);
  const g = ctx.createRadialGradient(x - rx * 0.35, y - ry * 0.4, r * 0.1, x, y, r * 1.05);
  const hi = rgb.map(v => Math.round(lerp(v, 255, 0.3 + light * 0.45)));
  const mid = rgb.map(v => Math.round(lerp(v * 0.78, 255, light * 0.45)));
  const lo = rgb.map(v => Math.round(v * 0.22));
  g.addColorStop(0, `rgba(${hi},${alpha})`);
  g.addColorStop(0.5, `rgba(${mid},${alpha})`);
  g.addColorStop(1, `rgba(${lo},${alpha})`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.6, rx), Math.max(0.6, ry), 0, 0, TAU);
  ctx.fill();
}

function drawMTCross(ctx, w, h, res) {
  const compact = isCompact(w);
  const cx = compact ? w / 2 : w * 0.34;
  const cy = compact ? h * 0.23 : h * 0.47;
  const outerR = compact ? Math.min(w * 0.31, h * 0.155) : Math.min(w, h) * 0.32;
  const nProto = 13;
  const midR = outerR * 0.8;
  const beadR = Math.min(midR * Math.sin(Math.PI / nProto) * 0.9, outerR * 0.19);
  const t = mtState.time;

  drawBackdrop(ctx, w, h, 'rgba(232,131,58,', 0.04 + res * 0.08);

  // Field ripples at resonance, expanding outward from the wall.
  if (res > 0.05) {
    for (let k = 0; k < 3; k++) {
      const ph = ((t * 0.6 + k / 3) % 1);
      ctx.beginPath();
      ctx.arc(cx, cy, outerR * (1 + ph * 0.9), 0, TAU);
      ctx.strokeStyle = `rgba(232,131,58,${res * 0.28 * (1 - ph)})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // Lumen
  const lumenR = midR - beadR * 1.05;
  const lg = ctx.createRadialGradient(cx, cy, 0, cx, cy, lumenR);
  lg.addColorStop(0, 'rgba(12,9,6,0.95)');
  lg.addColorStop(0.8, 'rgba(24,18,13,0.9)');
  lg.addColorStop(1, `rgba(232,131,58,${0.06 + res * 0.12})`);
  ctx.fillStyle = lg;
  ctx.beginPath();
  ctx.arc(cx, cy, lumenR, 0, TAU);
  ctx.fill();

  // 13 protofilaments, seen end-on. At resonance a 3-lobed mode travels round
  // the ring: each bead breathes outward and brightens as the crest passes.
  const nMode = 3;
  for (let i = 0; i < nProto; i++) {
    const angle = (i / nProto) * TAU - Math.PI / 2;
    const crest = Math.cos(nMode * angle - mtState.wavePhase * 1.4);
    const r = midR + res * beadR * 0.35 * crest;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    const rgb = mtState.showHelix ? HELIX_COLORS[i % 3].rgb : EMBER_RGB;
    const light = res * (0.3 + 0.35 * crest);

    if (res > 0.05) {
      const halo = ctx.createRadialGradient(px, py, beadR * 0.6, px, py, beadR * 2);
      halo.addColorStop(0, `rgba(${rgb},${0.35 * light})`);
      halo.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(px, py, beadR * 2, 0, TAU);
      ctx.fill();
    }
    drawBead(ctx, px, py, beadR, beadR, rgb, light);

    // Protofilament number, just outside the wall
    const lr = outerR + (compact ? 9 : 14);
    ctx.fillStyle = INK.muted;
    ctx.font = monoFont(compact ? 8 : 9);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(i + 1, cx + Math.cos(angle) * lr, cy + Math.sin(angle) * lr);
    ctx.textBaseline = 'alphabetic';
  }

  ctx.fillStyle = 'rgba(236,225,204,0.38)';
  ctx.font = monoFont(compact ? 9 : 10);
  ctx.textAlign = 'center';
  ctx.fillText('hollow', cx, cy - 4);
  ctx.fillText('lumen', cx, cy + 10);

  // Dimension line
  const dimY = cy + outerR + (compact ? 24 : 36);
  ctx.strokeStyle = 'rgba(236,225,204,0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - outerR, dimY); ctx.lineTo(cx + outerR, dimY);
  ctx.moveTo(cx - outerR, dimY - 4); ctx.lineTo(cx - outerR, dimY + 4);
  ctx.moveTo(cx + outerR, dimY - 4); ctx.lineTo(cx + outerR, dimY + 4);
  ctx.stroke();
  ctx.fillStyle = INK.dim;
  ctx.font = monoFont(10);
  ctx.fillText('~25 nm', cx, dimY + 15);

  // Spec sheet
  const textX = compact ? 18 : w * 0.64;
  let textY = compact ? dimY + 46 : h * 0.2;
  const lineH = compact ? 19 : 24;
  const valX = textX + (compact ? 128 : 140);
  const sheetW = compact ? w - 36 : Math.min(300, w - textX - 30);

  ctx.textAlign = 'left';
  ctx.font = monoFont(compact ? 10 : 11, 700);
  ctx.fillStyle = COLORS.cyan;
  ctx.fillText('MICROTUBULE STRUCTURE', textX, textY);
  textY += compact ? 12 : 16;

  const infoLines = [
    ['Protofilaments', '13'],
    ['Outer diameter', '~25 nm'],
    ['Inner diameter', '~15 nm'],
    ['Tubulin dimers', '8 nm each'],
    ['Lattice', '3-start helix'],
    ['Chirality', 'Left-handed'],
  ];
  ctx.font = monoFont(compact ? 11 : 12);
  for (const [label, value] of infoLines) {
    ctx.strokeStyle = INK.grid;
    ctx.beginPath();
    ctx.moveTo(textX, Math.round(textY) + 0.5);
    ctx.lineTo(textX + sheetW, Math.round(textY) + 0.5);
    ctx.stroke();
    textY += lineH;
    ctx.fillStyle = INK.dim;
    ctx.fillText(label, textX, textY - lineH * 0.32);
    ctx.fillStyle = INK.text;
    ctx.fillText(value, valX, textY - lineH * 0.32);
  }

  // Resonance meter
  textY += compact ? 16 : 24;
  ctx.font = monoFont(compact ? 10 : 11, 700);
  ctx.fillStyle = res > 0.5 ? COLORS.cyan : INK.dim;
  ctx.fillText('RESONANCE', textX, textY);
  const barX = textX + (compact ? 92 : 100);
  const barW = Math.max(80, sheetW - (barX - textX));
  const barH = 6;
  const barY = textY - 7;
  ctx.fillStyle = 'rgba(74,59,40,0.7)';
  ctx.fillRect(barX, barY, barW, barH);
  if (res > 0.002) {
    const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    grad.addColorStop(0, 'rgba(232,131,58,0.35)');
    grad.addColorStop(1, '#ffb066');
    ctx.fillStyle = grad;
    ctx.shadowColor = 'rgba(232,131,58,0.8)';
    ctx.shadowBlur = 8;
    ctx.fillRect(barX, barY, barW * res, barH);
    ctx.shadowBlur = 0;
  }
  ctx.strokeStyle = 'rgba(160,146,111,0.35)';
  for (let k = 1; k < 4; k++) {
    const x = Math.round(barX + (k / 4) * barW) + 0.5;
    ctx.beginPath(); ctx.moveTo(x, barY + barH + 2); ctx.lineTo(x, barY + barH + 5); ctx.stroke();
  }
  ctx.fillStyle = INK.muted;
  ctx.font = monoFont(compact ? 9 : 10);
  ctx.fillText(mtState.driveFreq > 0 ? 'drive ' + formatFreq(mtState.driveFreq) : 'drive off · move the slider', textX, textY + (compact ? 18 : 22));
}

// Side view: the lattice itself. 13 protofilaments of alternating α/β tubulin
// wrap a slowly turning cylinder; each protofilament sits 3/13 of a monomer
// further along than its neighbour, which is what makes the 3-start helix.
function drawMTSide(ctx, w, h, res) {
  const compact = isCompact(w);
  const cx = w / 2;
  const cy = compact ? h * 0.36 : h * 0.46;
  const tubeLen = w * (compact ? 0.86 : 0.76);
  const R = compact ? Math.min(h * 0.14, w * 0.17) : h * 0.17;
  const startX = cx - tubeLen / 2;
  const endX = cx + tubeLen / 2;
  const nProto = 13;
  const nMono = compact ? 24 : 36;            // monomers along the tube
  const monoW = tubeLen / nMono;              // one monomer ≈ 4 nm
  const rot = mtState.time * (REDUCED_MOTION ? 0.05 : 0.22);
  const beadRy = R * Math.sin(Math.PI / nProto) * 0.8;

  drawBackdrop(ctx, w, h, 'rgba(232,131,58,', 0.04 + res * 0.07);

  // Glow along the tube at resonance
  if (res > 0.05) {
    const g = ctx.createLinearGradient(0, cy - R * 2, 0, cy + R * 2);
    g.addColorStop(0, 'rgba(232,131,58,0)');
    g.addColorStop(0.5, `rgba(232,131,58,${res * 0.16})`);
    g.addColorStop(1, 'rgba(232,131,58,0)');
    ctx.fillStyle = g;
    ctx.fillRect(startX - 20, cy - R * 2, tubeLen + 40, R * 4);
  }

  // Collect every bead, then paint far side first.
  const beads = [];
  for (let p = 0; p < nProto; p++) {
    const theta = (p / nProto) * TAU + rot;
    const z = Math.cos(theta);
    const offset = (p * 3) / nProto;          // the 3-start stagger, in monomers
    for (let k = -1; k <= nMono; k++) {
      const s = k + offset;
      if (s < 0 || s > nMono - 0.5) continue;
      const x = startX + (s + 0.5) * monoW;
      const wave = res > 0.05 ? Math.sin(mtState.wavePhase - (x - startX) / tubeLen * TAU * 2) * res : 0;
      const r = R * (1 + 0.07 * Math.max(0, wave));
      beads.push({ x, y: cy + Math.sin(theta) * r, z, k, p, wave });
    }
  }
  beads.sort((a, b) => a.z - b.z);

  for (const b of beads) {
    let rgb;
    if (mtState.showHelix) {
      rgb = HELIX_COLORS[((b.k % 3) + 3) % 3].rgb;      // same k = same helical strand
    } else {
      rgb = b.k % 2 === 0 ? [214, 112, 52] : [240, 176, 112]; // α darker, β lighter
    }
    const depth = (b.z + 1) / 2;                       // 0 back .. 1 front
    const alpha = b.z < 0 ? 0.1 + depth * 0.3 : 0.45 + depth * 0.55;
    const ry = Math.max(1.2, beadRy * (0.35 + 0.65 * Math.abs(b.z)));
    drawBead(ctx, b.x, b.y, monoW * 0.4, ry, rgb, Math.max(0, b.wave) * 0.7, alpha);
  }

  // Tube silhouette and end caps
  ctx.strokeStyle = `rgba(232,131,58,${0.22 + res * 0.35})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(startX, cy, R * 0.22, R * 1.08, 0, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(endX, cy, R * 0.22, R * 1.08, 0, 0, TAU);
  ctx.stroke();

  // Polarity labels
  ctx.fillStyle = INK.muted;
  ctx.font = monoFont(compact ? 9 : 10);
  ctx.textAlign = 'center';
  ctx.fillText('− end', startX, cy + R * 1.08 + 18);
  ctx.fillText('+ end', endX, cy + R * 1.08 + 18);

  // Legend: α/β, or the three helix strands
  const legY = compact ? 26 : 30;
  let lx = compact ? 16 : 24;
  ctx.textAlign = 'left';
  ctx.font = monoFont(compact ? 9 : 10);
  const legend = mtState.showHelix
    ? [[HELIX_COLORS[0].rgb, 'strand 1'], [HELIX_COLORS[1].rgb, 'strand 2'], [HELIX_COLORS[2].rgb, 'strand 3']]
    : [[[214, 112, 52], 'α-tubulin'], [[240, 176, 112], 'β-tubulin']];
  for (const [rgb, label] of legend) {
    drawBead(ctx, lx + 5, legY - 4, 5, 5, rgb);
    ctx.fillStyle = INK.dim;
    ctx.fillText(label, lx + 15, legY);
    lx += ctx.measureText(label).width + 34;
  }

  if (res > 0.3) {
    const ay = cy + R * 1.08 + (compact ? 46 : 52);
    ctx.fillStyle = `rgba(255,176,102,${res * 0.8})`;
    ctx.font = monoFont(compact ? 10 : 11, 700);
    ctx.textAlign = 'center';
    ctx.fillText('Wave propagating at resonance', cx, ay);
    ctx.strokeStyle = `rgba(255,176,102,${res * 0.7})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 50, ay + 12); ctx.lineTo(cx + 50, ay + 12);
    ctx.lineTo(cx + 43, ay + 8); ctx.moveTo(cx + 50, ay + 12); ctx.lineTo(cx + 43, ay + 16);
    ctx.stroke();
  }

  // Scale bar: ten monomers of 4 nm
  const scaleW = monoW * 10;
  const scaleY = compact ? cy + R * 1.08 + (res > 0.3 ? 96 : 56) : h - 26;
  ctx.strokeStyle = INK.dim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - scaleW / 2, scaleY); ctx.lineTo(cx + scaleW / 2, scaleY);
  ctx.moveTo(cx - scaleW / 2, scaleY - 3); ctx.lineTo(cx - scaleW / 2, scaleY + 3);
  ctx.moveTo(cx + scaleW / 2, scaleY - 3); ctx.lineTo(cx + scaleW / 2, scaleY + 3);
  ctx.stroke();
  ctx.fillStyle = INK.dim;
  ctx.font = monoFont(10);
  ctx.textAlign = 'center';
  ctx.fillText('~40 nm', cx, scaleY + 15);
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

  AnimLoop.register(canvas, (dt, ctx, w, h) => {
    if (cascadeState.playing) {
      cascadeState.time += dt * cascadeState.speed;
    }
    drawCascade(ctx, w, h);
  });
}

// One layout for both cascade views (visual and RK4). Desktop puts the row
// labels in a measured left gutter; a phone stacks each label above its row.
function cascadeLayout(ctx, w, h, labels) {
  const compact = isCompact(w);
  let padL = 14;
  if (!compact) {
    ctx.font = monoFont(11);
    padL = Math.max(120, ...labels.map(l => ctx.measureText(l).width)) + 34;
  }
  const padR = compact ? 14 : 36;
  const padT = compact ? 58 : 52;
  const padB = compact ? 62 : 64;
  return { compact, padL, padR, padT, padB, plotW: w - padL - padR, plotH: h - padT - padB };
}

// Title text, split onto two lines on a phone at its em-dash.
function drawCascadeTitle(ctx, text, w, compact, color = INK.text) {
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  if (compact && text.includes(' — ')) {
    const [a, b] = text.split(' — ');
    ctx.font = monoFont(11, 700);
    ctx.fillText(a, w / 2, 20);
    ctx.font = monoFont(10);
    ctx.fillStyle = INK.dim;
    ctx.fillText(b, w / 2, 35);
  } else {
    ctx.font = monoFont(compact ? 11 : 13, 700);
    ctx.fillText(text, w / 2, 24);
  }
}

// A trace sampled once, drawn bright up to the playhead and as a faint ghost
// ahead of it, so the eye follows the order things fire in.
function strokeTrace(ctx, pts, playX, color, midY, width = 1.5) {
  if (pts.length < 2) return;
  const split = pts.findIndex(p => p[0] > playX);
  const cut = split === -1 ? pts.length : Math.max(1, split);

  // ghost ahead
  ctx.beginPath();
  for (let i = Math.max(0, cut - 1); i < pts.length; i++) {
    if (i === Math.max(0, cut - 1)) ctx.moveTo(pts[i][0], pts[i][1]); else ctx.lineTo(pts[i][0], pts[i][1]);
  }
  ctx.strokeStyle = color.glow + '0.2)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // played: soft fill to the baseline, then the glowing line
  ctx.beginPath();
  ctx.moveTo(pts[0][0], midY);
  for (let i = 0; i < cut; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.lineTo(pts[cut - 1][0], midY);
  ctx.closePath();
  ctx.fillStyle = color.glow + '0.08)';
  ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < cut; i++) {
    if (i === 0) ctx.moveTo(pts[i][0], pts[i][1]); else ctx.lineTo(pts[i][0], pts[i][1]);
  }
  ctx.shadowColor = color.glow + '0.9)';
  ctx.shadowBlur = 7;
  ctx.strokeStyle = color.main;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // the pen
  const tip = pts[cut - 1];
  if (split !== -1) {
    ctx.beginPath();
    ctx.arc(tip[0], tip[1], 2.4, 0, TAU);
    ctx.fillStyle = '#fff4e2';
    ctx.fill();
  }
}

function drawPlayhead(ctx, x, padT, plotH, label) {
  const g = ctx.createLinearGradient(0, padT, 0, padT + plotH);
  g.addColorStop(0, 'rgba(255,244,226,0.75)');
  g.addColorStop(1, 'rgba(255,244,226,0.08)');
  ctx.strokeStyle = g;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Math.round(x) + 0.5, padT);
  ctx.lineTo(Math.round(x) + 0.5, padT + plotH);
  ctx.stroke();
  if (label) drawPill(ctx, label, x, padT - 10, '#fff4e2');
}

function cascadeLabels(model, flipped) {
  if (model !== 'bandyopadhyay') return ['Membrane Potential (mV)'];
  return flipped
    ? ['Membrane Spike (kHz)', 'Filament Burst 1-2 (MHz)', 'Filament Burst 3-4 (MHz)']
    : ['Filament Burst 1-2 (MHz)', 'Filament Burst 3-4 (MHz)', 'Membrane Spike (kHz)'];
}

function drawCascade(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  const model = cascadeState.model;
  const flipped = cascadeState.flipped;
  const L = cascadeLayout(ctx, w, h, cascadeLabels(model, flipped));
  const { compact, padL, padT, plotW, plotH } = L;
  const cycleLen = 6; // seconds per full cycle
  const t = (cascadeState.time % cycleLen) / cycleLen; // 0-1 normalized time

  drawBackdrop(ctx, w, h);

  if (model === 'bandyopadhyay') {
    drawCascadeTitle(ctx, flipped ? 'Bandyopadhyay Model — FLIPPED ORDER (membrane first)' : 'Bandyopadhyay Model — Filaments Fire First', w, compact);
  } else {
    drawCascadeTitle(ctx, 'Classical Hodgkin-Huxley Model — Membrane Only', w, compact);
  }

  // Time axis
  const timeLabels = ['0 ms', '0.5 ms', '1.0 ms', '1.5 ms', '2.0 ms'];
  for (let i = 0; i < 5; i++) {
    const x = Math.round(padL + (i / 4) * plotW) + 0.5;
    ctx.strokeStyle = i === 0 || i === 4 ? INK.gridStrong : INK.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
    if (compact && i % 2) continue;
    ctx.fillStyle = INK.muted;
    ctx.font = monoFont(compact ? 9 : 10);
    ctx.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center';
    ctx.fillText(timeLabels[i], x, padT + plotH + 18);
  }
  if (!compact && model === 'bandyopadhyay') {
    ctx.fillStyle = INK.muted;
    ctx.font = monoFont(10);
    ctx.textAlign = 'center';
    ctx.fillText('Time', padL + plotW / 2, h - 8);
  }

  const playX = padL + t * plotW;
  if (model === 'bandyopadhyay') {
    drawBandyopadhyayCascade(ctx, L, t, flipped, playX);
  } else {
    drawHHCascade(ctx, L, t, playX);
  }

  drawPlayhead(ctx, playX, padT, plotH, (t * 2).toFixed(2) + ' ms');
}

function drawRowLabel(ctx, L, text, color, rowTop, rowH) {
  ctx.fillStyle = color.main;
  ctx.font = monoFont(L.compact ? 10 : 11);
  if (L.compact) {
    ctx.textAlign = 'left';
    ctx.fillText(text, L.padL, rowTop + 14);
  } else {
    ctx.textAlign = 'right';
    ctx.fillText(text, L.padL - 14, rowTop + rowH / 2 + 4);
    ctx.beginPath();
    ctx.arc(L.padL - 7, rowTop + rowH / 2, 2.5, 0, TAU);
    ctx.fill();
  }
}

function drawBandyopadhyayCascade(ctx, L, t, flipped, playX) {
  const { padL, padT, plotW, plotH } = L;
  const rowH = plotH / 3;
  const labels = cascadeLabels('bandyopadhyay', flipped);
  const rowColors = flipped
    ? [COLORS.khz, COLORS.mhz, COLORS.mhz]
    : [COLORS.mhz, COLORS.mhz, COLORS.khz];

  for (let r = 0; r < 3; r++) {
    const rowY = padT + r * rowH;
    drawRowLabel(ctx, L, labels[r], rowColors[r], rowY, rowH);
    if (r < 2) {
      ctx.strokeStyle = INK.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, Math.round(rowY + rowH) + 0.5);
      ctx.lineTo(padL + plotW, Math.round(rowY + rowH) + 0.5);
      ctx.stroke();
    }
  }

  // Bandyopadhyay timing: ~4 filament bursts in ~250μs, then membrane spike,
  // normalized to fit the 2 ms window. Each row lists both cycles' bursts.
  const rowsNormal = [
    [[0.05, 0.12, 0.55, 0.62], COLORS.mhz, 'fast'],
    [[0.19, 0.26, 0.69, 0.76], COLORS.mhz, 'fast'],
    [[0.35, 0.85], COLORS.khz, 'slow'],
  ];
  const rowsFlipped = [
    [[0.10, 0.60], COLORS.khz, 'slow'],
    [[0.20, 0.28, 0.72, 0.78], COLORS.mhz, 'noisy'],
    [[0.32, 0.40, 0.82, 0.90], COLORS.mhz, 'noisy'],
  ];
  const rows = flipped ? rowsFlipped : rowsNormal;
  rows.forEach(([times, color, mode], r) => {
    drawSignalBurst(ctx, padL, padT + r * rowH, plotW, rowH, r, times, t, color, mode, playX, L.compact);
  });

  if (!flipped) {
    // Causal arrows (drawn while the cascade runs)
    if (t > 0.12 && t < 0.55) {
      drawCausalArrow(ctx, padL + 0.12 * plotW, padT + rowH * 0.5,
                       padL + 0.19 * plotW, padT + rowH * 1.5, t, 0.12, 0.19);
    }
    if (t > 0.26 && t < 0.55) {
      drawCausalArrow(ctx, padL + 0.26 * plotW, padT + rowH * 1.5,
                       padL + 0.35 * plotW, padT + rowH * 2.5, t, 0.26, 0.35);
    }
    // 250μs annotation: a bracket under the axis
    const arrowY = padT + plotH + 32;
    const x1 = padL + 0.05 * plotW;
    const x2 = padL + 0.35 * plotW;
    ctx.strokeStyle = 'rgba(217,164,65,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, arrowY - 4); ctx.lineTo(x1, arrowY); ctx.lineTo(x2, arrowY); ctx.lineTo(x2, arrowY - 4);
    ctx.stroke();
    ctx.fillStyle = COLORS.amber;
    ctx.font = monoFont(L.compact ? 9 : 10);
    ctx.textAlign = 'center';
    ctx.fillText('~250 μs (filaments lead)', (x1 + x2) / 2 + (L.compact ? 30 : 0), arrowY + 14);
  } else {
    ctx.fillStyle = COLORS.red;
    ctx.font = monoFont(L.compact ? 9 : 11, 700);
    ctx.textAlign = 'center';
    ctx.fillText(L.compact ? 'DECOHERENT — timing jitter' : 'DECOHERENT — timing jitter, signal degradation', padL + plotW / 2, padT + plotH + 34);
  }
}

function drawSignalBurst(ctx, padL, rowY, plotW, rowH, rowIdx, peakTimes, t, color, mode, playX, compact) {
  const midY = rowY + rowH * (compact ? 0.74 : 0.55);
  const ampH = rowH * (compact ? 0.27 : 0.38);
  const fadeIn = clamp(t * 8, 0, 1);
  const pts = [];

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
        y += Math.exp(-(dx * dx) / 0.001) * 0.3 * Math.sin(normX * 200 + pt * 100);
      }
    }
    pts.push([padL + x, midY - y * fadeIn * ampH]);
  }

  // Baseline
  ctx.strokeStyle = color.glow + '0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, Math.round(midY) + 0.5);
  ctx.lineTo(padL + plotW, Math.round(midY) + 0.5);
  ctx.stroke();

  strokeTrace(ctx, pts, playX, color, midY);

  // A flash as the playhead crosses each burst
  const tPlay = (playX - padL) / plotW;
  for (const pt of peakTimes) {
    const since = tPlay - pt;
    if (since < 0 || since > 0.06) continue;
    const k = 1 - since / 0.06;
    const fx = padL + pt * plotW;
    const fl = ctx.createRadialGradient(fx, midY, 0, fx, midY, rowH * 0.6);
    fl.addColorStop(0, color.glow + (0.35 * k) + ')');
    fl.addColorStop(1, color.glow + '0)');
    ctx.fillStyle = fl;
    ctx.beginPath();
    ctx.arc(fx, midY, rowH * 0.6, 0, TAU);
    ctx.fill();
  }
}

function drawCausalArrow(ctx, x1, y1, x2, y2, t, tStart, tEnd) {
  const progress = clamp((t - tStart) / (tEnd - tStart), 0, 1);
  if (progress < 0.1) return;
  const curX = lerp(x1, x2, progress);
  const curY = lerp(y1, y2, progress);

  ctx.strokeStyle = `rgba(217,164,65,${0.7 * progress})`;
  ctx.lineWidth = 1.25;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(curX, curY);
  ctx.stroke();
  ctx.setLineDash([]);

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

function drawHHCascade(ctx, L, t, playX) {
  // Classical model: single membrane channel
  const { padL, padT, plotW, plotH, compact } = L;
  const midY = padT + plotH / 2;
  drawRowLabel(ctx, L, 'Membrane Potential (mV)', COLORS.khz, compact ? padT : padT, compact ? 0 : plotH);

  const fadeIn = clamp(t * 5, 0, 1);
  const pts = [];
  for (let x = 0; x <= plotW; x += 1) {
    const normX = x / plotW;
    let v = 0;
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
    pts.push([padL + x, midY + plotH * 0.15 - v * fadeIn * plotH * 0.45]);
  }
  const restY = midY + plotH * 0.15;
  ctx.strokeStyle = COLORS.khz.glow + '0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, Math.round(restY) + 0.5);
  ctx.lineTo(padL + plotW, Math.round(restY) + 0.5);
  ctx.stroke();
  strokeTrace(ctx, pts, playX, COLORS.khz, restY, 2);

  ctx.fillStyle = INK.dim;
  ctx.font = monoFont(10);
  ctx.textAlign = 'left';
  ctx.fillText('+40 mV', padL + 6, restY - plotH * 0.45 + 4);
  ctx.fillText('-70 mV', padL + 6, restY - 6);
  ctx.fillText('-90 mV', padL + 6, restY + plotH * 0.135 + 14);

  ctx.fillStyle = INK.muted;
  ctx.font = monoFont(compact ? 9 : 11);
  ctx.textAlign = 'center';
  if (compact) {
    ctx.fillText('Membrane-only, no filament precursor', padL + plotW / 2, padT + plotH + 34);
    ctx.fillText('ms timescale only — no MHz component', padL + plotW / 2, padT + plotH + 48);
  } else {
    ctx.fillText('Classical model: membrane-only, no filament precursor signal', padL + plotW / 2, padT + plotH + 34);
    ctx.fillText('Millisecond timescale only — no MHz component', padL + plotW / 2, padT + plotH + 50);
  }
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

  // Initialize particles. Math.random() is deliberate here: this is visual
  // jitter that never feeds a reported number (physics.js uses PhysicsRNG).
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

  AnimLoop.register(canvas, (dt, ctx, w, h) => {
    holoState.time += dt;
    drawHolographic(ctx, w, h);
  });
}

function drawHolographic(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  const compact = isCompact(w);
  const cx = w / 2;
  const cy = compact ? h * 0.53 : h / 2;
  const stim = holoState.stimulation / 100;
  const t = holoState.time;
  // Ring radii were authored for a 500 px tall canvas; scale to whatever fits.
  const unit = (compact ? Math.min(w * 0.42, h * 0.36) : Math.min(w * 0.46, h * 0.44)) / 210;

  const clockColors = {
    mhz:  { main: COLORS.cyan,   glow: 'rgba(232,131,58,',  r: [60, 110, 160], l: 1 },
    ghz:  { main: COLORS.amber,  glow: 'rgba(217,164,65,',  r: [80, 130, 180], l: 2 },
    thz:  { main: PHYS.main,     glow: PHYS.glow,           r: [100, 150, 200], l: 3 },
  };

  drawBackdrop(ctx, w, h, 'rgba(232,131,58,', 0.03 + stim * 0.05);

  const activeClocks = holoState.activeClock === 'all'
    ? ['mhz', 'ghz', 'thz']
    : [holoState.activeClock];

  ctx.globalCompositeOperation = 'lighter';

  // Optical vortex rings. A beam carrying orbital angular momentum ℓ is a
  // bright doughnut whose phase winds ℓ times round the axis; the ℓ arms that
  // turn inside each ring draw that winding.
  for (const clockKey of activeClocks) {
    const clock = clockColors[clockKey];
    clock.r.forEach((baseR, ri) => {
      const r = (baseR + Math.sin(t * (1 + ri * 0.3) + ri) * 5) * unit;
      const opacity = (0.08 + stim) * (0.2 + ri * 0.06);
      const band = (10 + stim * 8) * unit;

      // the doughnut: a soft annulus
      const g = ctx.createRadialGradient(cx, cy, Math.max(0, r - band), cx, cy, r + band);
      g.addColorStop(0, clock.glow + '0)');
      g.addColorStop(0.5, clock.glow + (opacity * 0.9) + ')');
      g.addColorStop(1, clock.glow + '0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r + band, 0, TAU);
      ctx.arc(cx, cy, Math.max(0, r - band), 0, TAU, true);
      ctx.fill();

      // a fine core line
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.strokeStyle = clock.glow + (opacity * 1.2) + ')';
      ctx.lineWidth = 1;
      ctx.stroke();

      // ℓ phase arms, each a short arc that brightens toward its head
      const speed = (REDUCED_MOTION ? 0.3 : 1) * (1.2 + ri * 0.4) * (ri % 2 ? -1 : 1);
      for (let a = 0; a < clock.l; a++) {
        const head = (a / clock.l) * TAU + t * speed;
        const len = 0.9 / clock.l + 0.25;
        const steps = 14;
        for (let s = 0; s < steps; s++) {
          const f = s / steps;
          const ang0 = head - len * (1 - f) * Math.sign(speed);
          const ang1 = head - len * (1 - (s + 1) / steps) * Math.sign(speed);
          ctx.beginPath();
          ctx.arc(cx, cy, r, Math.min(ang0, ang1), Math.max(ang0, ang1));
          ctx.strokeStyle = clock.glow + (Math.min(1, 0.25 + stim) * f) + ')';
          ctx.lineWidth = (1.5 + 3 * f) * Math.max(0.7, unit);
          ctx.stroke();
        }
      }
    });
  }

  // Photons
  const step = (REDUCED_MOTION ? 0.3 : 1);
  for (const p of holoState.particles) {
    if (holoState.activeClock !== 'all' && p.clock !== holoState.activeClock) continue;
    p.angle += p.speed * (1 + stim) * step;
    p.phase += 0.02;
    const clock = clockColors[p.clock];
    const pr = p.r * unit;
    const px = cx + Math.cos(p.angle) * pr;
    const py = cy + Math.sin(p.angle) * pr;
    const brightness = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(p.phase));
    const size = p.size * (0.8 + stim * 0.5) * Math.max(0.75, unit);
    ctx.beginPath();
    ctx.arc(px, py, size, 0, TAU);
    ctx.fillStyle = clock.glow + (brightness * stim * 0.75) + ')';
    ctx.fill();
  }

  // Core: the microtubule end-on, glowing with the stimulation
  const coreR = 25 * unit;
  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 2.4);
  coreGrad.addColorStop(0, `rgba(255,236,210,${0.18 + stim * 0.25})`);
  coreGrad.addColorStop(0.45, `rgba(232,131,58,${0.1 + stim * 0.15})`);
  coreGrad.addColorStop(1, 'rgba(232,131,58,0)');
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, coreR * 2.4, 0, TAU);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 13; i++) {
    const angle = (i / 13) * TAU;
    drawBead(ctx, cx + Math.cos(angle) * coreR, cy + Math.sin(angle) * coreR,
      3.4 * Math.max(0.7, unit), 3.4 * Math.max(0.7, unit), EMBER_RGB, stim * 0.6, 0.5 + stim * 0.5);
  }

  // Labels for active clocks
  let labelY = compact ? 22 : 30;
  ctx.textAlign = 'left';
  ctx.font = monoFont(compact ? 10 : 12);
  for (const clockKey of activeClocks) {
    const clock = clockColors[clockKey];
    ctx.fillStyle = clock.main;
    ctx.globalAlpha = 0.45 + stim * 0.55;
    ctx.fillText(
      clockKey.toUpperCase() + ' clock — angular momentum = ' + (clockKey === 'mhz' ? '1' : clockKey === 'ghz' ? '2' : '3'),
      compact ? 14 : 20, labelY
    );
    labelY += compact ? 16 : 20;
    ctx.globalAlpha = 1;
  }

  // Corner annotation
  ctx.fillStyle = 'rgba(236,225,204,0.42)';
  ctx.font = monoFont(compact ? 9 : 10);
  ctx.textAlign = compact ? 'left' : 'right';
  const ax = compact ? 14 : w - 20;
  ctx.fillText('EM stimulation selectively brightens components', ax, h - (compact ? 30 : 35));
  ctx.fillText('Each ring = distinct angular momentum state', ax, h - (compact ? 16 : 20));
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
    test: 'Drive the double well and measure the two-state (well-to-well) SNR at the drive frequency across noise levels. Positive control: a slow drive (f = 0.01) must show the SR peak near the Kramers time-scale-matching noise D*. Predict: an interior SNR peak at the native drive too.',
    falsification: 'If the control finds SR but no native frequency shows an interior peak clearly above a no-signal run, SR is not demonstrated at the model\'s drive.',
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
          <button class="btn" aria-label="${hypo.id}: go to ${hypo.panel} panel" data-action="panel" data-hypo="${hypo.id}" data-panel="${hypo.panel}">Go to Panel</button>
          <button class="btn" aria-label="${hypo.id}: cycle hypothesis status" data-action="cycle" data-hypo="${hypo.id}">Cycle Status</button>
          <button class="btn physics-action-btn" aria-label="${hypo.id}: run computation" data-action="run" data-hypo="${hypo.id}">Run Computation</button>
        </div>
        <textarea class="hypo-notes" aria-label="${hypo.id}: notes and observations" placeholder="Add notes/observations..."
          data-action="note" data-hypo="${hypo.id}">${hypo.notes}</textarea>
      </div>
    `;

    card.addEventListener('click', (e) => {
      // Don't toggle if clicking on interactive elements
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'TEXTAREA') return;
      card.classList.toggle('expanded');
    });

    grid.appendChild(card);
  }

  // Delegated once per grid: the enforced CSP blocks inline handlers, so the
  // card buttons carry data-action/data-hypo and the grid routes the click.
  if (!grid.dataset.wired) {
    grid.dataset.wired = 'true';
    grid.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn || !grid.contains(btn)) return;
      const id = btn.dataset.hypo;
      if (btn.dataset.action === 'panel') goToPanel(btn.dataset.panel);
      else if (btn.dataset.action === 'cycle') cycleStatus(id);
      else if (btn.dataset.action === 'run') runHypothesisTest(id, btn);
    });
    grid.addEventListener('change', (e) => {
      const ta = e.target.closest('textarea[data-action="note"]');
      if (ta) saveHypoNote(ta.dataset.hypo, ta.value);
    });
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
      sensBtn.textContent = 'Computing (several minutes)...';
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
        <tr><td>Thermal sufficient?</td><td>${result.thermal.thermalSufficient === null ? 'Undetermined' : result.thermal.thermalSufficient ? 'Yes' : 'No'} — ${result.thermal.thermalNote}</td></tr>
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
      <span class="metric-label">SNR at lowest noise (D=${result.noiseLevels[0]})</span>
      <span class="metric-value">${result.meanSNR[0].toFixed(4)}</span>
    </div>
    <div class="metric-row">
      <span class="metric-label">Peak/baseline ratio</span>
      <span class="metric-value ${result.peakSNR > result.meanSNR[0] * 2 ? 'good' : 'warn'}">${(result.peakSNR / (result.meanSNR[0] + 1e-10)).toFixed(2)}x</span>
    </div>
    <div class="metric-row">
      <span class="metric-label">Stochastic resonance (interior SNR peak)</span>
      ${(() => {
        // Same rule as HypothesisRunner.verdictH6: a resonance needs an interior peak, not just a rise.
        const v = HypothesisRunner.verdictH6(result.meanSNR);
        const label = v === 'plausible' ? 'PEAK FOUND' : v === 'falsified' ? 'NONE (noise only hurts)' : 'NO PEAK IN RANGE';
        return `<span class="metric-value ${v === 'plausible' ? 'good' : 'warn'}">${label}</span>`;
      })()}
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

// A time series drawn like a scope trace. When there are more cycles than
// pixels (the MHz oscillator), a line would smear into a solid slab, so each
// pixel column shows the min..max the signal reached there instead.
function plotSeries(ctx, tArr, xArr, maxAbs, maxT, padL, plotW, midY, ampH, color) {
  const cols = Math.max(1, Math.floor(plotW));
  const yOf = v => midY - (v / maxAbs) * ampH;
  if (tArr.length > cols * 1.5) {
    const lo = new Array(cols).fill(Infinity), hi = new Array(cols).fill(-Infinity);
    for (let i = 0; i < tArr.length; i++) {
      const c = Math.min(cols - 1, Math.floor((tArr[i] / maxT) * cols));
      if (xArr[i] < lo[c]) lo[c] = xArr[i];
      if (xArr[i] > hi[c]) hi[c] = xArr[i];
    }
    ctx.beginPath();
    let started = false;
    for (let c = 0; c < cols; c++) {
      if (hi[c] === -Infinity) continue;
      const x = padL + c;
      if (!started) { ctx.moveTo(x, yOf(hi[c])); started = true; } else ctx.lineTo(x, yOf(hi[c]));
    }
    for (let c = cols - 1; c >= 0; c--) {
      if (lo[c] === Infinity) continue;
      ctx.lineTo(padL + c, yOf(lo[c]));
    }
    ctx.closePath();
    ctx.fillStyle = color.glow + '0.22)';
    ctx.fill();
    ctx.strokeStyle = color.glow + '0.85)';
    ctx.lineWidth = 1;
    ctx.stroke();
    return;
  }
  ctx.beginPath();
  for (let i = 0; i < tArr.length; i++) {
    const x = padL + (tArr[i] / maxT) * plotW;
    const y = yOf(xArr[i]);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.shadowColor = color.glow + '0.8)';
  ctx.shadowBlur = 6;
  ctx.strokeStyle = color.main;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

// Enhance the cascade panel to render RK4 data when in physics mode
function drawPhysicsCascade(ctx, w, h) {
  if (!PhysicsMode.active || !PhysicsResults.engine1) {
    return false; // fall through to visual mode
  }

  const ts = PhysicsResults.engine1.timeSeries;
  const phaseLead = PhysicsResults.engine1.phaseLead;
  if (!ts || ts.t.length === 0) return false;

  ctx.clearRect(0, 0, w, h);
  const L = cascadeLayout(ctx, w, h, ['Fast (MHz filament)', 'Slow (kHz membrane)']);
  const { compact, padL, padR, padT, plotW, plotH } = L;
  drawBackdrop(ctx, w, h, PHYS.glow, 0.05);

  // Title
  drawCascadeTitle(ctx, 'RK4 Coupled Oscillator — Real Physics', w, compact, PHYS.main);

  // Time axis
  ctx.lineWidth = 1;
  const maxT = ts.t[ts.t.length - 1];
  for (let i = 0; i <= 4; i++) {
    const x = Math.round(padL + (i / 4) * plotW) + 0.5;
    ctx.strokeStyle = i === 0 || i === 4 ? INK.gridStrong : INK.grid;
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
    if (compact && i % 2) continue;
    ctx.fillStyle = INK.muted;
    ctx.font = monoFont(compact ? 9 : 10);
    ctx.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center';
    ctx.fillText((maxT * i / 4).toFixed(0) + ' us', x, padT + plotH + 18);
  }

  ctx.fillStyle = INK.muted;
  ctx.font = monoFont(compact ? 9 : 10);
  ctx.textAlign = 'center';
  ctx.fillText('Time (microseconds)', padL + plotW / 2, h - 8);

  // Two rows: fast oscillator (top) and slow oscillator (bottom)
  const rowH = plotH / 2;
  drawRowLabel(ctx, L, 'Fast (MHz filament)', COLORS.mhz, padT, rowH);
  drawRowLabel(ctx, L, 'Slow (kHz membrane)', COLORS.khz, padT + rowH, rowH);

  // Row separator
  ctx.strokeStyle = INK.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, Math.round(padT + rowH) + 0.5);
  ctx.lineTo(padL + plotW, Math.round(padT + rowH) + 0.5);
  ctx.stroke();

  // Normalize amplitudes
  const maxFast = Math.max(...ts.xFast.map(Math.abs)) || 1;
  const maxSlow = Math.max(...ts.xSlow.map(Math.abs)) || 1;

  // Draw both oscillators
  const midY1 = padT + rowH * 0.5;
  const midY2 = padT + rowH * 1.5;
  plotSeries(ctx, ts.t, ts.xFast, maxFast, maxT, padL, plotW, midY1, rowH * 0.35, COLORS.mhz);
  plotSeries(ctx, ts.t, ts.xSlow, maxSlow, maxT, padL, plotW, midY2, rowH * 0.35, COLORS.khz);

  // Baselines
  ctx.strokeStyle = 'rgba(238,165,77,0.14)';
  ctx.lineWidth = 1;
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
    const arrowY = padT + plotH + 32;
    const x1 = padL + (phaseLead.fastPeakTime / maxT) * plotW;
    const x2 = padL + (phaseLead.slowPeakTime / maxT) * plotW;

    if (x1 > padL && x2 > padL && x1 < padL + plotW && x2 < padL + plotW) {
      ctx.strokeStyle = 'rgba(217,164,65,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x1, arrowY - 4); ctx.lineTo(x1, arrowY); ctx.lineTo(x2, arrowY); ctx.lineTo(x2, arrowY - 4);
      ctx.stroke();
      ctx.fillStyle = COLORS.amber;
      ctx.font = monoFont(10);
      ctx.textAlign = 'center';
      ctx.fillText(`Phase lead: ${phaseLead.leadTime_us.toFixed(0)} us`, (x1 + x2) / 2, arrowY + 14);
    }
  }

  // Physics parameters annotation
  ctx.fillStyle = PHYS.glow + '0.75)';
  ctx.font = monoFont(compact ? 9 : 10);
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

  const { padL, padT, plotW, plotH } = spectrumLayout(w, h);
  const [fMin, fMax] = getFreqRange();
  const logMin = Math.log10(fMin);
  const logMax = Math.log10(fMax);

  // Draw Schumann harmonic markers
  ctx.font = monoFont(9);
  ctx.textAlign = 'center';

  for (const match of result.schumannMatches) {
    const logF = Math.log10(match.schumannFreq);
    const nx = (logF - logMin) / (logMax - logMin);
    if (nx < 0 || nx > 1) continue;
    const x = padL + nx * plotW;

    // Vertical marker
    ctx.strokeStyle = match.isMatch ? COLORS.mhz.glow + '0.65)' : PHYS.glow + '0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    // Label
    ctx.fillStyle = match.isMatch ? COLORS.mhz.main : PHYS.glow + '0.7)';
    ctx.fillText('S' + (result.schumannMatches.indexOf(match) + 1), x, padT + plotH + 40);
  }

  // Annotation
  ctx.fillStyle = PHYS.glow + '0.7)';
  ctx.font = monoFont(9);
  ctx.textAlign = 'right';
  ctx.fillText('S = Schumann harmonic', padL + plotW, padT + plotH + 52);
}

function drawStochasticOverlay(ctx, w, h, result) {
  // Small inset SNR curve in bottom-right corner
  const { padR, padT } = spectrumLayout(w, h);
  const insetW = isCompact(w) ? 132 : 160, insetH = isCompact(w) ? 68 : 80;
  const insetX = w - padR - insetW - 4;
  const insetY = padT + 4;

  // Background
  ctx.fillStyle = 'rgba(20,15,11,0.9)';
  ctx.fillRect(insetX, insetY, insetW, insetH);
  ctx.strokeStyle = PHYS.glow + '0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(insetX + 0.5, insetY + 0.5, insetW, insetH);

  // Title
  ctx.fillStyle = PHYS.main;
  ctx.font = monoFont(9);
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
  ctx.strokeStyle = PHYS.main;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Mark optimal noise
  const optIdx = result.noiseLevels.indexOf(result.optimalNoise);
  if (optIdx >= 0) {
    const optX = insetX + padI + (optIdx / (snr.length - 1)) * plotIW;
    const optY = insetY + insetH - padI - (snr[optIdx] / (maxSNR || 1)) * plotIH;
    ctx.beginPath();
    ctx.arc(optX, optY, 3, 0, TAU);
    ctx.fillStyle = COLORS.mhz.main;
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

  const compact = isCompact(w);
  const insetW = compact ? w - 36 : 200, insetH = compact ? 84 : 100;
  const insetX = compact ? 18 : w - 20 - insetW;
  const insetY = h - (compact ? 14 : 20) - insetH;

  // Background
  ctx.fillStyle = 'rgba(20,15,11,0.9)';
  ctx.fillRect(insetX, insetY, insetW, insetH);
  ctx.strokeStyle = PHYS.glow + '0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(insetX + 0.5, insetY + 0.5, insetW, insetH);

  // Title
  ctx.fillStyle = PHYS.main;
  ctx.font = monoFont(9);
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
  ctx.strokeStyle = PHYS.main;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Mark actual MT angle (12 deg)
  const mtIdx = Math.round(12 / 0.5) - 1;
  if (mtIdx >= 0 && mtIdx < scores.length) {
    const mtX = insetX + padI + (mtIdx / (scores.length - 1)) * plotIW;
    const mtY = insetY + insetH - padI - (scores[mtIdx] / (maxScore || 1)) * plotIH;
    ctx.beginPath();
    ctx.arc(mtX, mtY, 4, 0, TAU);
    ctx.fillStyle = COLORS.cyan;
    ctx.fill();
    ctx.fillStyle = COLORS.cyan;
    ctx.font = monoFont(9, 700);
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
    ctx.fillStyle = COLORS.mhz.main;
    ctx.fill();
  }

  // Axis labels
  ctx.fillStyle = INK.muted;
  ctx.font = monoFont(9);
  ctx.textAlign = 'left';
  ctx.fillText('0', insetX + padI, insetY + insetH - 1);
  ctx.textAlign = 'right';
  ctx.fillText('45 deg', insetX + insetW - padI, insetY + insetH - 1);
}
