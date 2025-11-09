# Repro (minimal)

Commands used to reproduce the minimal validation reported in `runs/attacks_results.csv`.

1) Run hybrid privacy experiment (produces `build/metrics_summary.json`):

```powershell
node .\scripts\compute_pds_and_perf.js --devices 6 --updates 3 --mode hybrid-enc --ipe-url http://127.0.0.1:8787 --verbose
```

2) Run the chain-level replay test (example txHash shown; replace with an actual mined tx hash from your run logs):

```powershell
node .\scripts\replay_attack.js chain 0x9a23716c0ceda17d82ea3e7eb2ae9b1dfd606b9695c727a9b12d3fda918a32b0
```

3) Run the tamper-after-sign test against a captured signed payload (example):

```powershell
node .\scripts\tamper_attack.js aftersign runs/payload_dev01.json http://127.0.0.1:3000/submit
```

4) Export per-tx CSV (if needed):

```powershell
node .\scripts\export_per_tx_from_metrics.js A3
```

5) Run the linkability classifier (requires Python packages `pandas` and `scikit-learn`):

```powershell
pip install pandas scikit-learn
python .\scripts\linkability_classifier.py runs\per_tx.csv
```

Notes:
- If Ganache/RPC is not running, start it before running the scripts.
- Replace example tx hashes and payload paths with the actual values from your run logs.
