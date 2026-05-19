#!/usr/bin/env bash
set -euo pipefail

# Smoke: verify harness schema validation exports are loadable
node -e "
import('./packages/brain/src/harness-shared.js').then(m => {
  if (!m.ReviewerOutputSchema) throw new Error('ReviewerOutputSchema not exported');
  if (!m.EvaluatorOutputSchema) throw new Error('EvaluatorOutputSchema not exported');
  if (!m.readAndValidateBrainResult) throw new Error('readAndValidateBrainResult not exported');
  console.log('harness-schema-validation smoke: OK');
}).catch(e => { console.error(e.message); process.exit(1); });
"
