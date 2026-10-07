/* ===========================================================
   Microtubule Resonance Simulator — Physics Engine
   Real computational models: RK4, Monte Carlo, Berry phase,
   chiral mode analysis, stochastic resonance
   =========================================================== */

// ---- Shared Physics State ----
const PhysicsResults = {
  engine1: null, // Coupled oscillator time series
  engine2: null, // Stochastic resonance SNR curves
  engine3: null, // Phase coherence amplification
  engine4: null, // Chiral vs achiral resonance modes
  engine5: null, // Pitch angle sweep
  engine6: null, // Scale extension predictions
  engine7: null,  // H7 Monte Carlo null comparison (p-value)
  engine8: null,  // Sensitivity analysis
  engine9: null,  // Alternative structure comparison
  engine10: null, // Energy budget calculation
  computing: {},  // { engineN: true/false }
};

const PhysicsMode = {
  active: false,       // true = show computed results, false = visual-only
  noiseAmplitude: 0.5, // for stochastic resonance
  couplingStrength: 0.1,
  damping: 0.05,
  pitchAngle: 12,      // degrees
  showAchiral: false,
  showExtendedScale: false,
};

// ---- Seeded PRNG ----
// Every Monte Carlo in this file draws from PhysicsRNG, never Math.random(),
// so a run is reproducible: same seed, same figures, on any machine.
// mulberry32 (Tommy Ettinger, public domain): 32-bit state, period 2^32,
// passes gjrand; more than enough for 10,000-trial null distributions.
// Each engine entry point that samples calls PhysicsRNG.reseed() first, so
// the result never depends on what ran before it.
const DEFAULT_SEED = 20260906;

const PhysicsRNG = (() => {
  let state = DEFAULT_SEED >>> 0;
  return {
    DEFAULT_SEED,
    /** Set the generator state to an explicit 32-bit seed. */
    seed(n) { state = n >>> 0; },
    /** Reset to DEFAULT_SEED. Called at the start of every Monte Carlo. */
    reseed() { state = DEFAULT_SEED >>> 0; },
    /** Uniform float in [0, 1), same contract as Math.random(). */
    random() {
      state = (state + 0x6D2B79F5) | 0;
      let t = Math.imul(state ^ (state >>> 15), state | 1);
      t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
})();

// ---- Math Utilities ----
function gaussRandom() {
  // Box-Muller transform
  let u = 0, v = 0;
  while (u === 0) u = PhysicsRNG.random();
  while (v === 0) v = PhysicsRNG.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function complexMag(re, im) {
  return Math.sqrt(re * re + im * im);
}

/**
 * Find first significant peak in a signal (where amplitude exceeds threshold)
 * Returns the time at which signal first reaches 10% of its eventual max
 */
function findFirstSignificantPeak(signal, times) {
  // Find the overall max amplitude (excluding first 5% as startup)
  const startIdx = Math.floor(signal.length * 0.05);
  let maxAmp = 0;
  for (let i = startIdx; i < signal.length; i++) {
    maxAmp = Math.max(maxAmp, Math.abs(signal[i]));
  }
  if (maxAmp < 1e-15) return -1;

  // Find first time signal reaches 10% of max
  const threshold = maxAmp * 0.1;
  for (let i = startIdx; i < signal.length; i++) {
    if (Math.abs(signal[i]) > threshold) {
      return times[i];
    }
  }
  return -1;
}

// Reuse the triplet frequency generator from sim.js
function physicsGenerateTripletFrequencies(baseHz) {
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
        amplitude: 0.4 + (j === 1 ? 0.6 : 0.2) + (i === 1 ? 0.15 : 0),
      });
    }
  }
  return peaks;
}

// All 36 peaks across 4 scales
const PHYSICS_SCALE_BASES = [1, 1e3, 1e6, 1e9];
const PHYSICS_ALL_PEAKS = [];
for (let s = 0; s < 4; s++) {
  const peaks = physicsGenerateTripletFrequencies(PHYSICS_SCALE_BASES[s]);
  peaks.forEach(p => { p.scale = s; PHYSICS_ALL_PEAKS.push(p); });
}


/* ===========================================================
   ENGINE 1: Coupled Oscillator (RK4)
   Models filament (MHz) ↔ membrane (kHz) coupling
   =========================================================== */
const Engine1 = {
  // State vector: [x_fast, v_fast, x_slow, v_slow]
  defaults: {
    omegaFast: 2 * Math.PI * 1e6,  // 1 MHz filament
    omegaSlow: 2 * Math.PI * 1e3,  // 1 kHz membrane
    gammaFast: 0.1,   // damping ratio → Q ≈ 5 for fast oscillator
    gammaSlow: 0.05,  // damping ratio → Q ≈ 10 for slow oscillator
    coupling: 0.2,    // moderate coupling
    driveAmplitude: 1.0,
    driveFreq: 2 * Math.PI * 1e6,  // drive at filament frequency
  },

  // Derivatives function for coupled oscillator
  // Asymmetric coupling: filament drives membrane (forward), weak back-coupling
  deriv(state, t, params) {
    const [xf, vf, xs, vs] = state;
    const { omegaFast, omegaSlow, gammaFast, gammaSlow, coupling, driveAmplitude, driveFreq } = params;

    // External drive on fast oscillator
    const Fdrive = driveAmplitude * Math.sin(driveFreq * t);

    // Forward coupling (fast→slow): strong — filament drives membrane
    const forwardCoupling = coupling;
    // Back-coupling (slow→fast): very weak — membrane barely affects filament
    const backwardCoupling = coupling * 0.01;

    return [
      vf,
      -omegaFast * omegaFast * xf - gammaFast * omegaFast * vf + backwardCoupling * omegaFast * xs + Fdrive,
      vs,
      -omegaSlow * omegaSlow * xs - gammaSlow * omegaSlow * vs + forwardCoupling * omegaSlow * xf,
    ];
  },

  // 4th-order Runge-Kutta step
  rk4Step(state, t, dt, params) {
    const k1 = this.deriv(state, t, params);
    const s2 = state.map((s, i) => s + 0.5 * dt * k1[i]);
    const k2 = this.deriv(s2, t + 0.5 * dt, params);
    const s3 = state.map((s, i) => s + 0.5 * dt * k2[i]);
    const k3 = this.deriv(s3, t + 0.5 * dt, params);
    const s4 = state.map((s, i) => s + dt * k3[i]);
    const k4 = this.deriv(s4, t + dt, params);

    return state.map((s, i) =>
      s + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])
    );
  },

  /**
   * Run coupled oscillator simulation
   * @param {Object} opts - coupling, damping, duration, etc.
   * @returns {Object} - time series, phase lead, energy transfer
   */
  run(opts = {}) {
    const params = { ...this.defaults };

    // Apply user overrides (normalized)
    if (opts.coupling !== undefined) params.coupling = opts.coupling;
    if (opts.damping !== undefined) {
      params.gammaFast = opts.damping;
      params.gammaSlow = opts.damping * 0.4; // membrane damps slower
    }

    // We simulate in NORMALIZED time to keep numbers manageable
    // Scale: 1 time unit = 1 microsecond
    const omegaFastNorm = 2 * Math.PI * 1.0;   // 1 cycle per us = 1 MHz
    const omegaSlowNorm = 2 * Math.PI * 0.001;  // 1 cycle per ms = 1 kHz
    const driveFreqNorm = 2 * Math.PI * 1.0;

    // NOTE: gamma is the dimensionless damping ratio (zeta = gamma/2).
    // The deriv function multiplies by omega: -gamma * omega * v
    // So we do NOT pre-multiply by omega here (that would double-count).
    const normParams = {
      omegaFast: omegaFastNorm,
      omegaSlow: omegaSlowNorm,
      gammaFast: params.gammaFast,       // dimensionless damping ratio
      gammaSlow: params.gammaSlow,       // dimensionless damping ratio
      coupling: params.coupling,
      driveAmplitude: params.driveAmplitude,
      driveFreq: driveFreqNorm,
    };

    // Simulation parameters
    const duration = opts.duration || 2000; // microseconds (= 2 ms)
    const dt = 0.05;                         // 0.05 us timestep
    const nSteps = Math.floor(duration / dt);
    // Keep at most one sample per 0.2 us: 5 samples per 1 us period of the fast oscillator,
    // inside Nyquist (spacing < 0.5 us). The old "~2000 points" rule stored one sample per
    // 1-1.5 us, which aliased the 1 MHz oscillation to a constant or alternating phases.
    const downsample = Math.max(1, Math.min(Math.floor(nSteps / 2000), Math.round(0.2 / dt)));

    let state = [0, 0.01, 0, 0]; // slight perturbation on fast oscillator
    let t = 0;

    const timeSeries = { t: [], xFast: [], xSlow: [], vFast: [], vSlow: [] };

    for (let i = 0; i < nSteps; i++) {
      state = this.rk4Step(state, t, dt, normParams);
      t += dt;

      if (i % downsample === 0) {
        timeSeries.t.push(t);
        timeSeries.xFast.push(state[0]);
        timeSeries.xSlow.push(state[2]);
        timeSeries.vFast.push(state[1]);
        timeSeries.vSlow.push(state[3]);
      }
    }

    // Compute phase lead: find first major peak in each signal
    const phaseLead = this.computePhaseLead(timeSeries);

    // Energy transfer analysis
    const energyTransfer = this.computeEnergyTransfer(timeSeries, normParams);

    return {
      timeSeries,
      phaseLead,
      energyTransfer,
      params: normParams,
    };
  },

  computePhaseLead(ts) {
    // Find first significant peak in fast and slow signals (after transient)
    const startIdx = Math.floor(ts.t.length * 0.3); // skip initial transient
    let fastPeakIdx = -1, slowPeakIdx = -1;
    const fastThreshold = Math.max(...ts.xFast.slice(startIdx)) * 0.5;
    const slowThreshold = Math.max(...ts.xSlow.slice(startIdx).map(Math.abs)) * 0.5;

    // Find envelope peaks
    for (let i = startIdx + 1; i < ts.t.length - 1; i++) {
      if (fastPeakIdx === -1 && ts.xFast[i] > fastThreshold &&
          ts.xFast[i] > ts.xFast[i - 1] && ts.xFast[i] > ts.xFast[i + 1]) {
        fastPeakIdx = i;
      }
      if (slowPeakIdx === -1 && Math.abs(ts.xSlow[i]) > slowThreshold &&
          Math.abs(ts.xSlow[i]) > Math.abs(ts.xSlow[i - 1]) &&
          Math.abs(ts.xSlow[i]) > Math.abs(ts.xSlow[i + 1])) {
        slowPeakIdx = i;
      }
    }

    if (fastPeakIdx > 0 && slowPeakIdx > 0) {
      const leadTime = ts.t[slowPeakIdx] - ts.t[fastPeakIdx]; // positive = fast leads
      return { leadTime_us: leadTime, fastPeakTime: ts.t[fastPeakIdx], slowPeakTime: ts.t[slowPeakIdx] };
    }
    return { leadTime_us: 0, fastPeakTime: 0, slowPeakTime: 0 };
  },

  computeEnergyTransfer(ts, params) {
    // Energy in each oscillator over time
    const startIdx = Math.floor(ts.t.length * 0.3);
    let totalFast = 0, totalSlow = 0;
    const n = ts.t.length - startIdx;

    for (let i = startIdx; i < ts.t.length; i++) {
      const keFast = 0.5 * ts.vFast[i] * ts.vFast[i];
      const peFast = 0.5 * params.omegaFast * params.omegaFast * ts.xFast[i] * ts.xFast[i];
      const keSlow = 0.5 * ts.vSlow[i] * ts.vSlow[i];
      const peSlow = 0.5 * params.omegaSlow * params.omegaSlow * ts.xSlow[i] * ts.xSlow[i];
      totalFast += keFast + peFast;
      totalSlow += keSlow + peSlow;
    }

    return {
      avgEnergyFast: totalFast / n,
      avgEnergySlow: totalSlow / n,
      transferRatio: totalSlow / (totalFast + 1e-20),
    };
  },
};


/* ===========================================================
   ENGINE 2: Stochastic Resonance
   Bistable potential + noise across 36 resonant modes
   =========================================================== */
