#!/usr/bin/env node
// Recompute every figure the pages quote, from the fixed seed.
//
//   node scripts/recompute-figures.mjs            # print the receipt
//   node scripts/recompute-figures.mjs --seed N   # try another seed
//
// physics.js is browser-global (no modules, exports via window.*), so it is
// evaluated inside a node:vm context that provides `window` and `console`
// (Math and the other intrinsics come from the context itself). The engine functions called here are exactly the ones the
// simulator's "Run Computation" buttons and Meta-Analysis buttons call
// (HypothesisRunner.testH1..H7, Engine8.run, Engine9.run, Engine10.run), with
// the same options sim.js passes. The printed output is committed at
// docs/figures-<seed>.txt as the receipt for the numbers on index.html,
// simulator.html, whitepaper.html and README.md.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const physicsPath = resolve(here, '..', 'physics.js');
const source = readFileSync(physicsPath, 'utf8');

// The context gets its own intrinsics (Math, Array, JSON...) from
// createContext; only `window` (aliasing the global) and `console` are
// supplied. Passing the host Math in would make every Math.cos a
// cross-context call and slow the SDE engines ~10x.
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
// Global lookups inside a vm context go through the sandbox's interceptor
// and cost ~9x on the SDE engines (Engine 2 is ~320M Math.* calls per run).
// Binding Math in script scope keeps physics.js untouched and makes the
// harness finish in minutes instead of over an hour. Output is bit-identical.
const prelude = 'const Math = globalThis.Math;\n';
vm.runInContext(prelude + source, sandbox, { filename: 'physics.js', lineOffset: -1 });

const {
  PhysicsRNG, DEFAULT_SEED, PhysicsResults, HypothesisRunner,
  Engine8, Engine9, Engine10,
} = sandbox;

const argSeed = process.argv.indexOf('--seed');
const seed = argSeed >= 0 ? Number(process.argv[argSeed + 1]) : DEFAULT_SEED;
if (!Number.isInteger(seed)) throw new Error('--seed must be an integer');
if (seed !== DEFAULT_SEED) {
  // Override the default so every reseed() inside physics.js lands here.
  PhysicsRNG.reseed = () => PhysicsRNG.seed(seed);
}

const out = [];
const line = (s = '') => out.push(s);
const f = (x, d) => Number(x).toFixed(d);
const pct = (x, d = 1) => (x * 100).toFixed(d) + '%';

line(`Microtubule Resonance Simulator — figure receipt`);
line(`physics.js: ${physicsPath}`);
line(`seed: ${seed} (mulberry32)${seed === DEFAULT_SEED ? ' [DEFAULT_SEED]' : ''}`);
line(`node: ${process.version}`);
line();

// ---- Hypotheses H1..H7 (what "Run Computation" / "Run All" produce) -------
const results = {};
for (const id of ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7']) {
  results[id] = await HypothesisRunner.runTest(id);
}

// Reproducibility check: run H7 and H1 a second time, compare byte-for-byte.
const h7again = await HypothesisRunner.runTest('H7');
const h1again = await HypothesisRunner.runTest('H1');
const reproducible =
  JSON.stringify(h7again) === JSON.stringify(results.H7) &&
  JSON.stringify(h1again) === JSON.stringify(results.H1);

line('== Hypothesis verdicts (HypothesisRunner.testH1..H7) ==');
for (const [id, r] of Object.entries(results)) {
  line(`${id}: ${r.verdict}`);
  for (const [k, v] of Object.entries(r.metrics)) line(`    ${k}: ${v}`);
}
line();

// ---- H1 / Engine 3 --------------------------------------------------------
const e3 = PhysicsResults.engine3;
line('== H1 / Engine 3: Berry-phase coherence at N=36 (10,000 trials) ==');
line(`coherent amplitude (fractal, N=36): ${f(e3.coherentAmp[35], 2)}   (index/whitepaper: 1 d.p.)`);
line(`random amplitude mean:              ${f(e3.randomAmpMean[35], 2)} ± ${f(e3.randomAmpStd[35], 2)}   (index/whitepaper: 1 d.p.)`);
line(`sqrt(36) reference:                 6.00`);
line(`coherent/random ratio:              ${f(e3.ratio, 2)}x`);
line(`coherence efficiency:               ${pct(e3.coherentAmp[35] / 36)} of 36`);
line();

