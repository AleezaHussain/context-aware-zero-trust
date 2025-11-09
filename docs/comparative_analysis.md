# Comparative analysis: Zero‑Trust → Zero‑Trust + Context → Zero‑Trust + Context + Privacy (HE + IPE)

This document shows how to run three experiment configurations using the repository's existing harness and how to collect and compare the resulting performance and privacy-disclosure (PDS) metrics. I do not modify your existing project files — this is an extra, standalone report and helper script is provided below.

## Goal
Produce a concise side-by-side comparison of:

- Performance (TPS, latencies) and crypto costs (HE/IPE encryption times, proof times)
- Privacy metrics (R_struct, R_chain, R_policy, PDS, privacy leakage probabilities)

for these three setups:

1) Zero‑Trust only (device signatures + gateway attestation) — no encryption or attestation sidecar.
2) Zero‑Trust + Context‑aware enforcement (gateway validates context and may block or allow based on rules).
3) Zero‑Trust + Context‑aware + Privacy‑preserving (HE for numeric aggregates + IPE for attribute attestations; hybrid-enc mode).


## Files added (non-destructive)
- `docs/comparative_analysis.md` (this file) — methodology, commands, sample results and interpretation.
- `tools/compare_metrics.js` — a small Node script that reads `metrics_summary.json` files and prints/saves a side-by-side comparison. This file is additive only and does not change existing code.


## How the repo maps to the scenarios (quick)
- Zero‑Trust primitives (signatures, nonces, roles, gateway): implemented in `contracts/ContextAwareSmartContract.sol` and exercised by the compute harness `scripts/compute_pds_and_perf.js`.
- Context checks: implemented in `scripts/compute_pds_and_perf.js` via `validateContext()` (status, location zone, freshness, role). Gateway blocks or allows accordingly.
- Privacy-preserving:
  - HE (Paillier) numeric encryption: used when `--mode hybrid-enc` or `--mode hybrid-zk` and when `crypto/paillier_keys.json` is present. Keys are generated with `node ./scripts/gen_paillier_keys.js`.
  - IPE (inner-product / attribute attestations): the harness uses a sidecar at `--ipe-url`, and if unavailable it falls back to an emulator.
  - ZK (circom) path: `--mode hybrid-zk` attempts to build a Groth16 proof using the `circuits/context_policy.circom` circuit and `snarkjs`. This requires the heavier toolchain and is optional.


## Exact commands (PowerShell) to run the three scenarios

Note: these commands do not modify project sources. They create output JSON inside `build/` that you can feed into the comparer.

Prerequisites (only for scenario 3):
- Node.js and npm installed (you already used them).
- Optional: `circom` + `snarkjs` if you plan to run `--mode hybrid-zk`.

1) Zero‑Trust only (no encryption, no IPE)

- This runs the harness with the default submission path (gatewaySubmit) — the harness verifies device signatures and sends transactions; it does not perform Paillier/IPE encryption when no keys or `--mode` is set.

PowerShell:

```powershell
# run with 6 devices × 3 updates, simulate two failing devices 0 and 3 using invalid signatures
node .\scripts\compute_pds_and_perf.js --devices 6 --updates 3 --failDevices "0,3" --failMode invalidSig --verbose
```

Result: `build/metrics_summary.json` will be created (overwrite if present) — copy it to a safe filename if you want to keep previous runs (see compare script usage below).


2) Zero‑Trust + Context‑aware (gateway enforces context and may block)

- To emphasize context enforcement, use the `--failMode contextInvalid` option so the harness will create context violations for the specified devices and record blocking at the gateway.

PowerShell:

```powershell
node .\scripts\compute_pds_and_perf.js --devices 6 --updates 3 --failDevices "0,3" --failMode contextInvalid --verbose
```

Result: `build/metrics_summary.json` is produced with PDS numbers that reflect more blocked transactions and different R_policy/R_struct values.


3) Zero‑Trust + Context‑aware + Privacy‑preserving (HE + IPE) — hybrid-enc

- Before running: generate Paillier keys (the harness expects `crypto/paillier_keys.json`):

```powershell
node .\scripts\gen_paillier_keys.js
```