const Engine2 = {
  /**
   * Run stochastic resonance analysis
   * @param {Object} opts - noiseLevels, nTrials, signalAmplitude
   * @returns {Object} - SNR curves per mode, optimal noise
   */
  run(opts = {}) {
    PhysicsRNG.reseed();
    const noiseLevels = opts.noiseLevels || 16;
    const nTrials = opts.nTrials || 500;  // reduced from 5000 for browser perf
    const signalAmp = opts.signalAmplitude ?? 0.3;
    const duration = opts.duration || 100; // normalized time units
    const dt = 0.01;
    const nSteps = Math.floor(duration / dt);

    // Every scale band normalises to the same three relative frequencies within a triplet
    // (0.7, 1.0, 1.4), so those three are the distinct drives. (The old list [0, 9, 18, 27]
    // picked sub-peak 0 of each scale, i.e. the same 0.7 four times.)
    const modeFreqs = [0.7, 1.0, 1.4];

    const noiseRange = [];
    for (let i = 0; i < noiseLevels; i++) {
      noiseRange.push(0.01 + (i / (noiseLevels - 1)) * 4.0); // range 0.01 to 4.01
    }

    const results = {
      noiseLevels: noiseRange,
      snrByMode: [], // [modeIdx][noiseIdx]
      meanSNR: [],   // [noiseIdx] averaged across modes
      optimalNoise: 0,
      peakSNR: 0,
    };

    for (let m = 0; m < modeFreqs.length; m++) {
      const omega = 2 * Math.PI * modeFreqs[m];
      const snrCurve = [];

      for (let ni = 0; ni < noiseLevels; ni++) {
        const D = noiseRange[ni];
        let totalSNR = 0;

        for (let trial = 0; trial < nTrials; trial++) {
          let x = 0.01 * (PhysicsRNG.random() - 0.5); // near zero
          const sums = this.newFitSums();
          const sqrtDt = Math.sqrt(dt);

          for (let step = 0; step < nSteps; step++) {
            const t = step * dt;
            const signal = signalAmp * Math.cos(omega * t);
            const drift = x - x * x * x + signal;
            const diffusion = D * gaussRandom() * sqrtDt;
            x += drift * dt + diffusion;

            // Measure at the signal frequency (in-phase and quadrature), skipping the transient
            if (step > nSteps * 0.3) this.addFitSample(sums, x, omega * (t + dt));
          }

          totalSNR += this.coherentSNR(sums);
        }

        snrCurve.push(Math.max(0, totalSNR / nTrials));
      }

      results.snrByMode.push(snrCurve);
    }

    // Compute mean SNR across modes
    for (let ni = 0; ni < noiseLevels; ni++) {
      let sum = 0;
      for (let m = 0; m < modeFreqs.length; m++) {
        sum += results.snrByMode[m][ni];
      }
      results.meanSNR.push(sum / modeFreqs.length);
    }

    // Find optimal noise
    let maxSNR = 0, maxIdx = 0;
    for (let ni = 0; ni < noiseLevels; ni++) {
      if (results.meanSNR[ni] > maxSNR) {
        maxSNR = results.meanSNR[ni];
        maxIdx = ni;
      }
    }
    results.optimalNoise = noiseRange[maxIdx];
    results.peakSNR = maxSNR;

    return results;
  },

  // ---- Fair stochastic-resonance test (two-state output, Kramers time-scale matching) ----
  //
  // For dx = (x - x^3 + A cos wt) dt + D dW, the barrier is dV = 1/4 and the noise intensity
  // (diffusion coefficient) is D^2/2. Kramers' escape rate out of one well is
  //   r_K(D) = (sqrt(2) / 2pi) exp(-dV / (D^2/2)) = (sqrt(2) / 2pi) exp(-1 / (2 D^2)).
  // Stochastic resonance peaks near time-scale matching, two escapes per drive period:
  //   r_K(D*) = w / pi  (McNamara & Wiesenfeld 1989; Gammaitoni et al. 1998).
  // Within this weak-noise approximation r_K never exceeds sqrt(2)/2pi ~ 0.225, so for a drive with
  // w/pi above that the matching condition has no solution. That is a statement about the Kramers
  // approximation and the matching heuristic, not a bound on the SDE's actual hopping rate at large D.

  /** Kramers escape rate for noise amplitude D. */
  kramersRate(D) {
    return (Math.SQRT2 / (2 * Math.PI)) * Math.exp(-1 / (2 * D * D));
  },

  /** Noise amplitude D* where r_K(D*) = w/pi for drive frequency f, or null if no D can reach it. */
  matchedNoise(freq) {
    const target = (2 * freq) / ((Math.SQRT2 / (2 * Math.PI))); // (w/pi) / prefactor
    if (!(target > 0 && target < 1)) return null;
    return Math.sqrt(1 / (2 * Math.log(1 / target)));
  },

  /**
   * Coherent fundamental-to-residual power ratio of the two-state output sign(x) at the drive
   * frequency (not the spectral SNR at that frequency, which uses the local noise floor; switching
   * noise is coloured, so the two can differ). The two-state output is the usual SR observable:
   * it counts well-to-well hops, not the in-well wobble. Trials start in a random well.
   * @param {Object} opts - freqs (array), noiseLevels (array), signalAmplitude, nTrials, periods, dt
   */
  runTwoState(opts = {}) {
    PhysicsRNG.reseed();
    const freqs = opts.freqs ?? [0.7, 1.0, 1.4];
    const noiseLevels = opts.noiseLevels ?? [0.2, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6, 0.7, 0.85, 1.0, 1.3, 1.7];
    const A = opts.signalAmplitude ?? 0.3;
    const nTrials = opts.nTrials || 40;
    const periods = opts.periods || 20;
    const dt = opts.dt || 0.05;
    const sqrtDt = Math.sqrt(dt);
    const snrByFreq = [];
    for (const f of freqs) {
      const w = 2 * Math.PI * f;
      // At least 2000 steps so fast drives still get many periods; skip the first 10% as transient.
      const nSteps = Math.max(2000, Math.floor(periods / f / dt));
      const curve = [];
      for (const D of noiseLevels) {
        let total = 0;
        for (let k = 0; k < nTrials; k++) {
          let x = PhysicsRNG.random() < 0.5 ? -1 : 1;
          const S = this.newFitSums();
          for (let i = 0; i < nSteps; i++) {
            const t = i * dt;
            x += (x - x * x * x + A * Math.cos(w * t)) * dt + D * gaussRandom() * sqrtDt;
            if (i > nSteps * 0.1) this.addFitSample(S, x > 0 ? 1 : -1, w * (t + dt));
          }
          total += this.coherentSNR(S);
        }
        curve.push(total / nTrials);
      }
      snrByFreq.push(curve);
    }
    const meanSNR = noiseLevels.map((_, j) => snrByFreq.reduce((s, c) => s + c[j], 0) / freqs.length);
    const peakIdx = meanSNR.indexOf(Math.max(...meanSNR));
    return { freqs, noiseLevels, snrByFreq, meanSNR, peakSNR: meanSNR[peakIdx], optimalNoise: noiseLevels[peakIdx] };
  },

  /** Running sums for a least-squares fit of x(t) = b0 + b1 cos(wt) + b2 sin(wt). */
  newFitSums() {
    return { n: 0, c: 0, s: 0, cc: 0, ss: 0, cs: 0, x: 0, xc: 0, xs: 0, xx: 0 };
  },

  addFitSample(S, x, phase) {
    const c = Math.cos(phase), s = Math.sin(phase);
    S.n++; S.c += c; S.s += s; S.cc += c * c; S.ss += s * s; S.cs += c * s;
    S.x += x; S.xc += x * c; S.xs += x * s; S.xx += x * x;
  },

  /**
   * SNR of the component of x(t) at the drive frequency, from a least-squares fit of an offset,
   * a cosine and a sine on the actual samples. Signal = mean power of the fitted sinusoid;
   * noise = mean squared residual. Exact on any window (whole periods or not), never negative,
   * and it counts the quadrature (sine) part too. (The old estimate used <x cos wt>^2: half the
   * in-phase power on whole periods, wrong on partial ones, and blind to the sine component.)
   */
  coherentSNR(S) {
    const n = S.n;
    if (n < 3) return 0;
    // Centre everything on the window means (this is the offset term of the fit), which keeps
    // the arithmetic stable and makes signal + residual = variance of x exactly.
    const mx = S.x / n, mc = S.c / n, ms = S.s / n;
    const vx = S.xx / n - mx * mx;
    const vcc = S.cc / n - mc * mc, vss = S.ss / n - ms * ms, vcs = S.cs / n - mc * ms;
    const cxc = S.xc / n - mx * mc, cxs = S.xs / n - mx * ms;
    const scale = S.xx / n;
    if (!(vx > 1e-12 * scale) || vx <= 0) return 0; // x is constant on this window: no signal
    const det = vcc * vss - vcs * vcs;
    if (!(det > 1e-12 * Math.max(vcc * vss, 1e-300))) return 0; // window too short to resolve w
    const b1 = (cxc * vss - cxs * vcs) / det;
    const b2 = (cxs * vcc - cxc * vcs) / det;
    const signal = Math.max(0, b1 * cxc + b2 * cxs); // variance explained by the fitted sinusoid
    const residual = vx - signal;
    if (signal <= 1e-12 * vx) return 0;
    if (residual <= 1e-12 * vx) return Infinity; // x is a pure sinusoid at w: no noise at all
    return signal / residual;
  },

  /**
   * Quick single-noise-level computation (for per-frame use)
   */
  quickSample(noiseLevel, signalAmp = 0.3) {
    const dt = 0.01;
    const nSteps = 500;
    let x = 0.01;
    const omega = 2 * Math.PI;
    const sqrtDt = Math.sqrt(dt);
    let power = 0;

    for (let step = 0; step < nSteps; step++) {
      const t = step * dt;
      const signal = signalAmp * Math.cos(omega * t);
      const drift = x - x * x * x + signal;
      const diffusion = noiseLevel * gaussRandom() * sqrtDt;
      x += drift * dt + diffusion;
      if (step > 200) power += x * Math.cos(omega * t);
    }

    return Math.abs(power / 300);
  },
};


/* ===========================================================
   ENGINE 3: Phase Coherence (Berry Phase Monte Carlo)
   Tests coherent (N) vs random (sqrt(N)) amplification
   =========================================================== */