// ---- H7 / Engine 7 --------------------------------------------------------
const e7 = PhysicsResults.engine7;
line('== H7 / Engine 7: Schumann Monte Carlo null (10,000 trials, 5% log threshold) ==');
line(`observed matches:        ${e7.observedMatches}/5   (index/whitepaper)`);
line(`p-value:                 ${f(e7.pValue, 4)}   (3 d.p. ${f(e7.pValue, 3)})   (index/whitepaper/README: 3 d.p.)`);
line(`% random >= observed:    ${pct(e7.pValue)}   (index/whitepaper: 1 d.p.)`);
line(`random mean ± std:       ${f(e7.meanRandomMatches, 2)} ± ${f(e7.stdRandomMatches, 2)}   (index/whitepaper: 2 d.p.)`);
line(`match distribution 0..5: [${e7.matchDistribution.join(', ')}]`);
line(`significant (p<0.05):    ${e7.isSignificant}   verdict: ${results.H7.verdict}`);
line();

// ---- Engine 8 (Run Sensitivity Analysis) ----------------------------------
const e8 = Engine8.run({ perturbRange: 0.3, nSamples: 5 });
line('== Engine 8: Sensitivity (±30%, 5 steps/direction) ==');
for (const d of e8.summary.details) {
  const frag = d.fragileParams.length ? d.fragileParams.map(p => `${p.name} ${p.robustness}`).join(', ') : 'none';
  line(`${d.id}: ${pct(d.score)} (${d.robustness}; ${e8[d.id].matchingRuns}/${e8[d.id].totalRuns}; baseline ${e8[d.id].baselineVerdict}; fragile: ${frag})`);
}
line(`overall robustness: ${e8.summary.overallRobustness} across ${e8.summary.analyzed}   (index/whitepaper/README: 1 d.p.)`);
line(`(whitepaper §6.1 table: per-hypothesis %, nearest integer)`);
line();

// ---- Engine 9 (Run Structure Comparison) ----------------------------------
const e9 = Engine9.run({ nModes: 36, nRandomTrials: 10000 });
line('== Engine 9: Alternative structures, N=36 (random: 10,000 trials) ==');
e9.comparison.forEach((c, i) => {
  line(`${i + 1}. ${c.name.padEnd(30)} ${f(c.amplitude, 2).padStart(6)}   ${f(c.relativeToRandom, 2)}x random   ${c.efficiency}`);
});
line(`fractal rank: #${e9.fractalRank} of ${e9.comparison.length}; beats ${e9.fractalBeatsOthers}/${e9.totalAlternatives} alternatives; best alternative: ${e9.bestAlternative.name} at ${f(e9.bestAlternative.amplitude, 2)}`);
line(`(whitepaper §6.2 table: amplitudes to 1 d.p. and ranks; index: rank)`);
line();

// ---- Engine 10 (Run Energy Budget) — deterministic -----------------------
const e10 = Engine10.run();
line('== Engine 10: Energy budget (1 MHz, 1% active dimers) — deterministic ==');
line(`verdict:                 ${e10.verdict}`);
line(`power per MT:            ${e10.energetics.powerPerMT_watts.toExponential(3)} W (${e10.energetics.powerPerMT_label})   (whitepaper §6.3)`);
line(`total MT power (1e5):    ${e10.energetics.totalMTPower_watts.toExponential(3)} W (${e10.energetics.totalMTPower_label})   (whitepaper §6.3)`);
line(`fraction of budget:      ${e10.energetics.budgetFraction}   (whitepaper §6.3, index: "1625%", "16x")`);
line(`ATP/s needed:            ${e10.energetics.ATPperSecond}  (${e10.energetics.ATPbudgetFraction} of neuron ATP)`);
line(`kT/2 at 37C:             ${e10.thermal.thermalEnergyPerMode_J} J   (whitepaper §6.3)`);
line(`drag budget fraction:    ${e10.dissipation.dragBudgetFraction}`);
line();

line(`== Reproducibility ==`);
line(`H1 and H7 re-run with the same seed produced identical output: ${reproducible ? 'YES' : 'NO'}`);

process.stdout.write(out.join('\n') + '\n');
if (!reproducible) process.exit(1);