- Then, run the harness in hybrid-enc mode. The harness will use Paillier for numeric encryption and an IPE emulator or sidecar for attributes. If you have an IPE emulator at `http://127.0.0.1:8787`, supply `--ipe-url`; otherwise the harness will emulate IPE locally.

PowerShell:

```powershell
node .\scripts\compute_pds_and_perf.js --devices 6 --updates 3 --mode hybrid-enc --ipe-url http://127.0.0.1:8787 --failDevices "0,3" --failMode invalidSig --verbose
```

Result: `build/metrics_summary.json` will include `crypto.t_HE_enc_ms`, `crypto.t_IPE_ms`, and PDS values that consider ciphertext usage (R_chain.r_C will be 1 for hybrid modes). We already ran this mode and included sample numbers below.


## Reproducing the three runs without overwriting (recommended)

After each run, rename the generated JSON so you can compare them later:

```powershell
# after run 1
Move-Item -Path build\metrics_summary.json -Destination build\metrics_zerotrust.json
# after run 2
Move-Item -Path build\metrics_summary.json -Destination build\metrics_zerotrust_context.json
# after run 3
Move-Item -Path build\metrics_summary.json -Destination build\metrics_zerotrust_context_privacy.json
```


## Quick sample results (from a prior run of hybrid-enc)
The `build/metrics_summary.json` produced previously (hybrid-enc) contained these excerpts:

- Performance
  - TPS: 0.412
  - totalCommitted: 12
  - latency_p50: 446 ms, latency_p95: 606 ms
  - t_HE_enc_avg: ~1168.8 ms (per-sample Paillier encrypt)
  - t_IPE_enc_avg: ~0.167 ms (IPE emulation)

- Privacy / PDS
  - R_struct: 0.6833
  - R_chain: 0.4824
  - R_policy: 0.49
  - PDS: 0.5442
  - PDS_reliability: 0.5927
  - PDS_risk: 0.4073

- Verification
  - totalAttempts: 18, successful: 12, failures: 6 (failed devices correspond to those you simulated)

- Crypto samples
  - t_HE_enc_ms array values (per-encrypt timings, ms): [1229,1099,1215,...]
  - gas_verify_avg: ~836,584 (if ZK or verify paths were used)

- summary_pds.json (lightweight PDS scenario) contained two example scenarios A and B; A had combinedPDS=1.0, B had combinedPDS=0.5.

These numbers are included as a concrete example in the comparison table you will build after running the three scenarios.


## Using the helper script `tools/compare_metrics.js`
I added `tools/compare_metrics.js` which loads any number of `metrics_summary.json` outputs and prints a Markdown table comparing key numbers (TPS, latency p50/p95, t_HE_enc_avg, PDS). Example usage (PowerShell):

```powershell
# compare three files you saved earlier
node .\tools\compare_metrics.js build\metrics_zerotrust.json build\metrics_zerotrust_context.json build\metrics_zerotrust_context_privacy.json
```

The script prints a Markdown table to stdout and writes `build/compare_results.json` with the structured comparison.


## Interpretation guidance (how to read the numbers)
- Latency & TPS: hybrid-enc increases latency (big HE cost) — expect TPS to drop and p50/p95 to grow when HE is used.
- PDS: adding context-awareness reduces some disclosure risk (R_policy may improve because gateway blocks obvious violations), but adding HE/IPE increases confidentiality (R_chain.r_C becomes 1), which should push PDS up (better privacy) while increasing computational cost.
- Trade-off index: use `summary.comparison.deltaPDS` and `summary.comparison.deltaTPS_pct` to quantify privacy-per-performance trade-offs (the harness computes these when you supply `--baseline` to compare against a baseline JSON file).


## Next steps & options
- I can run the three experiments automatically and produce the saved JSONs and the comparison table for you — but I won't run heavy experiments without your permission. If you want me to run them here, tell me which modes to run and whether to reuse your prior run outputs.
- If you want the comparison output in CSV or plotted charts, I can add a small script to do that as well.


---

If you'd like, I can now (choose one):
- (A) Run the three experiments for you and produce `build/metrics_*` JSONs and a comparison table (this will execute the harness and use CPU/time).
- (B) Only produce the comparison table from the existing JSONs (if you already ran and stored them).
- (C) Add a small CSV/plot generator for richer reporting.

Tell me which option to proceed with. I will not run experiments unless you confirm.