const Engine3 = {
  /**
   * Run phase coherence analysis
   * @param {Object} opts - nModes, nTrials
   * @returns {Object} - amplification curves, histogram
   */
  run(opts = {}) {
    PhysicsRNG.reseed();
    const maxModes = opts.maxModes || 36;
    const nTrials = opts.nTrials || 10000;

    const results = {
      nModes: [],          // [1, 2, ..., maxModes]
      coherentAmp: [],     // amplification at each N
      randomAmpMean: [],   // mean random amplification at each N
      randomAmpStd: [],    // std dev of random amplification
      histogram: null,     // histogram at N=36
      ratio: 0,            // coherent/random at N=36
    };

    // Berry phases from Bandyopadhyay's fractal resonance model:
    //
    // Key physics: the fractal structure is NESTED (tube-in-tube), not a flat sum.
    // Each scale level acts as a chiral boundary (like CISS layers).
    // Bandyopadhyay's phase relationship: π/4 between adjacent resonance levels.
    //
    // Model: 4 scales × 3 triplets × 3 sub-peaks = 36 modes
    //   - Across scales: each scale adds π/4 (from Bandyopadhyay's measured phase)
    //   - Within a triplet: sub-peaks are sub-harmonics, so phases are similar
    //     but NOT identical (slight spread from frequency differences)
    //   - Between triplets within a scale: phases differ by Berry phase per ring
    //     = 13 * π*(1-cos(12°)) ≈ 0.893 rad (NOT 2π/3, which would cancel)
    //
    // This gives constructive buildup because π/4 * 4 scales = π total,
    // so phases cluster in one hemisphere rather than canceling symmetrically.
    const berryPhasePerTurn = Math.PI * (1 - Math.cos(12 * Math.PI / 180)); // ~0.069 rad
    const nProto = 13;
    const phasePerRing = nProto * berryPhasePerTurn; // ~0.893 rad (not a rational fraction of 2π)
    const phasePerScale = Math.PI / 4; // Bandyopadhyay's measured inter-scale phase

    const berryPhases = [];
    for (let scale = 0; scale < 4; scale++) {
      const scalePhase = scale * phasePerScale; // 0, π/4, π/2, 3π/4
      for (let triplet = 0; triplet < 3; triplet++) {
        // Triplets within a scale: offset by Berry phase per ring (~0.893 rad)
        // This is irrational w.r.t. 2π, so it DOESN'T create exact cancellation
        const tripletPhase = triplet * phasePerRing;
        for (let sub = 0; sub < 3; sub++) {
          // Sub-peaks: tiny spread from frequency variation within the triplet
          const subPhase = (sub - 1) * berryPhasePerTurn * 0.5;
          berryPhases.push(scalePhase + tripletPhase + subPhase);
        }
      }
    }

    for (let N = 1; N <= maxModes; N++) {
      results.nModes.push(N);

      // Coherent sum: deterministic phases
      let reCoherent = 0, imCoherent = 0;
      for (let i = 0; i < N; i++) {
        reCoherent += Math.cos(berryPhases[i]);
        imCoherent += Math.sin(berryPhases[i]);
      }
      const coherentMag = complexMag(reCoherent, imCoherent);
      results.coherentAmp.push(coherentMag);

      // Random sum: Monte Carlo
      const randomMags = [];
      for (let trial = 0; trial < nTrials; trial++) {
        let reRand = 0, imRand = 0;
        for (let i = 0; i < N; i++) {
          const phi = PhysicsRNG.random() * 2 * Math.PI;
          reRand += Math.cos(phi);
          imRand += Math.sin(phi);
        }
        randomMags.push(complexMag(reRand, imRand));
      }

      const meanRand = randomMags.reduce((a, b) => a + b, 0) / nTrials;
      const variance = randomMags.reduce((a, b) => a + (b - meanRand) ** 2, 0) / nTrials;
      results.randomAmpMean.push(meanRand);
      results.randomAmpStd.push(Math.sqrt(variance));

      // Save histogram at N=36
      if (N === maxModes) {
        const nBins = 50;
        const maxVal = Math.max(...randomMags) * 1.1;
        const bins = new Array(nBins).fill(0);
        const binWidth = maxVal / nBins;
        for (const mag of randomMags) {
          const bin = Math.min(nBins - 1, Math.floor(mag / binWidth));
          bins[bin]++;
        }
        results.histogram = {
          bins,
          binWidth,
          maxVal,
          coherentValue: coherentMag,
        };
      }
    }

    // Compute ratio at max modes
    results.ratio = results.coherentAmp[maxModes - 1] / results.randomAmpMean[maxModes - 1];

    return results;
  },
};


/* ===========================================================
   ENGINE 4: Chiral Resonance Comparator
   Cylindrical standing wave modes: chiral vs achiral
   =========================================================== */
const Engine4 = {
  // Physical constants (normalized)
  MT_RADIUS: 12.5e-9,    // 12.5 nm
  MT_LENGTH: 200e-9,     // 200 nm
  C_MEDIUM: 0.1 * 3e8,   // ~10% speed of light in protein medium

  /**
   * Compute resonant modes for a cylindrical waveguide
   * @param {number} pitchAngle - helical pitch in degrees (0 = achiral)
   * @param {Object} opts
   * @returns {Object} - mode frequencies, clustering analysis
   */
  computeModes(pitchAngle = 0, opts = {}) {
    const R = opts.radius || this.MT_RADIUS;
    const L = opts.length || this.MT_LENGTH;
    const c = opts.speed || this.C_MEDIUM;
    const maxM = opts.maxM || 6;
    const maxN = opts.maxN || 12;
    const alpha = pitchAngle * Math.PI / 180;

    const modes = [];

    // n runs over all integers -maxN..maxN: on a closed cylinder +n and -n are the two
    // senses of rotation. Achirally they are degenerate pairs; the helical shift
    // n -> n + m tan(alpha) is what splits them, so H2 needs both.
    for (let m = 1; m <= maxM; m++) {
      for (let n = -maxN; n <= maxN; n++) {
        const axial = (m * Math.PI / L);
        let azimuthal;

        if (opts.shifts) {
          // Null control: an azimuthal shift per m with no helical structure (see Engine4.run)
          azimuthal = (n + opts.shifts[m - 1]) / R;
        } else if (pitchAngle === 0) {
          // Achiral: standard cylinder
          azimuthal = n / R;
        } else {
          // Chiral: helical coupling shifts azimuthal modes
          azimuthal = (n + m * Math.tan(alpha)) / R;
        }

        const freq = (c / (2 * Math.PI)) * Math.sqrt(axial * axial + azimuthal * azimuthal);
        modes.push({ m, n, freq, logFreq: Math.log10(freq) });
      }
    }

    // Sort by frequency
    modes.sort((a, b) => a.freq - b.freq);

    return modes;
  },

  /**
   * Analyze clustering: do modes form triplets?
   */
  analyzeClustering(allModes) {
    // Degeneracy-aware: modes at the same frequency (the achiral +n/-n pairs) are one resonance,
    // not two. Counting them twice would let the gap heuristic merge a pair plus a neighbour into
    // a "triplet" for any geometry that splits pairs, chiral or not.
    const modes = [];
    for (const md of allModes) {
      const prev = modes[modes.length - 1];
      if (prev && Math.abs(md.logFreq - prev.logFreq) < 1e-12) prev.degeneracy = (prev.degeneracy || 1) + 1;
      else modes.push({ ...md });
    }
    if (modes.length < 3) return { clusterScore: 0, tripletCount: 0, totalClusters: 0, sizeDistribution: {}, clusters: [] };

    // Compute nearest-neighbor distances in log-frequency space
    const logFreqs = modes.map(m => m.logFreq);
    const gaps = [];
    for (let i = 1; i < logFreqs.length; i++) {
      gaps.push(logFreqs[i] - logFreqs[i - 1]);
    }

    // Find natural clustering using gap statistics
    // Use median gap (more robust than mean for skewed distributions)
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];
    const clusters = [];
    let currentCluster = [modes[0]];

    for (let i = 1; i < modes.length; i++) {
      if (gaps[i - 1] < medianGap * 0.7) {
        // Close enough → same cluster
        currentCluster.push(modes[i]);
      } else {
        clusters.push(currentCluster);
        currentCluster = [modes[i]];
      }
    }
    clusters.push(currentCluster);

    // Count clusters of size 3 (triplets)
    const tripletClusters = clusters.filter(c => c.length === 3).length;
    const totalClusters = clusters.length;
    const clusterScore = tripletClusters / Math.max(1, totalClusters);

    // Compute cluster size distribution
    const sizeDistribution = {};
    clusters.forEach(c => {
      sizeDistribution[c.length] = (sizeDistribution[c.length] || 0) + 1;
    });

    return {
      clusterScore,      // 0-1, fraction that are triplets
      tripletCount: tripletClusters,
      totalClusters,
      sizeDistribution,
      clusters,
    };
  },

  /**
   * Full comparison: chiral vs achiral
   */
  run(opts = {}) {
    PhysicsRNG.reseed();
    const pitchAngle = opts.pitchAngle ?? 12; // 3-start helix
    const nullDraws = opts.nullDraws ?? 100;
    const maxM = opts.maxM || 6;

    const achiralModes = this.computeModes(0, opts);
    const chiralModes = this.computeModes(pitchAngle, opts);

    const achiralClustering = this.analyzeClustering(achiralModes);
    const chiralClustering = this.analyzeClustering(chiralModes);

    // Matched null: split the +n/-n pairs by the same range of shifts as the helix
    // (0 .. maxM tan(alpha)), but drawn at random per m instead of growing as m tan(alpha).
    // If the helix's triplet count is no higher than this, the triplets come from splitting
    // degeneracies in general, not from chirality.
    const maxShift = maxM * Math.tan(pitchAngle * Math.PI / 180);
    const nullTriplets = [];
    for (let d = 0; d < nullDraws; d++) {
      const shifts = Array.from({ length: maxM }, () => PhysicsRNG.random() * maxShift);
      nullTriplets.push(this.analyzeClustering(this.computeModes(pitchAngle, { ...opts, shifts })).tripletCount);
    }
    nullTriplets.sort((a, b) => a - b);
    const nullP95 = nullDraws > 0 ? nullTriplets[Math.min(nullDraws - 1, Math.floor(0.95 * nullDraws))] : null;

    return {
      null: nullDraws > 0 ? { draws: nullDraws, p95: nullP95, median: nullTriplets[Math.floor(nullDraws / 2)] } : null,
      achiral: {
        modes: achiralModes,
        clustering: achiralClustering,
      },
      chiral: {
        modes: chiralModes,
        clustering: chiralClustering,
        pitchAngle,
      },
      tripletAdvantage: chiralClustering.clusterScore - achiralClustering.clusterScore,
    };
  },
};


/* ===========================================================
   ENGINE 5: Pitch Angle Sweep
   Berry phase resonance condition vs helix pitch
   =========================================================== */
const Engine5 = {
  /**
   * Sweep pitch angle and compute coupling efficiency
   * Ported from kozyrev-mirror/v4/geometric_scaling.py
   * @param {Object} opts
   * @returns {Object} - angles, efficiency curve, resonance peaks
   */
  run(opts = {}) {
    const nProto = opts.nProtofilaments || 13;
    const angleStep = opts.angleStep || 0.5; // degrees
    const maxAngle = opts.maxAngle || 45;
    // Coherence falloff in protein structures is steep — helical waveguide
    // loses phase coherence rapidly above ~15-20 degrees
    const alphaCritical = opts.alphaCritical || 15; // degrees — steeper falloff for realism

    const angles = [];
    const berryPhase = [];
    const couplingEfficiency = [];
    const resonanceCondition = [];

    for (let deg = 0.5; deg <= maxAngle; deg += angleStep) {
      const alpha = deg * Math.PI / 180;
      const alphaC = alphaCritical * Math.PI / 180;

      angles.push(deg);

      // Berry phase per turn: pi * (1 - cos(alpha))
      const phi = Math.PI * (1 - Math.cos(alpha));
      berryPhase.push(phi);

      // Coupling efficiency for helical waveguide:
      // sin(2*alpha) gives the geometric coupling (field alignment with helix)
      // exp(-alpha^2 / (2*alphaC^2)) Gaussian falloff for coherence loss
      // This peaks at smaller angles than pure sin(2*alpha)
      const eta = Math.abs(Math.sin(2 * alpha)) * Math.exp(-(alpha * alpha) / (2 * alphaC * alphaC));
      couplingEfficiency.push(eta);

      // Resonance condition: N * phi = 2*pi*k for integer k
      // How close is N*phi to an integer multiple of 2*pi?
      const totalPhase = nProto * phi;
      const nearestK = Math.round(totalPhase / (2 * Math.PI));
      const residual = Math.abs(totalPhase - nearestK * 2 * Math.PI);
      // Sharper resonance condition (higher Q factor for biological structures)
      const resonanceStrength = Math.exp(-residual * residual * 25);
      resonanceCondition.push(resonanceStrength);
    }

    // Combined score: coupling * resonance
    const combinedScore = couplingEfficiency.map((eta, i) =>
      eta * resonanceCondition[i]
    );

    // Find peak
    let peakIdx = 0, peakVal = 0;
    for (let i = 0; i < combinedScore.length; i++) {
      if (combinedScore[i] > peakVal) {
        peakVal = combinedScore[i];
        peakIdx = i;
      }
    }

    return {
      angles,
      berryPhase,
      couplingEfficiency,
      resonanceCondition,
      combinedScore,
      peakAngle: angles[peakIdx],
      peakScore: peakVal,
      actualMTAngle: 12, // known microtubule 3-start pitch
    };
  },
};


/* ===========================================================
   ENGINE 6: Scale Extension
   Extrapolate fractal pattern to sub-Hz and THz
   =========================================================== */
