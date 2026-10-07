# Mathematical Audit: Microtubule Resonance Simulator (corrected)

**Status:** corrected 2026-10-07. This replaces an earlier draft (September 2026, "COMPLETE / INTEGRITY CERTIFIED") whose numbers did not match the engine. Every figure below comes from the engine at the commit this file ships with. Each figure is also checked weekly by the Flywheel math gate (`personal-infra/flywheel/adapters/microtubule/`, 28 checks against first-principles answers). For the full list of fixes, see [AUDIT-2026-10-05.md](AUDIT-2026-10-05.md).

## What the earlier draft got wrong

| # | Earlier claim | What is true | Source of the error |
|---|---|---|---|
| 1 | Header: "INTEGRITY CERTIFIED"; "193/193 checks pass" via `python test_lab.py` | `test_lab.py` never loads this simulator. Nothing was certified. | The verification step named a test suite for other sims |
| 2 | H1: coherent 36.0×, random 6.0× ± 1.4×, ratio 6.0× | The model's phases sum to **17.67** (49% of 36). Random **mean** is **5.32 ± 2.76** (Rayleigh, √(πN)/2, a large-N approximation), ratio **3.3×**. | 36 holds only if all phases are equal, which this model's are not. 6.0 is the RMS √N, not the mean. |
| 3 | H2 "genuinely falsified", 90% robust, 0 triplets for both geometries | **Inconclusive.** The engine dropped every n < 0 mode. With all modes counted and degenerate pairs merged, the helix gives 16 triplets vs a matched null's 95th percentile of 15. The single-run verdict holds in 2 of 9 nearby settings (27% in Engine 8). | Missing ±n pairs, and no null |
| 4 | H3: score scales 3.2× over 20× length | 0.088 → 0.048 (0.54×). Still "consistent", and still tautological. | Stale number |
| 5 | H5: peak at 12.0°, matching the MT pitch, α_c = 25° | The peak is at **4.0°** with α_c = 15° (the engine's value). Still inconclusive, 55% robust. | Stale parameter and number |
| 6 | H6: inverted-U SNR, 2.3× gain, "plausible" | **Inconclusive: not demonstrated at the model's drive**, by a test with positive and negative controls. See [H6 below](#h6-a-fair-stochastic-resonance-test). | The old SNR estimate counted the well offset as noise, and the old rule needed no peak |
| 7 | H7: 4/5 matches at a "5%" threshold, p = 0.179 | The threshold is \|log₁₀(f_pred/f_obs)\| < 0.05, a factor of 1.122 (−10.9%/+12.2%). Two of the four matches are ~10% off. p = **0.183** (seeded, 10,000 trials); still not significant. | log-distance mislabelled as percent |
| 8 | Energy: 16,250 dimers per MT, 162.5 nW, "16,250% of 1 nW" | The model uses **1 µm** microtubules: 13 × 125 = **1,625** dimers. Total = **16.25 nW**. The neuron budget is derived from ATP turnover: 4.7e9/s × 0.54 eV = **0.41 nW**. So it is **~40×** the budget. | The draft assumed 10 µm MTs and a 1 nW budget that contradicts the model's own ATP constants |
| 9 | Drag: 1.45e-10 W = 14.5% of budget (10 µm case); 1450% at 1 nm amplitude | For the draft's own 10 µm case, active dimers are 1.625e**7**, not 1.625e6, so peak drag is 145%. The model (1 µm, cycle-averaged ½·6πηr·v_max², 0.41 nW) gives **17.8%**. | Counting error (×10), and peak vs average (×2) |
| 10 | ATP: 1 nW ≈ 4.7e9 ATP/s, ATP = 5.4e-20 J "≈ 0.54 eV" | 5.4e-20 J is 0.34 eV; 0.54 eV is 8.65e-20 J. 4.7e9 × 5.4e-20 = 0.25 nW, not 1 nW. | Unit slip |
| 11 | Thermal: equipartition makes passive driving viable | E_conf = 1e-20 J = **2.3 kT**, Boltzmann weight 9.7%. Whether thermal kicks reach the needed switching rate needs an attempt frequency and a barrier, which the model lacks. The engine now reports **undetermined**. | The old test compared kT/2 · f with E · f · fraction, so it always passed |
| 12 | Theorem 1.1 "proves" H4 for the engine | The theorem assumes symmetric coupling k. Engine 1 couples forward 100× more strongly than back. The qualitative conclusion (the driven fast mode responds first) holds and the engine shows it (lead 79.6 µs), but the theorem is not a proof about this engine. | Model mismatch |
| 13 | Lundholm et al. 2015, *Structural Dynamics* 2:**054302** | The article number is **054702** (doi:10.1063/1.4931825). | Citation typo |
| 14 | Section 4: Fröhlich condensation is "the sole viable channel" | The engine does not model Fröhlich condensation at all. This is a literature opinion, not a result of this simulator. | Out of scope for the engine |

## What stands

- **Theorem 1.2 (phasor sums).** E\|Σe^{iθ}\|² = N exactly for independent uniform phases, so the RMS is √N = 6 for N = 36. The gate checks the engine against both √N (RMS) and √(πN)/2 (mean).
- **Theorem 1.3 (cylinder dispersion).** ω_{m,n} = v √((mπ/L)² + ((n + m tan α)/R)²) holds for every n. The engine now enumerates n = −12…12, and the gate checks every mode against this formula.
- **Section 3.3 (decoherence bounds).** Tegmark 2000 (~10⁻¹³ s) and Hagan, Hameroff & Tuszynski 2002 (~10⁻⁵–10⁻⁴ s) are cited correctly. The ~250× gap from 100 µs to 25 ms is right. The engine does not compute these.
- **The Fröhlich wavelength arithmetic.** 1600 m/s ÷ 0.2 THz = 8.0 nm.
- **The headline.** Active MHz switching is energetically implausible: ~40× the budget, and the verdict is unchanged.

## H6: a fair stochastic-resonance test

Stochastic resonance (SR) is a peak in signal-to-noise at an intermediate noise level. The test:

1. **Observable.** The coherent fundamental-to-residual power ratio of the two-state output sign(x), which counts well-to-well hops. This is not the spectral SNR against the local noise floor (switching noise is coloured, so the two can differ).
2. **Positive control.** The same double well driven slowly (f = 0.01). For dx = (x − x³ + A cos ωt)dt + D dW the barrier is ΔV = ¼ and the noise intensity is D²/2, so the weak-noise Kramers rate is r_K = (√2/2π) e^{−1/(2D²)}. The time-scale-matching heuristic r_K(D*) = ω/π (McNamara & Wiesenfeld 1989; Gammaitoni et al. 1998) gives **D\* = 0.454**. The control peaks at **D = 0.40**, so the method detects SR when it is there.
3. **Native drives** (0.7, 1.0, 1.4), each judged alone over D = 0.2–7.5, next to a **negative control** with no signal (A = 0). A frequency counts only with an interior peak at least 3× that baseline at the same noise. None meets it; each frequency's peak is about **1.0×** the baseline. Trajectories use a split step (the exact flow of x − x³, then drive and noise) that stays finite at large noise, and the result holds when dt is halved. Within the Kramers approximation, matching has no solution at these drives: it would need r_K ≥ 1.4, and the approximation tops out at 0.225. That approximation is not a bound on the true hopping rate at large noise, though.

**Verdict: inconclusive, not demonstrated at the model's drive.** It is not "falsified". The control shows the method works at a slow drive, but it does not prove that a native response is absent.

## Verification

```bash
python ~/projects/personal-infra/flywheel/adapters/microtubule/run_microtubule_math.py --dry-run
```

It scores the published engine (the `main` commit that GitHub Pages serves) against first-principles answers, and prints pass or fail with every failing check by name.
