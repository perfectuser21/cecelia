#!/bin/bash
set -e
# Smoke: judge evidence truncation fix
# Task: ea20ba86-9ce4-4fbf-84cd-987a8b3f5ba6
# Sprint: 07151610-judge-evidence-truncation

echo "Checking compressBrainResult exported..."
node -e "const { compressBrainResult } = require('./packages/brain/src/harness-judge.js'); if (typeof compressBrainResult !== 'function') { console.error('FAIL: compressBrainResult not exported'); process.exit(1); }"

echo "Checking old truncation pattern removed..."
if grep -q "JSON.stringify(brainResult).slice(0, 2000)" packages/brain/src/harness-judge.js; then
  echo "FAIL: old truncation pattern still present"
  exit 1
fi

echo "OK: judge-evidence-truncation smoke passed"