const Engine6 = {
  // Known reference frequencies
  SCHUMANN_HARMONICS: [7.83, 14.3, 20.8, 27.3, 33.8],
  THERMAL_DRIVER: [5e12, 6e12], // 5-6 THz

  /**
   * Generate predicted peaks at extended scales
   * @param {Object} opts
   * @returns {Object} - predictions, matches, confidence
   */
  run(opts = {}) {
    // Threshold on |log10(predicted / observed)|. 0.05 in log10 is a factor of 10^0.05 = 1.122,
    // i.e. within about 12% in frequency, not 5%.
    const matchThreshold = opts.matchThreshold ?? 0.05;

    // Extend to sub-Hz (mHz band)
    const subHzPeaks = physicsGenerateTripletFrequencies(0.001); // mHz
    // Existing Hz band already predicted — check against Schumann
    const hzPeaks = physicsGenerateTripletFrequencies(1); // Hz band (already in sim)

    // Extend to THz
    const thzPeaks = physicsGenerateTripletFrequencies(1e12); // THz band

    // Also check sub-Hz (0.01 Hz band) and deca-Hz (0.1 Hz band)
    const subHz2Peaks = physicsGenerateTripletFrequencies(0.01);
    const subHz3Peaks = physicsGenerateTripletFrequencies(0.1);

    // Check Schumann matches against Hz predictions
    const schumannMatches = [];
    const allHzPredictions = [...subHzPeaks, ...subHz2Peaks, ...subHz3Peaks, ...hzPeaks];

    for (const schumann of this.SCHUMANN_HARMONICS) {
      let bestMatch = null;
      let bestDist = Infinity;

      for (const pred of allHzPredictions) {
        const dist = Math.abs(Math.log10(pred.freq) - Math.log10(schumann));
        if (dist < bestDist) {
          bestDist = dist;
          bestMatch = pred;
        }
      }

      schumannMatches.push({
        schumannFreq: schumann,
        nearestPredicted: bestMatch ? bestMatch.freq : null,
        logDistance: bestDist,
        isMatch: bestDist < matchThreshold,
        freqErrorPercent: bestMatch ? Math.abs(bestMatch.freq / schumann - 1) * 100 : null,
      });
    }

    // Check THz predictions against thermal driver
    const thermalMatches = [];
    const thermalCenter = 5.5e12; // midpoint of 5-6 THz range

    for (const pred of thzPeaks) {
      const dist = Math.abs(Math.log10(pred.freq) - Math.log10(thermalCenter));
      if (dist < 0.3) { // within factor of 2
        thermalMatches.push({
          predictedFreq: pred.freq,
          logDistance: dist,
          isMatch: dist < matchThreshold,
        });
      }
    }

    // Compute overall match score
    const schumannMatchCount = schumannMatches.filter(m => m.isMatch).length;
    const thermalMatchCount = thermalMatches.filter(m => m.isMatch).length;

    return {
      subHzPeaks,
      subHz2Peaks,
      subHz3Peaks,
      hzPeaks,
      thzPeaks,
      schumannMatches,
      thermalMatches,
      schumannMatchFraction: schumannMatchCount / this.SCHUMANN_HARMONICS.length,
      thermalMatchFound: thermalMatchCount > 0,
      allExtendedPeaks: [...subHzPeaks, ...subHz2Peaks, ...subHz3Peaks, ...thzPeaks],
      matchThreshold,
      matchThresholdPercent: (Math.pow(10, matchThreshold) - 1) * 100,
    };
  },
};


/* ===========================================================
   ENGINE 7: Monte Carlo Null Comparison for Schumann Matches
   Tests: how likely is 4/5 Schumann overlap by CHANCE?
   =========================================================== */
const Engine7 = {
  SCHUMANN_HARMONICS: [7.83, 14.3, 20.8, 27.3, 33.8],

  /**
   * Generate a random "fractal" triplet-of-triplet pattern
   * with randomized base frequencies and spacing ratios
   */
  generateRandomTriplets(baseHz) {
    // Randomize the main ratios (normally [2, 10, 30])
    // Keep them roughly in the same decade range but random
    const r1 = 1 + PhysicsRNG.random() * 5;       // 1-6
    const r2 = 5 + PhysicsRNG.random() * 15;      // 5-20
    const r3 = 15 + PhysicsRNG.random() * 35;     // 15-50
    const mainRatios = [r1, r2, r3];

    // Randomize sub-peak ratios (normally [0.7, 1.0, 1.4])
    const spread = 0.2 + PhysicsRNG.random() * 0.6; // 0.2-0.8 spread
    const subRatios = [1 - spread, 1.0, 1 + spread];

    const peaks = [];
    for (let i = 0; i < 3; i++) {
      const mainF = baseHz * mainRatios[i];
      for (let j = 0; j < 3; j++) {
        peaks.push({ freq: mainF * subRatios[j] });
      }
    }
    return peaks;
  },

  /**
   * Count Schumann matches for a given set of Hz-range predictions
   */
  countSchumannMatches(allPeaks, threshold = 0.05) {
    let matches = 0;
    for (const schumann of this.SCHUMANN_HARMONICS) {
      let bestDist = Infinity;
      for (const pred of allPeaks) {
        const dist = Math.abs(Math.log10(pred.freq) - Math.log10(schumann));
        if (dist < bestDist) bestDist = dist;
      }
      if (bestDist < threshold) matches++;
    }
    return matches;
  },

  /**
   * Run Monte Carlo null comparison
   * @param {Object} opts - nTrials, matchThreshold
   * @returns {Object} - p-value, distribution, observed count
   */
  run(opts = {}) {
    PhysicsRNG.reseed();
    const nTrials = opts.nTrials || 10000;
    const threshold = opts.matchThreshold ?? 0.05;

    // Step 1: Get the ACTUAL match count from our specific fractal pattern
    const actualResult = Engine6.run({ matchThreshold: threshold });
    const observedMatches = actualResult.schumannMatches.filter(m => m.isMatch).length;

    // Step 2: Generate random fractal patterns and count their matches
    const matchDistribution = new Array(6).fill(0); // 0 to 5 matches
    const matchCounts = [];

    for (let trial = 0; trial < nTrials; trial++) {
      // Random base frequency in the sub-Hz to Hz range
      // We use the same scale bases that our real model uses
      const randomBases = [
        0.001 * (0.5 + PhysicsRNG.random()),   // mHz-ish
        0.01 * (0.5 + PhysicsRNG.random()),    // 10 mHz-ish
        0.1 * (0.5 + PhysicsRNG.random()),     // 100 mHz-ish
        1 * (0.5 + PhysicsRNG.random()),       // Hz-ish
      ];

      // Generate random fractal peaks at each scale
      const allPeaks = [];
      for (const base of randomBases) {
        const peaks = this.generateRandomTriplets(base);
        allPeaks.push(...peaks);
      }

      const matches = this.countSchumannMatches(allPeaks, threshold);
      matchCounts.push(matches);
      matchDistribution[Math.min(5, matches)]++;
    }

    // Step 3: Compute p-value: fraction of random patterns that match
    // at least as many Schumann harmonics as our specific pattern
    const nAtLeastAsGood = matchCounts.filter(m => m >= observedMatches).length;
    const pValue = nAtLeastAsGood / nTrials;

    // Step 4: Compute mean and std of random match counts
    const meanMatches = matchCounts.reduce((a, b) => a + b, 0) / nTrials;
    const variance = matchCounts.reduce((a, b) => a + (b - meanMatches) ** 2, 0) / nTrials;
    const stdMatches = Math.sqrt(variance);

    return {
      observedMatches,
      pValue,
      nTrials,
      meanRandomMatches: meanMatches,
      stdRandomMatches: stdMatches,
      matchDistribution,
      percentile: ((1 - pValue) * 100),
      isSignificant: pValue < 0.05,
      threshold,
    };
  },
};


/* ===========================================================
   Hypothesis Auto-Test Runner
   =========================================================== */
