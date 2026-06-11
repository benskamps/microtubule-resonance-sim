# Microtubule Resonance Simulator

> 🌲 Part of the [Brokenbranch Lab](https://www.brokenbranch.dev/lab/) — one human and a cluster of AI agents shipping strange software in public. This is one experiment among many; the front door lists them all.

An interactive computational exploration of fractal electromagnetic resonance in biological nanostructures, based on findings by Bandyopadhyay et al. (2020, 2022).

**This is NOT peer-reviewed research.** It is an exploratory tool for sharpening questions and testing mathematical plausibility.

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

## Tech Stack

- Pure HTML / CSS / JavaScript (no frameworks, no build step)
- Canvas-based visualizations with `requestAnimationFrame`
- Physics engines: RK4 integration, Monte Carlo sampling, Berry phase computation, stochastic resonance analysis, energy budget calculation

## Key Results

| Hypothesis | Verdict | Notes |
|---|---|---|
| H1: Fractal Coherent Amplification | Plausible | Regular lattice beats fractal |
| H2: Chirality Creates Triplets | Falsified | Helical modes don't cluster |
| H3: Scale Invariance | Consistent | Tautological (model tests model) |
| H4: Temporal Cascade | Consistent | Expected from oscillator structure |
| H5: Pitch Angle Optimality | Inconclusive | Parameter-dependent (55% robust) |
| H6: Noise-Fueled Resonance | Plausible | SR present but parameters unconstrained |
| H7: Schumann Alignment | Unvalidated | p=0.179, not significant |

**Meta-analysis:** 86.3% overall robustness. Regular lattice beats fractal for amplification. Active oscillation energetically implausible (16x neuron budget).

## References

1. Bandyopadhyay, A. et al. "Fractal, Scale Free Electromagnetic Resonance of a Single Brain Extracted Microtubule Nanowire, a Single Tubulin Protein, and a Single Neuron." *Fractal and Fractional*, 2020.
2. Bandyopadhyay, A. "A century-old picture of the nerve impulse is wrong." *Communicative & Integrative Biology*, 2022.
3. Berry, M.V. "Quantal Phase Factors Accompanying Adiabatic Changes." *Proc. R. Soc. A*, 1984.
4. Gammaitoni, L. et al. "Stochastic Resonance." *Reviews of Modern Physics*, 1998.
5. Naaman, R. & Waldeck, D.H. "Chiral-Induced Spin Selectivity Effect." *J. Phys. Chem. Lett.*, 2012.

## Built With

Built as a collaboration between human scientific curiosity and [Claude Opus 4.6](https://www.anthropic.com/claude) (Anthropic).

## License

MIT License. See [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.
