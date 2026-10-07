# Microtubule Resonance Simulator

> 🌲 Part of the [Brokenbranch Lab](https://www.brokenbranch.dev/labs/) — one human and a cluster of AI agents shipping strange software in public. This is one experiment among many; the front door lists them all.

An interactive computational exploration of fractal electromagnetic resonance in biological nanostructures, based on findings by Bandyopadhyay et al. (2020, 2022).

**This is NOT peer-reviewed research.** It is an exploratory tool for sharpening questions and testing mathematical plausibility.

## Status: 🟡 Complete (exploratory tool — not formally validated)

**This experiment is finished, not abandoned.** It shipped its full result set in one publication and reached its intended scope: 7 hypotheses tested honestly, with negative and undecided results reported as such. A 2026-10-05 math audit corrected several engines: H2 (chirality) moved from falsified to inconclusive, and H6 (stochastic resonance) from plausible to inconclusive, now tested with positive and negative controls. H7 (Schumann alignment, p=0.183) stays not significant. There is no open backlog. If you find it sitting still, that stillness is *done*, not neglect.

It remains 🟡 (an exploratory **toy**, not a validated result) by design. It has **not** formally passed the Brokenbranch Lab validation gate (the "Four Tests" — reproduced, externally checked, pre-registered, and survives adversarial review). Promoting it to 🟢 would require, at minimum:

- an independent reproduction of the simulator's key results from the published parameters,
- external review of the physics engines (especially the H5 pitch-angle robustness and H6 stochastic-resonance parameterization),
- a pre-registered hypothesis set rather than the post-hoc meta-analysis presented here, and
- adversarial review of the model-tests-model concerns flagged in H3 (scale invariance is tautological as built).

None of those have been done, so the honest label stays 🟡. The value here is the *honesty of the negative results*, not a validated claim.

## Reproducibility

Monte Carlo runs use a fixed seed (`20260906`, mulberry32, `DEFAULT_SEED` in `physics.js`); `node scripts/recompute-figures.mjs` reprints every figure the pages quote, and `docs/figures-20260906.txt` is the committed receipt.

## Quick Start

1. Clone the repository
2. Open `index.html` in a browser (or deploy to any static host)
3. No build step, no dependencies, no server required

## Structure

| File | Purpose |
|------|---------|
| `index.html` | Landing page with context, results summary, and explanations |
| `simulator.html` | The interactive simulator (5 panels + hypothesis lab + meta-analysis) |
| `whitepaper.html` | Detailed technical methodology and results |
| `sim.js` | Visualization and UI logic (~85 KB) |
| `physics.js` | 10 computational engines (~72 KB) |
| `style.css` | Simulator design system |
| `landing.css` | Landing page styles |
| `whitepaper.css` | Whitepaper reading styles |
| `assets/og.png` | Open Graph / Twitter card image (1200×630) |
| `scripts/recompute-figures.mjs` | Node harness: recomputes every quoted figure from the fixed seed |
| `docs/figures-20260906.txt` | Receipt: the harness output the pages' numbers come from |
| `docs/SYNC-DESIGN.md` | How brokenbranch.dev mirrors this repo (daily pull, verbatim) |

## Tech Stack

- Pure HTML / CSS / JavaScript (no frameworks, no build step)
- Canvas-based visualizations with `requestAnimationFrame`
- Physics engines: RK4 integration, Monte Carlo sampling, Berry phase computation, stochastic resonance analysis, energy budget calculation

## Key Results

| Hypothesis | Verdict | Notes |
|---|---|---|
| H1: Fractal Coherent Amplification | Plausible | Regular lattice beats fractal |
| H2: Chirality Creates Triplets | Inconclusive | With all modes counted, the helix's triplet count sits inside a matched random-splitting null (was "Falsified" before the 2026-10-05 audit) |
| H3: Scale Invariance | Consistent | Tautological (model tests model) |
| H4: Temporal Cascade | Consistent | Expected from oscillator structure |
| H5: Pitch Angle Optimality | Inconclusive | Parameter-dependent (55% robust) |
| H6: Noise-Fueled Resonance | Inconclusive (not demonstrated at the model's drive) | Fair test: driven slowly (f = 0.01), the same double well peaks at noise D = 0.40, close to the D* = 0.45 where the Kramers escape rate matches the drive; but at the model's own drive (0.7 to 1.4), across noise D = 0.2 to 7.5, no frequency responds more than 2.2x above a run with no signal at all, so stochastic resonance is not demonstrated there. |
| H7: Schumann Alignment | Unvalidated | p=0.183, not significant |

**Meta-analysis:** 75.7% overall robustness (recomputed after the audit and the fair H6 test). Regular lattice beats fractal for amplification. Active oscillation energetically implausible (~40x neuron budget).

**2026-10-05 math audit:** the Flywheel math gate found errors in several engines and hypothesis tests; two verdicts changed (H2, H6). Every fix and its check are listed in [AUDIT-2026-10-05.md](AUDIT-2026-10-05.md).

## References

1. Bandyopadhyay, A. et al. "Fractal, Scale Free Electromagnetic Resonance of a Single Brain Extracted Microtubule Nanowire, a Single Tubulin Protein, and a Single Neuron." *Fractal and Fractional*, 2020.
2. Bandyopadhyay, A. "A century-old picture of the nerve impulse is wrong." *Communicative & Integrative Biology*, 2022.
3. Berry, M.V. "Quantal Phase Factors Accompanying Adiabatic Changes." *Proc. R. Soc. A*, 1984.
4. Gammaitoni, L. et al. "Stochastic Resonance." *Reviews of Modern Physics*, 1998.
5. Naaman, R. & Waldeck, D.H. "Chiral-Induced Spin Selectivity Effect." *J. Phys. Chem. Lett.*, 2012.

## Built With

Built with [Claude](https://www.anthropic.com/claude) agents (Anthropic), as a collaboration between human scientific curiosity and AI computational capability. This repo is the source of truth; <https://www.brokenbranch.dev/labs/microtubule/> pull-mirrors it daily (see `docs/SYNC-DESIGN.md`).

## License

MIT License. See [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.