const HypothesisRunner = {
  /**
   * Run computation for a specific hypothesis
   * @param {string} hypoId - 'H1' through 'H7'
   * @returns {Object} - result, verdict, metrics
   */
  async runTest(hypoId) {
    PhysicsRNG.reseed();
    switch (hypoId) {
      case 'H1': return this.testH1();
      case 'H2': return this.testH2();
      case 'H3': return this.testH3();
      case 'H4': return this.testH4();
      case 'H5': return this.testH5();
      case 'H6': return this.testH6();
      case 'H7': return this.testH7();
      default: return { verdict: 'error', message: 'Unknown hypothesis' };
    }
  },

  testH1() {
    // Fractal Coherent Amplification
    const result = Engine3.run({ maxModes: 36, nTrials: 10000 });
    PhysicsResults.engine3 = result;

    const coherent36 = result.coherentAmp[35];
    const random36 = result.randomAmpMean[35];
    const ratio = result.ratio;
    const sqrtN = Math.sqrt(36);

    // Verdict: "plausible" — fractal structure beats random, but we haven't
    // compared against OTHER ordered structures (regular lattice, hexagonal, etc.)
    // The real question isn't "does order beat randomness" (trivially yes),
    // but "does THIS specific order beat other plausible biological structures?"
    let verdict = 'inconclusive';
    if (ratio > 2.0 && coherent36 > sqrtN * 1.5) {
      verdict = 'plausible'; // Beats random, but null comparison incomplete
    } else if (ratio < 1.1) {
      verdict = 'falsified'; // No better than random
    }

    // Also report what fraction of maximum coherence we achieve
    const maxPossible = 36; // all phases aligned
    const coherenceEfficiency = (coherent36 / maxPossible * 100).toFixed(1);

    return {
      verdict,
      metrics: {
        'Coherent amplitude (36 modes)': coherent36.toFixed(2),
        'Random amplitude (mean)': random36.toFixed(2) + ' ± ' + result.randomAmpStd[35].toFixed(2),
        'Coherent/Random ratio': ratio.toFixed(2) + 'x',
        'sqrt(36) baseline': sqrtN.toFixed(2),
        'Max possible (perfect alignment)': maxPossible,
        'Coherence efficiency': coherenceEfficiency + '% of max',
        'Amplification above sqrt(N)': (coherent36 / sqrtN).toFixed(2) + 'x',
      },
      detail: `Helical Berry phases accumulate to ${coherent36.toFixed(1)}x coherent vs ${random36.toFixed(1)}x random (sqrt(36)=${sqrtN.toFixed(1)}). Ratio: ${ratio.toFixed(1)}x. Coherence efficiency: ${coherenceEfficiency}% of theoretical max.`,
    };
  },

  // ---- Verdict rules, shared with Engine8's sensitivity sweeps so the two never drift ----

  /**
   * H2 rule on one Engine4 run. "supported" needs the helix to beat both the untwisted tube and the
   * matched null (random splits of the same size; 95th percentile), so a triplet count that any
   * degeneracy splitting would produce cannot count as evidence for chirality.
   */
  verdictH2(result) {
    const advantage = result.tripletAdvantage;
    const chiralTriplets = result.chiral.clustering.tripletCount;
    const achiralTriplets = result.achiral.clustering.tripletCount;
    // No null, no support: without the matched control a triplet excess cannot be credited to chirality.
    const beatsNull = !!result.null && result.null.draws > 0 && chiralTriplets > result.null.p95;
    if (beatsNull && (advantage > 0.05 || (chiralTriplets > achiralTriplets && chiralTriplets >= 2))) return 'supported';
    if (advantage < -0.05 || (achiralTriplets > chiralTriplets * 1.5)) return 'falsified';
    return 'inconclusive';
  },

  /**
   * H3 rule. The metric is the triplet cluster score at 50 nm and 1000 nm. If either end is 0 the
   * ratio is 0 or unbounded and says nothing about boundary vs bulk, so the test cannot decide.
   */
  verdictH3(first, last, lengthRatio) {
    if (!(first > 0) || !(last > 0)) return 'inconclusive';
    const ratio = last / first;
    if (ratio < Math.sqrt(lengthRatio)) return 'consistent';
    if (ratio > lengthRatio * 0.5) return 'falsified';
    return 'inconclusive';
  },

  /**
   * H6 rule for the fair test.
   *  - The slow-drive control must show an interior peak within 50% of the Kramers-matched D*
   *    (an operational window, not a confidence interval). If not, the test is not sensitive:
   *    inconclusive.
   *  - Each native drive frequency is judged on its own: stochastic resonance there needs an
   *    interior peak in its curve AND a response at least 3x the no-signal (A = 0) baseline at the
   *    same noise, so finite-record bias cannot pass as signal.
   *  - Any native frequency passing: plausible. None: inconclusive ("not demonstrated"). A control
   *    at another frequency shows the method works; it does not prove the native response is
   *    absent, so this rule never returns "falsified".
   * @param {Object} native - runTwoState result with signal
   * @param {Object} nativeZero - the same run with signalAmplitude 0
   */
  verdictH6Fair(native, nativeZero, control, matchedD) {
    const controlOk = this.verdictH6(control.meanSNR) === 'plausible'
      && matchedD !== null && Math.abs(control.optimalNoise / matchedD - 1) <= 0.5;
    if (!controlOk) return 'inconclusive';
    return this.h6DetectedFreqs(native, nativeZero).length > 0 ? 'plausible' : 'inconclusive';
  },

  /** Native frequencies with an interior SNR peak and a response >= 3x the A = 0 baseline. */
  h6DetectedFreqs(native, nativeZero) {
    return native.freqs.filter((f, k) => {
      const s = native.snrByFreq[k], z = nativeZero.snrByFreq[k];
      const excess = Math.max(...s.map((v, j) => v / Math.max(z[j], 1e-12)));
      return this.verdictH6(s) === 'plausible' && excess >= 3;
    });
  },

  /**
   * H6 curve rule. Stochastic resonance means SNR rises with noise to an interior maximum and falls
   * after it. A curve still rising at the largest noise tested has no resonance peak in range.
   * @param {number[]} snr - mean SNR per noise level, in increasing noise order
   */
  verdictH6(snr) {
    let peakIdx = 0;
    for (let i = 1; i < snr.length; i++) if (snr[i] > snr[peakIdx]) peakIdx = i;
    const peak = snr[peakIdx], first = snr[0], last = snr[snr.length - 1];
    const interior = peakIdx > 0 && peakIdx < snr.length - 1;
    const hasPeak = interior && peak > first * 1.2 && peak > last * 1.1;
    if (hasPeak && peak / (first + 1e-10) > 2.0) return 'plausible';
    if (peak <= first * 0.9 || peakIdx === 0) return 'falsified';
    return 'inconclusive';
  },

  testH2() {
    // Chirality is necessary for resonance
    const result = Engine4.run({ pitchAngle: 12 });
    PhysicsResults.engine4 = result;

    const chiralTriplets = result.chiral.clustering.tripletCount;
    const achiralTriplets = result.achiral.clustering.tripletCount;
    const advantage = result.tripletAdvantage;
    const chiralScore = result.chiral.clustering.clusterScore;
    const achiralScore = result.achiral.clustering.clusterScore;
    const chiralSizes = result.chiral.clustering.sizeDistribution;
    const achiralSizes = result.achiral.clustering.sizeDistribution;

    // The triplet count comes from a gap heuristic and jumps around with pitch and mode cutoffs.
    // A verdict counts only if it holds across nearby pitches and cutoffs; otherwise H2 is
    // inconclusive. (Achiral modes come in exact +n/-n pairs, which the heuristic can never merge
    // into triplets, so the raw chiral-vs-achiral count is not a fair test on its own.)
    const baseVerdict = this.verdictH2(result);
    let agree = 0, total = 0;
    for (const pitch of [10, 12, 14]) {
      for (const [maxM, maxN] of [[4, 8], [6, 12], [8, 16]]) {
        total++;
        if (this.verdictH2(Engine4.run({ pitchAngle: pitch, maxM, maxN })) === baseVerdict) agree++;
      }
    }
    const sweepAgreement = agree / total;
    const verdict = sweepAgreement >= 0.8 ? baseVerdict : 'inconclusive';

    return {
      verdict,
      sweepAgreement,
      metrics: {
        'Verdict at 12°, M6, N12': baseVerdict,
        'Same verdict across pitch 10-14° and 3 mode cutoffs': agree + '/' + total + (sweepAgreement >= 0.8 ? ' (robust)' : ' (not robust → inconclusive)'),
        'Chiral triplet clusters': chiralTriplets,
        'Achiral triplet clusters': achiralTriplets,
        'Chiral cluster score': chiralScore.toFixed(3),
        'Achiral cluster score': achiralScore.toFixed(3),
        'Triplet advantage': (advantage * 100).toFixed(1) + '%',
        'Chiral size dist': JSON.stringify(chiralSizes),
        'Achiral size dist': JSON.stringify(achiralSizes),
      },
      detail: `Chiral (12° pitch): ${chiralTriplets} triplet clusters (score ${chiralScore.toFixed(3)}). Achiral: ${achiralTriplets} triplets (score ${achiralScore.toFixed(3)}). Advantage: ${(advantage * 100).toFixed(1)}%.`,
    };
  },

  testH3() {
    // Boundary dominates bulk — test with varying tube lengths
    const lengths = [50e-9, 100e-9, 200e-9, 500e-9, 1000e-9]; // 50nm to 1000nm
    const amplifications = [];

    for (const L of lengths) {
      const modes = Engine4.computeModes(12, { length: L });
      const clustering = Engine4.analyzeClustering(modes);
      amplifications.push(clustering.clusterScore);
    }

    // Check if amplification plateaus (boundary) or grows linearly (bulk)
    const first = amplifications[0];
    const last = amplifications[amplifications.length - 1];
    const ratio = last / (first + 1e-10);
    const lengthRatio = lengths[lengths.length - 1] / lengths[0]; // 20x

    // NOTE: "consistent" — this tests internal model behavior, not biological reality.
    // Sub-linear scaling confirms the model's structure, not Bandyopadhyay's claims.
    const verdict = this.verdictH3(first, last, lengthRatio);
    const defined = first > 0 && last > 0;
    const basis = !defined
      ? 'Score is 0 at one end, so the ratio is undefined'
      : ratio < Math.sqrt(lengthRatio) ? 'Sub-linear = boundary' : 'Near-linear = bulk';

    return {
      verdict,
      metrics: {
        'Length range': '50nm to 1000nm (20x)',
        'Score at 50nm': amplifications[0].toFixed(3),
        'Score at 1000nm': amplifications[amplifications.length - 1].toFixed(3),
        'Scaling ratio': defined ? ratio.toFixed(2) + 'x (linear would be 20x)' : 'undefined',
        'Verdict basis': basis,
      },
      detail: defined
        ? `Cluster score scales ${ratio.toFixed(1)}x over 20x length increase. ${ratio < Math.sqrt(lengthRatio) ? 'Sub-linear → boundary dominates.' : 'Near-linear → bulk transport.'}`
        : 'The triplet cluster score is 0 at one end of the length range, so this test cannot tell boundary from bulk.',
    };
  },

  testH4() {
    // Filament-first temporal ordering
    // Physical question: in a coupled system where the fast oscillator (MHz filament)
    // is driven, does it reach its steady state BEFORE the slow oscillator (kHz membrane)?
    // Each oscillator is measured against its OWN eventual amplitude.
    const normalResult = Engine1.run({ coupling: 0.3, damping: 0.1, duration: 3000 });
    PhysicsResults.engine1 = normalResult;

    const ts = normalResult.timeSeries;
    const n = ts.xSlow.length;

    // Find each oscillator's max amplitude (for relative thresholds)
    const maxFast = Math.max(...ts.xFast.map(Math.abs));
    const maxSlow = Math.max(...ts.xSlow.map(Math.abs));

    // Find when each reaches 50% of its own max (relative response time)
    let fastResponseTime = -1, slowResponseTime = -1;
    for (let i = 0; i < n; i++) {
      if (fastResponseTime < 0 && Math.abs(ts.xFast[i]) > maxFast * 0.5) {
        fastResponseTime = ts.t[i];
      }
      if (slowResponseTime < 0 && Math.abs(ts.xSlow[i]) > maxSlow * 0.5) {
        slowResponseTime = ts.t[i];
      }
    }

    const leadTime = (fastResponseTime >= 0 && slowResponseTime >= 0)
      ? slowResponseTime - fastResponseTime : 0;

    const energyRatio = normalResult.energyTransfer.transferRatio;

    // Amplitude ratio: how much weaker is the slow oscillator's response?
    const amplitudeRatio = maxSlow / (maxFast + 1e-20);

    let verdict = 'inconclusive';
    // NOTE: "consistent" — a fast oscillator coupled to a slow one will always
    // show the fast one leading. This is math confirming math (the model's
    // assumptions), not biology confirming physics. The real question is whether
    // microtubules actually behave as coupled oscillators at these frequencies.
    if (fastResponseTime >= 0 && slowResponseTime >= 0) {
      if (leadTime > 5) {
        verdict = 'consistent'; // Expected from model structure — not independent validation
      } else if (leadTime < -5) {
        verdict = 'falsified'; // Slow responds first — would contradict model
      }
    }

    return {
      verdict,
      metrics: {
        'Fast 50% response time': fastResponseTime >= 0 ? fastResponseTime.toFixed(1) + ' us' : 'N/A',
        'Slow 50% response time': slowResponseTime >= 0 ? slowResponseTime.toFixed(1) + ' us' : 'N/A',
        'Phase lead (fast→slow)': leadTime.toFixed(1) + ' us',
        'Expected': '~250 us (Bandyopadhyay)',
        'Fast max amplitude': maxFast.toFixed(4),
        'Slow max amplitude': maxSlow.toExponential(3),
        'Amplitude ratio (slow/fast)': (amplitudeRatio * 100).toFixed(3) + '%',
        'Energy transfer ratio': energyRatio.toFixed(6),
      },
      detail: `Fast at 50% by ${fastResponseTime >= 0 ? fastResponseTime.toFixed(0) : '?'}us, slow at 50% by ${slowResponseTime >= 0 ? slowResponseTime.toFixed(0) : '?'}us. Lead: ${leadTime.toFixed(0)}us. Slow/fast amplitude: ${(amplitudeRatio * 100).toFixed(2)}%.`,
    };
  },

  testH5() {
    // Golden ratio geometry maximizes coupling
    const result = Engine5.run({ nProtofilaments: 13, angleStep: 0.5 });
    PhysicsResults.engine5 = result;

    const peakAngle = result.peakAngle;
    const actualAngle = result.actualMTAngle;
    const angleDiff = Math.abs(peakAngle - actualAngle);

    let verdict = 'inconclusive';
    if (angleDiff < 3) {
      verdict = 'supported';
    } else if (angleDiff > 15) {
      verdict = 'falsified';
    }

    return {
      verdict,
      metrics: {
        'Peak coupling angle': peakAngle.toFixed(1) + ' deg',
        'Actual MT pitch': actualAngle + ' deg',
        'Angle difference': angleDiff.toFixed(1) + ' deg',
        'Peak combined score': result.peakScore.toFixed(4),
        'Berry phase at peak': result.berryPhase[Math.round(peakAngle / 0.5) - 1]?.toFixed(4) || 'N/A',
      },
      detail: `Peak coupling at ${peakAngle.toFixed(1)} deg vs actual MT pitch of ${actualAngle} deg (diff: ${angleDiff.toFixed(1)} deg).`,
    };
  },

  testH6() {
    // Thermal noise as fuel (stochastic resonance), tested fairly:
    //  1. Observable: coherent fundamental-to-residual power ratio of the two-state output sign(x)
    //     (it counts well-to-well hops, not the in-well wobble).
    //  2. Positive control: the same double well driven slowly (f = 0.01), where the Kramers
    //     matching heuristic r_K(D*) = w/pi has a solution. The test must find an interior peak near
    //     D*; if it cannot, it could not have seen SR at all: inconclusive.
    //  3. Native drives (0.7, 1.0, 1.4), each judged alone over a wide noise range (D = 0.2-7.5), with
    //     a no-signal (A = 0) run as the negative control: SR needs an interior peak AND a response at
    //     least 3x that baseline.
    const CONTROL_FREQ = 0.01;
    const NATIVE_LEVELS = [0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0, 1.3, 1.7, 2.2, 3.0, 4.0, 5.5, 7.5];
    const control = Engine2.runTwoState({ freqs: [CONTROL_FREQ], nTrials: 40, periods: 20 });
    const nativeOpts = { freqs: [0.7, 1.0, 1.4], noiseLevels: NATIVE_LEVELS, nTrials: 40, periods: 70 };
    const native = Engine2.runTwoState(nativeOpts);
    const nativeZero = Engine2.runTwoState({ ...nativeOpts, signalAmplitude: 0 });
    PhysicsResults.engine2 = native;

    const matchedD = Engine2.matchedNoise(CONTROL_FREQ);
    const verdict = this.verdictH6Fair(native, nativeZero, control, matchedD);
    const controlOk = this.verdictH6(control.meanSNR) === 'plausible'
      && matchedD !== null && Math.abs(control.optimalNoise / matchedD - 1) <= 0.5;
    const detected = this.h6DetectedFreqs(native, nativeZero);
    const maxExcess = Math.max(...native.snrByFreq.flatMap((s, k) =>
      s.map((v, j) => v / Math.max(nativeZero.snrByFreq[k][j], 1e-12))));
    const maxRate = Math.SQRT2 / (2 * Math.PI);

    return {
      verdict,
      control: { freq: CONTROL_FREQ, matchedD, optimalNoise: control.optimalNoise, peakSNR: control.peakSNR, ok: controlOk },
      detectedFreqs: detected,
      metrics: {
        'Control (slow drive f=0.01) peak': `D=${control.optimalNoise} (Kramers matching predicts D*=${matchedD.toFixed(3)}), ratio ${control.peakSNR.toFixed(3)}`,
        'Control finds SR': controlOk ? 'Yes: the method detects stochastic resonance' : 'No: the method is not sensitive here, so no verdict',
        'Native drive (0.7, 1.0, 1.4), D 0.2-7.5': detected.length
          ? `SR detected at f = ${detected.join(', ')}`
          : `no frequency shows an interior peak 3x above the no-signal baseline (largest ratio to baseline ${maxExcess.toFixed(1)}x)`,
        'Native vs control peak': (native.peakSNR / control.peakSNR).toExponential(1) + 'x',
        'Kramers matching at native drive': [0.7, 1.0, 1.4].every((f) => Engine2.matchedNoise(f) === null)
          ? `no solution within the Kramers approximation (needs w/pi >= 1.4; the approximation tops out at ${maxRate.toFixed(3)})`
          : 'has a solution',
      },
      detail: !controlOk
        ? 'The slow-drive control did not show stochastic resonance near the Kramers-matched noise, so this test cannot decide H6.'
        : verdict === 'plausible'
          ? `Stochastic resonance detected at the native drive (f = ${detected.join(', ')}).`
          : `The method detects stochastic resonance when the drive is slow (control peak at D=${control.optimalNoise}, Kramers-matched D*=${matchedD.toFixed(2)}). At the model's own drive no noise level from 0.2 to 7.5 gives a response clearly above the no-signal baseline, so SR is not demonstrated there.`,
    };
  },

  testH7() {
    // Scale invariance predicts new resonances
    const result = Engine6.run({ matchThreshold: 0.05 });
    PhysicsResults.engine6 = result;

    const schumannFraction = result.schumannMatchFraction;
    const thermalMatch = result.thermalMatchFound;
    const nSchumannMatches = result.schumannMatches.filter(m => m.isMatch).length;

    let verdict = 'inconclusive';
    // "unvalidated" — matching 4/5 Schumann harmonics SOUNDS impressive but
    // requires statistical calibration. Both patterns are approximately harmonic
    // series in similar frequency ranges. The base rate of coincidental matches
    // with random fractal patterns could be 20-40%. Until we run the Monte Carlo
    // null (Engine7), this is numerology dressed as prediction.
    // Run Engine7's Monte Carlo to get a p-value, THEN upgrade if p < 0.05.
    if (schumannFraction >= 0.6) {
      // Check if Engine7 has been run for statistical calibration
      if (PhysicsResults.engine7 && PhysicsResults.engine7.pValue < 0.05) {
        verdict = 'plausible'; // Statistically significant after null comparison
      } else {
        verdict = 'unvalidated'; // Matches exist but statistical significance unknown
      }
    } else if (schumannFraction > 0.2 && thermalMatch) {
      verdict = 'unvalidated'; // Some matches, needs null comparison
    } else if (schumannFraction === 0 && !thermalMatch) {
      verdict = 'falsified';
    }

    // Run Monte Carlo null comparison (Engine7)
    const nullResult = Engine7.run({ nTrials: 10000, matchThreshold: 0.05 });
    PhysicsResults.engine7 = nullResult;

    // Upgrade verdict if Monte Carlo shows statistical significance
    if (verdict === 'unvalidated' && nullResult.isSignificant) {
      verdict = 'plausible'; // Survives null comparison — p < 0.05
    }

    const matchDetails = result.schumannMatches.map(m =>
      `${m.schumannFreq} Hz → ${m.nearestPredicted?.toFixed(2) || '?'} Hz (${m.freqErrorPercent.toFixed(1)}% off${m.isMatch ? ', MATCH' : ''})`
    );

    return {
      verdict,
      metrics: {
        'Schumann matches': nSchumannMatches + '/5 within a factor of ' + Math.pow(10, result.matchThreshold).toFixed(3) + ' (' + (100 / Math.pow(10, result.matchThreshold) - 100).toFixed(1) + '% / +' + result.matchThresholdPercent.toFixed(1) + '%)',
        'Thermal (5-6 THz) match': thermalMatch ? 'Yes' : 'No',
        'Monte Carlo p-value': nullResult.pValue.toFixed(4) + (nullResult.isSignificant ? ' ✓ significant' : ' ✗ not significant'),
        'Random mean matches': nullResult.meanRandomMatches.toFixed(2) + ' ± ' + nullResult.stdRandomMatches.toFixed(2),
        'Percentile': nullResult.percentile.toFixed(1) + '%',
        'Match details': matchDetails.join('; '),
      },
      detail: `${nSchumannMatches}/5 Schumann harmonics match within a factor of ${Math.pow(10, result.matchThreshold).toFixed(3)} in frequency (up to ${result.matchThresholdPercent.toFixed(1)}% off). Monte Carlo null: ${nullResult.pValue < 0.05 ? 'SIGNIFICANT' : 'NOT SIGNIFICANT'} (p=${nullResult.pValue.toFixed(4)}, random patterns average ${nullResult.meanRandomMatches.toFixed(1)} matches). ${nullResult.pValue < 0.05 ? 'Result survives null comparison.' : 'Cannot exclude coincidence — insufficient evidence.'}`,
    };
  },
};


