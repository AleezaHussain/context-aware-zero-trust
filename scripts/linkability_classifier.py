#!/usr/bin/env python3
# scripts/linkability_classifier.py
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import cross_val_score, StratifiedKFold
import numpy as np
import sys

csv = sys.argv[1] if len(sys.argv)>1 else 'runs/per_tx.csv'
df = pd.read_csv(csv)

# Build feature vector. Adjust columns to match your per_tx.csv
for c in ['t_HE_enc_ms','gas_used','calldata_bytes','ct_numeric_bytes']:
    if c not in df.columns:
        df[c] = 0
X = df[['t_HE_enc_ms','gas_used','calldata_bytes','ct_numeric_bytes']].fillna(0).values
y = df['device_id'].astype(str).values

clf = RandomForestClassifier(n_estimators=200, random_state=42)
cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
scores = cross_val_score(clf, X, y, cv=cv, scoring='accuracy')
acc = scores.mean()
K = len(np.unique(y))
SE_norm = (acc - 1.0/K) / (1 - 1.0/K) if K>1 else 0.0
print("Accuracy (CV mean):", acc)
print("Devices K:", K)
print("SE_norm:", SE_norm)
with open('runs/linkability_result.txt','w') as f:
    f.write(f"acc={acc}\nSE_norm={SE_norm}\nK={K}\n")
print('Saved runs/linkability_result.txt')