/* ===========================================================
   ENGINE 8: Sensitivity Analyzer
   How fragile are our verdicts? Jiggle every parameter and see
   what breaks. If a verdict flips from ±20%, it's on a knife edge.
   =========================================================== */
const Engine8 = {
  /**
   * Run sensitivity analysis for all hypotheses
   * @param {Object} opts - perturbRange (fraction), nSamples per param
   * @returns {Object} - per-hypothesis robustness scores and breakdown
   */
  run(opts = {}) {
    PhysicsRNG.reseed();
    const range = opts.perturbRange ?? 0.3; // ±30% default
    const nSamples = opts.nSamples || 5;    // samples per direction per param

    const results = {};

    // H1: Berry phase coherence
    results.H1 = this.analyzeH1(range, nSamples);

    // H2: Chiral waveguide
    results.H2 = this.analyzeH2(range, nSamples);

    // H4: Coupled oscillator timing
    results.H4 = this.analyzeH4(range, nSamples);

    // H5: Pitch angle sweep
    results.H5 = this.analyzeH5(range, nSamples);

    // H6: Stochastic resonance
    results.H6 = this.analyzeH6(range, nSamples);

    // H3 and H7 skipped: H3 is tautological, H7 already has Monte Carlo null
    results.H3 = { robustness: 'N/A', reason: 'Tautological — sensitivity irrelevant' };
    results.H7 = { robustness: 'N/A', reason: 'Already has Monte Carlo null comparison (p-value)' };

    // Compute overall fragility summary
    const analyzed = ['H1', 'H2', 'H4', 'H5', 'H6'];
    let totalRobust = 0, totalTests = 0;
    for (const id of analyzed) {
      if (results[id].robustness !== 'N/A') {
        totalRobust += results[id].robustnessScore;
        totalTests++;
      }
    }

    results.summary = {
      overallRobustness: totalTests > 0 ? (totalRobust / totalTests * 100).toFixed(1) + '%' : 'N/A',
      analyzed: totalTests,
      details: analyzed.map(id => ({
        id,
        robustness: results[id].robustness,
        score: results[id].robustnessScore,
        fragileParams: results[id].fragileParams || [],
      })),
    };

    return results;
  },

  /**
   * Generic parameter sweep: run a test function with perturbed params,
   * count how often the verdict matches baseline
   */
  _sweep(baselineVerdict, paramDefs, testFn, range, nSamples) {
    PhysicsRNG.reseed();
    let totalRuns = 0;
    let matchingRuns = 0;
    const fragileParams = [];

    for (const param of paramDefs) {
      let paramMatches = 0;
      let paramTotal = 0;
      const baseVal = param.value;

      for (let i = -nSamples; i <= nSamples; i++) {
        if (i === 0) continue; // skip baseline
        const fraction = i / nSamples * range;
        const perturbedVal = baseVal * (1 + fraction);

        // Clamp to valid range if specified
        const val = param.clamp
          ? Math.max(param.clamp[0], Math.min(param.clamp[1], perturbedVal))
          : perturbedVal;

        try {
          const result = testFn(param.name, val);
          totalRuns++;
          paramTotal++;
          if (result.verdict === baselineVerdict) {
            matchingRuns++;
            paramMatches++;
          }
        } catch (e) {
          // Skip failed runs
        }
      }

      const paramRobustness = paramTotal > 0 ? paramMatches / paramTotal : 1;
      if (paramRobustness < 0.7) {
        fragileParams.push({
          name: param.name,
          robustness: (paramRobustness * 100).toFixed(0) + '%',
          baseValue: baseVal,
        });
      }
    }

    const score = totalRuns > 0 ? matchingRuns / totalRuns : 0;
    return {
      robustnessScore: score,
      robustness: score > 0.8 ? 'robust' : score > 0.5 ? 'moderate' : 'fragile',
      totalRuns,
      matchingRuns,
      baselineVerdict,
      fragileParams,
    };
  },

  analyzeH1(range, nSamples) {
    // Baseline
    const baseline = HypothesisRunner.testH1();

    // Key parameters for Berry phase coherence
    const paramDefs = [
      { name: 'pitchDeg', value: 12, clamp: [1, 45] },
      { name: 'nProto', value: 13, clamp: [8, 18] },
      { name: 'phasePerScale', value: Math.PI / 4, clamp: [0.1, Math.PI] },
    ];

    return this._sweep(baseline.verdict, paramDefs, (paramName, val) => {
      // Engine 3 uses hardcoded Berry phase params, so we need to run
      // a modified version. We'll compute coherent amplitude directly.
      const maxModes = 36;
      let berryPhasePerTurn, nProto, phasePerScale;

      if (paramName === 'pitchDeg') {
        berryPhasePerTurn = Math.PI * (1 - Math.cos(val * Math.PI / 180));
        nProto = 13;
        phasePerScale = Math.PI / 4;
      } else if (paramName === 'nProto') {
        berryPhasePerTurn = Math.PI * (1 - Math.cos(12 * Math.PI / 180));
        nProto = Math.round(val);
        phasePerScale = Math.PI / 4;
      } else {
        berryPhasePerTurn = Math.PI * (1 - Math.cos(12 * Math.PI / 180));
        nProto = 13;
        phasePerScale = val;
      }

      const phasePerRing = nProto * berryPhasePerTurn;
      const phases = [];
      for (let scale = 0; scale < 4; scale++) {
        const sp = scale * phasePerScale;
        for (let triplet = 0; triplet < 3; triplet++) {
          const tp = triplet * phasePerRing;
          for (let sub = 0; sub < 3; sub++) {
            phases.push(sp + tp + (sub - 1) * berryPhasePerTurn * 0.5);
          }
        }
      }

      // Coherent sum
      let re = 0, im = 0;
      for (let i = 0; i < Math.min(maxModes, phases.length); i++) {
        re += Math.cos(phases[i]);
        im += Math.sin(phases[i]);
      }
      const coherent = Math.sqrt(re * re + im * im);
      const sqrtN = Math.sqrt(maxModes);

      // Quick random baseline (fewer trials for speed)
      let randomSum = 0;
      const quickTrials = 500;
      for (let t = 0; t < quickTrials; t++) {
        let rre = 0, rim = 0;
        for (let i = 0; i < maxModes; i++) {
          const phi = PhysicsRNG.random() * 2 * Math.PI;
          rre += Math.cos(phi);
          rim += Math.sin(phi);
        }
        randomSum += Math.sqrt(rre * rre + rim * rim);
      }
      const randomMean = randomSum / quickTrials;
      const ratio = coherent / randomMean;

      let verdict = 'inconclusive';
      if (ratio > 2.0 && coherent > sqrtN * 1.5) verdict = 'plausible';
      else if (ratio < 1.1) verdict = 'falsified';

      return { verdict };
    }, range, nSamples);
  },

  analyzeH2(range, nSamples) {
    // Single-run rule at the baseline parameters, so baseline and perturbed runs are judged alike.
    const baselineVerdict = HypothesisRunner.verdictH2(Engine4.run({ pitchAngle: 12 }));
    const paramDefs = [
      { name: 'pitchAngle', value: 12, clamp: [1, 45] },
      { name: 'maxM', value: 6, clamp: [3, 12] },
      { name: 'maxN', value: 12, clamp: [6, 24] },
    ];

    return this._sweep(baselineVerdict, paramDefs, (paramName, val) => {
      const opts = {};
      if (paramName === 'pitchAngle') opts.pitchAngle = val;
      else if (paramName === 'maxM') opts.maxM = Math.round(val);
      else if (paramName === 'maxN') opts.maxN = Math.round(val);
      return { verdict: HypothesisRunner.verdictH2(Engine4.run(opts)) };
    }, range, nSamples);
  },

  analyzeH4(range, nSamples) {
    const baseline = HypothesisRunner.testH4();
    const paramDefs = [
      { name: 'coupling', value: 0.3, clamp: [0.01, 1.0] },
      { name: 'damping', value: 0.1, clamp: [0.01, 0.5] },
    ];

    return this._sweep(baseline.verdict, paramDefs, (paramName, val) => {
      const opts = { duration: 3000 };
      if (paramName === 'coupling') opts.coupling = val;
      else opts.damping = val;

      const r = Engine1.run(opts);
      const ts = r.timeSeries;
      const n = ts.xSlow.length;
      const maxFast = Math.max(...ts.xFast.map(Math.abs));
      const maxSlow = Math.max(...ts.xSlow.map(Math.abs));

      let fastT = -1, slowT = -1;
      for (let i = 0; i < n; i++) {
        if (fastT < 0 && Math.abs(ts.xFast[i]) > maxFast * 0.5) fastT = ts.t[i];
        if (slowT < 0 && Math.abs(ts.xSlow[i]) > maxSlow * 0.5) slowT = ts.t[i];
      }

      const lead = (fastT >= 0 && slowT >= 0) ? slowT - fastT : 0;
      let verdict = 'inconclusive';
      if (fastT >= 0 && slowT >= 0) {
        if (lead > 5) verdict = 'consistent';
        else if (lead < -5) verdict = 'falsified';
      }
      return { verdict };
    }, range, nSamples);
  },

  analyzeH5(range, nSamples) {
    const baseline = HypothesisRunner.testH5();
    const paramDefs = [
      { name: 'nProtofilaments', value: 13, clamp: [8, 18] },
      { name: 'alphaCritical', value: 15, clamp: [5, 45] },
    ];

    return this._sweep(baseline.verdict, paramDefs, (paramName, val) => {
      const opts = {};
      if (paramName === 'nProtofilaments') opts.nProtofilaments = Math.round(val);
      else opts.alphaCritical = val;

      const r = Engine5.run(opts);
      const diff = Math.abs(r.peakAngle - 12);
      let verdict = 'inconclusive';
      if (diff < 3) verdict = 'supported';
      else if (diff > 15) verdict = 'falsified';
      return { verdict };
    }, range, nSamples);
  },

  analyzeH6(range, nSamples) {
    // The fair H6 test (two-state SNR, slow-drive control, native drive), with the same settings for
    // the baseline and every perturbed run. Signal amplitude is perturbed in both control and native.
    const levels = [0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0, 1.3, 1.7, 2.2, 3.0, 4.0, 5.5, 7.5];
    const fair = (A, nTrials) => {
      const control = Engine2.runTwoState({ freqs: [0.01], signalAmplitude: A, nTrials, periods: 20 });
      const nativeOpts = { freqs: [0.7, 1.0, 1.4], noiseLevels: levels, nTrials, periods: 70 };
      const native = Engine2.runTwoState({ ...nativeOpts, signalAmplitude: A });
      const nativeZero = Engine2.runTwoState({ ...nativeOpts, signalAmplitude: 0 });
      return HypothesisRunner.verdictH6Fair(native, nativeZero, control, Engine2.matchedNoise(0.01));
    };
    const baselineVerdict = fair(0.3, 40);
    const paramDefs = [
      { name: 'signalAmplitude', value: 0.3, clamp: [0.05, 1.0] },
      { name: 'nTrials', value: 40, clamp: [10, 100] },
    ];

    return this._sweep(baselineVerdict, paramDefs, (paramName, val) => ({
      verdict: paramName === 'signalAmplitude' ? fair(val, 40) : fair(0.3, Math.round(val)),
    }), range, nSamples);
  },
};


/* ===========================================================
   ENGINE 9: Alternative Structure Comparator
   Does the fractal triplet-of-triplet pattern ACTUALLY beat
   other plausible ordered structures? Or does any order work?
   =========================================================== */
const Engine9 = {
  /**
   * Compare coherent amplification across different phase structures
   * All use N=36 modes, same as our fractal model
   */
  run(opts = {}) {
    PhysicsRNG.reseed();
    const N = opts.nModes || 36;
    const nRandomTrials = opts.nRandomTrials || 10000;

    const structures = {};

    // 1. OUR MODEL: Fractal triplet-of-triplet (Berry phases)
    structures.fractal = this.computeFractalPhases(N);

    // 2. REGULAR LATTICE: Evenly spaced phases (like a phased antenna array)
    structures.regularLattice = this.computeRegularLattice(N);

    // 3. GOLDEN ANGLE SPIRAL: Each mode offset by golden angle
    //    (Fibonacci phyllotaxis — appears widely in biology)
    structures.goldenSpiral = this.computeGoldenSpiral(N);

    // 4. SIMPLE HARMONIC: Phases at k * 2π/m for small m
    //    (like modes of a simple resonant cavity)
    structures.harmonicCavity = this.computeHarmonicCavity(N);

    // 5. HELICAL LATTICE: 13-fold rotational symmetry, uniform pitch
    //    (microtubule geometry WITHOUT fractal nesting)
    structures.helicalLattice = this.computeHelicalLattice(N);

    // 6. RANDOM BASELINE: Monte Carlo average
    structures.random = this.computeRandomBaseline(N, nRandomTrials);

    // 7. PERFECT ALIGNMENT: Theoretical maximum (all phases = 0)
    structures.perfect = { amplitude: N, phases: new Array(N).fill(0), label: 'Perfect alignment' };

    // Build comparison table
    const comparison = [];
    for (const [key, struct] of Object.entries(structures)) {
      if (key === 'random') {
        comparison.push({
          name: struct.label,
          amplitude: struct.amplitude,
          relativeToRandom: 1.0,
          relativeToPerfect: struct.amplitude / N,
          efficiency: (struct.amplitude / N * 100).toFixed(1) + '%',
        });
      } else {
        comparison.push({
          name: struct.label,
          amplitude: struct.amplitude,
          relativeToRandom: struct.amplitude / structures.random.amplitude,
          relativeToPerfect: struct.amplitude / N,
          efficiency: (struct.amplitude / N * 100).toFixed(1) + '%',
        });
      }
    }

    // Sort by amplitude (descending)
    comparison.sort((a, b) => b.amplitude - a.amplitude);

    // Key question: where does our fractal pattern rank?
    const fractalRank = comparison.findIndex(c => c.name === structures.fractal.label) + 1;
    const fractalBeatsOthers = comparison.filter(c =>
      c.name !== structures.fractal.label &&
      c.name !== structures.perfect.label &&
      c.name !== structures.random.label &&
      c.amplitude < structures.fractal.amplitude
    ).length;
    const totalAlternatives = comparison.length - 3; // exclude perfect, random, fractal itself

    return {
      structures,
      comparison,
      fractalRank,
      fractalBeatsOthers,
      totalAlternatives,
      fractalIsSpecial: fractalBeatsOthers === totalAlternatives, // beats ALL alternatives
      fractalAmplitude: structures.fractal.amplitude,
      bestAlternative: comparison.find(c =>
        c.name !== structures.fractal.label &&
        c.name !== structures.perfect.label &&
        c.name !== structures.random.label
      ),
    };
  },

  computeFractalPhases(N) {
    const berryPhasePerTurn = Math.PI * (1 - Math.cos(12 * Math.PI / 180));
    const nProto = 13;
    const phasePerRing = nProto * berryPhasePerTurn;
    const phasePerScale = Math.PI / 4;

    const phases = [];
    for (let scale = 0; scale < 4; scale++) {
      const sp = scale * phasePerScale;
      for (let triplet = 0; triplet < 3; triplet++) {
        const tp = triplet * phasePerRing;
        for (let sub = 0; sub < 3; sub++) {
          phases.push(sp + tp + (sub - 1) * berryPhasePerTurn * 0.5);
        }
      }
    }

    const amp = this._coherentSum(phases.slice(0, N));
    return { amplitude: amp, phases: phases.slice(0, N), label: 'Fractal triplet (our model)' };
  },

  computeRegularLattice(N) {
    // Evenly spaced phases — classic phased array
    const phases = [];
    for (let i = 0; i < N; i++) {
      phases.push(2 * Math.PI * i / N);
    }
    // Note: evenly spaced phases around full circle sum to ~0!
    // That's the N-th roots of unity. So we use a PARTIAL sweep instead.
    const partialPhases = [];
    for (let i = 0; i < N; i++) {
      partialPhases.push(Math.PI * i / N); // half-circle sweep
    }
    const amp = this._coherentSum(partialPhases);
    return { amplitude: amp, phases: partialPhases, label: 'Regular lattice (half-circle)' };
  },

  computeGoldenSpiral(N) {
    // Golden angle: 2π / φ² ≈ 137.508° — nature's most irrational angle
    // Used in sunflower seed packing, leaf arrangement, etc.
    const goldenAngle = 2 * Math.PI / (((1 + Math.sqrt(5)) / 2) ** 2);
    const phases = [];
    for (let i = 0; i < N; i++) {
      phases.push(i * goldenAngle);
    }
    const amp = this._coherentSum(phases);
    return { amplitude: amp, phases, label: 'Golden angle spiral' };
  },

  computeHarmonicCavity(N) {
    // Phases from a simple rectangular cavity: modes at integer multiples
    // of a base frequency, so phases accumulate linearly
    const basePhase = 0.3; // ~17°, a typical small-angle resonator
    const phases = [];
    for (let i = 0; i < N; i++) {
      phases.push(i * basePhase);
    }
    const amp = this._coherentSum(phases);
    return { amplitude: amp, phases, label: 'Harmonic cavity (linear)' };
  },

  computeHelicalLattice(N) {
    // 13-fold rotational symmetry with uniform helical pitch
    // This is microtubule geometry WITHOUT the fractal nesting
    // Just the geometric phase from the helix
    const berryPhasePerTurn = Math.PI * (1 - Math.cos(12 * Math.PI / 180));
    const nProto = 13;
    const phases = [];
    for (let i = 0; i < N; i++) {
      // Simple helical progression: each mode gets one more unit of Berry phase
      phases.push(i * berryPhasePerTurn * nProto / 3); // divided by 3 for sub-modes
    }
    const amp = this._coherentSum(phases);
    return { amplitude: amp, phases, label: 'Helical lattice (no nesting)' };
  },

  computeRandomBaseline(N, nTrials) {
    let totalAmp = 0;
    for (let t = 0; t < nTrials; t++) {
      let re = 0, im = 0;
      for (let i = 0; i < N; i++) {
        const phi = PhysicsRNG.random() * 2 * Math.PI;
        re += Math.cos(phi);
        im += Math.sin(phi);
      }
      totalAmp += Math.sqrt(re * re + im * im);
    }
    return { amplitude: totalAmp / nTrials, phases: null, label: 'Random (Monte Carlo mean)' };
  },

  _coherentSum(phases) {
    let re = 0, im = 0;
    for (const phi of phases) {
      re += Math.cos(phi);
      im += Math.sin(phi);
    }
    return Math.sqrt(re * re + im * im);
  },
};


/* ===========================================================
   ENGINE 10: Energy Budget Calculator
   Can a neuron actually AFFORD to run MHz oscillations
   in its microtubules? Back-of-envelope biophysics.
   =========================================================== */
const Engine10 = {
  // Biophysical constants
  CONSTANTS: {
    kT_37C: 4.28e-21,         // Thermal energy at 37°C (J)
    // Free energy per ATP hydrolysis under cellular conditions: ~0.54 eV (~52 kJ/mol).
    // 0.54 eV x 1.602e-19 J/eV = 8.65e-20 J. (The old 5.4e-20 J was 0.34 eV, near the
    // standard-state value, and disagreed with its own 0.54 eV label.)
    ATP_energy: 0.54 * 1.602176634e-19,
    tubulin_conformational: 1e-20, // Energy per tubulin conformational change (J)
    neuron_ATP_rate: 4.7e9,    // ATP molecules consumed per neuron per second
    // A neuron's power is its ATP turnover times the energy per ATP, so it is derived,
    // not set separately: 4.7e9/s x 8.65e-20 J = 0.41 nW. Cross-check: 20 W brain /
    // 86e9 neurons = 0.23 nW. (The old 1 nW disagreed with the two constants above by 4x.)
    get neuron_power() { return this.neuron_ATP_rate * this.ATP_energy; },
    MT_per_neuron: 1e5,        // ~100,000 microtubules per neuron
    MT_length: 1e-6,           // modelled microtubule length (m): 1 μm
    // Dimers per microtubule follow from the geometry: 13 protofilaments x (length / 8 nm
    // per ring). For 1 μm that is 13 x 125 = 1625. Change MT_length, not this line.
    get dimers_per_MT() { return 13 * Math.round(this.MT_length / 8e-9); },
    cytoplasm_viscosity: 3e-3, // ~3x water viscosity (Pa·s)
    tubulin_diameter: 8e-9,    // Tubulin dimer diameter (m)
  },

  run(opts = {}) {
    const C = this.CONSTANTS;

    // === Scenario 1: MHz conformational oscillations ===
    const freqMHz = opts.freqMHz ?? 1; // MHz
    const freq = freqMHz * 1e6;
    const activeFraction = opts.activeFraction ?? 0.01; // 1% of dimers oscillating at any time

    // Energy per oscillation cycle (conformational switch)
    const energyPerCycle = C.tubulin_conformational;

    // Total power per microtubule
    const activeDimers = C.dimers_per_MT * activeFraction;
    const powerPerMT = activeDimers * energyPerCycle * freq;

    // Total power for all microtubules
    const totalMTPower = powerPerMT * C.MT_per_neuron;

    // As fraction of neuron's energy budget
    const budgetFraction = totalMTPower / C.neuron_power;

    // ATP molecules needed per second
    const ATPperSecond = totalMTPower / C.ATP_energy;
    const ATPbudgetFraction = ATPperSecond / C.neuron_ATP_rate;

    // === Scenario 2: Can thermal noise supply the energy? ===
    // Equipartition gives kT/2 per quadratic degree of freedom on average. E_conf is 2.3 kT, and
    // exp(-E/kT) is the Boltzmann weight of a state that high. Whether thermal kicks switch dimers
    // fast enough (f x active fraction per second) is a rate question: it needs an attempt
    // frequency and an activation barrier, which this model does not specify. So sufficiency is
    // reported as undetermined, not yes or no. (The old test compared kT/2 x f for one mode
    // against E x f x fraction and always passed.) Thermal kicks have random phases either way,
    // so they cannot by themselves keep a coherent MHz oscillation going.
    const thermalEnergyPerMode = C.kT_37C / 2;
    const boltzmannFactor = Math.exp(-energyPerCycle / C.kT_37C);
    const thermalSufficient = null;

    // === Scenario 3: Viscous dissipation ===
    // Stokes drag on a tubulin dimer oscillating at MHz
    // Instantaneous P_drag = 6πηr × v². For x = A sin(2πft), v_max = 2πfA and the
    // power drawn over a cycle is the average, 6πηr × <v²> = 6πηr × v_max² / 2.
    // A sustained budget compares against that average, not the peak.
    const amplitude = 1e-10; // 1 Angstrom oscillation amplitude (conservative)
    const velocity = amplitude * 2 * Math.PI * freq; // peak velocity
    const stokesCoeff = 6 * Math.PI * C.cytoplasm_viscosity * (C.tubulin_diameter / 2);
    const dragPowerPerDimer = 0.5 * stokesCoeff * velocity * velocity;
    const totalDragPower = dragPowerPerDimer * activeDimers * C.MT_per_neuron;
    const dragBudgetFraction = totalDragPower / C.neuron_power;

    // === Verdict ===
    const feasible = budgetFraction < 0.1 && dragBudgetFraction < 0.1;
    const marginal = budgetFraction < 0.5 && dragBudgetFraction < 0.5;

    let verdict;
    if (feasible) {
      verdict = 'feasible'; // < 10% of energy budget
    } else if (marginal) {
      verdict = 'marginal'; // 10-50% — tight but possible
    } else {
      verdict = 'implausible'; // > 50% — would starve the neuron
    }

    return {
      verdict,
      scenario: {
        freqMHz,
        activeFraction: activeFraction * 100 + '%',
        activeDimersPerMT: Math.round(activeDimers),
      },
      energetics: {
        powerPerMT_watts: powerPerMT,
        powerPerMT_label: this._formatPower(powerPerMT),
        totalMTPower_watts: totalMTPower,
        totalMTPower_label: this._formatPower(totalMTPower),
        budgetFraction: (budgetFraction * 100).toFixed(3) + '%',
        ATPperSecond: ATPperSecond.toExponential(2),
        ATPbudgetFraction: (ATPbudgetFraction * 100).toFixed(3) + '%',
      },
      thermal: {
        thermalEnergyPerMode_J: thermalEnergyPerMode.toExponential(2),
        boltzmannFactor,
        thermalSufficient,
        thermalNote: `E_conf is ${(energyPerCycle / C.kT_37C).toFixed(1)} kT (Boltzmann weight ${(boltzmannFactor * 100).toFixed(1)}%), but whether thermal kicks reach ${freqMHz} MHz x ${(activeFraction * 100).toFixed(1)}% switching needs an attempt rate and barrier the model does not have. Thermal kicks are incoherent either way.`,
      },
      dissipation: {
        dragPerDimer_watts: dragPowerPerDimer,
        dragPerDimer_label: this._formatPower(dragPowerPerDimer),
        totalDragPower_label: this._formatPower(totalDragPower),
        dragBudgetFraction: (dragBudgetFraction * 100).toFixed(3) + '%',
        amplitude_angstroms: amplitude * 1e10,
      },
      summary: verdict === 'feasible'
        ? `At ${freqMHz} MHz with ${activeFraction * 100}% active dimers: total MT power = ${this._formatPower(totalMTPower)} (${(budgetFraction * 100).toFixed(2)}% of neuron budget). FEASIBLE — neuron can afford this.`
        : verdict === 'marginal'
        ? `At ${freqMHz} MHz with ${activeFraction * 100}% active dimers: total MT power = ${this._formatPower(totalMTPower)} (${(budgetFraction * 100).toFixed(2)}% of neuron budget). MARGINAL — tight but not impossible.`
        : `At ${freqMHz} MHz with ${activeFraction * 100}% active dimers: total MT power = ${this._formatPower(totalMTPower)} (${(budgetFraction * 100).toFixed(2)}% of neuron budget). IMPLAUSIBLE — would consume too much energy.`,
    };
  },

  _formatPower(watts) {
    if (watts < 1e-18) return (watts * 1e21).toFixed(2) + ' zW';
    if (watts < 1e-15) return (watts * 1e18).toFixed(2) + ' aW';
    if (watts < 1e-12) return (watts * 1e15).toFixed(2) + ' fW';
    if (watts < 1e-9)  return (watts * 1e12).toFixed(2) + ' pW';
    if (watts < 1e-6)  return (watts * 1e9).toFixed(2) + ' nW';
    return watts.toExponential(2) + ' W';
  },
};


/* ===========================================================
   Physics Engine Controller
   Manages async computation and integration with sim.js
   =========================================================== */
const PhysicsController = {
  /**
   * Run all hypothesis tests sequentially
   */
  async runAllTests(progressCallback) {
    const hypotheses = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7'];
    const results = {};

    for (let i = 0; i < hypotheses.length; i++) {
      const id = hypotheses[i];
      if (progressCallback) progressCallback(id, 'computing');
      PhysicsResults.computing[id] = true;

      // Yield to UI between heavy computations
      await new Promise(resolve => setTimeout(resolve, 50));

      try {
        results[id] = await HypothesisRunner.runTest(id);
        if (progressCallback) progressCallback(id, 'done', results[id]);
      } catch (err) {
        results[id] = { verdict: 'error', detail: err.message, metrics: {} };
        if (progressCallback) progressCallback(id, 'error', results[id]);
      }

      PhysicsResults.computing[id] = false;
    }

    return results;
  },

  /**
   * Run a single engine computation
   */
  runEngine(engineNum, opts = {}) {
    switch (engineNum) {
      case 1:
        PhysicsResults.engine1 = Engine1.run(opts);
        return PhysicsResults.engine1;
      case 2:
        PhysicsResults.engine2 = Engine2.run(opts);
        return PhysicsResults.engine2;
      case 3:
        PhysicsResults.engine3 = Engine3.run(opts);
        return PhysicsResults.engine3;
      case 4:
        PhysicsResults.engine4 = Engine4.run(opts);
        return PhysicsResults.engine4;
      case 5:
        PhysicsResults.engine5 = Engine5.run(opts);
        return PhysicsResults.engine5;
      case 6:
        PhysicsResults.engine6 = Engine6.run(opts);
        return PhysicsResults.engine6;
      case 7:
        PhysicsResults.engine7 = Engine7.run(opts);
        return PhysicsResults.engine7;
      case 8:
        PhysicsResults.engine8 = Engine8.run(opts);
        return PhysicsResults.engine8;
      case 9:
        PhysicsResults.engine9 = Engine9.run(opts);
        return PhysicsResults.engine9;
      case 10:
        PhysicsResults.engine10 = Engine10.run(opts);
        return PhysicsResults.engine10;
      default:
        return null;
    }
  },

  /**
   * Get per-frame cascade data from Engine 1
   * Returns downsampled time series suitable for canvas rendering
   */
  getCascadePhysicsData(opts = {}) {
    if (!PhysicsResults.engine1) {
      PhysicsResults.engine1 = Engine1.run(opts);
    }
    return PhysicsResults.engine1;
  },
};

// Make everything globally accessible for sim.js
window.PhysicsResults = PhysicsResults;
window.PhysicsMode = PhysicsMode;
window.PhysicsController = PhysicsController;
window.HypothesisRunner = HypothesisRunner;
window.Engine1 = Engine1;
window.Engine2 = Engine2;
window.Engine3 = Engine3;
window.Engine4 = Engine4;
window.Engine5 = Engine5;
window.Engine6 = Engine6;
window.Engine7 = Engine7;
window.Engine8 = Engine8;
window.Engine9 = Engine9;
window.Engine10 = Engine10;
window.PhysicsRNG = PhysicsRNG;
window.DEFAULT_SEED = DEFAULT_SEED;
