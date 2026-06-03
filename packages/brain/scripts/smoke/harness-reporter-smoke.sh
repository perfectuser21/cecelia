#!/bin/bash
set -e

# Smoke: reportNode payload 含 gan_rounds / gan_cost_usd
node -e "
const fs = require('fs');
const code = fs.readFileSync('packages/brain/src/workflows/harness-initiative.graph.js', 'utf8');
if (!code.includes('gan_rounds: state.ganResult?.rounds || 0')) {
  console.error('FAIL: gan_rounds not found in reportNode harness_report payload');
  process.exit(1);
}
if (!code.includes('gan_cost_usd: state.ganResult?.cost_usd || 0')) {
  console.error('FAIL: gan_cost_usd not found in reportNode harness_report payload');
  process.exit(1);
}
console.log('✅ harness-reporter smoke: gan_rounds + gan_cost_usd 已加入 reportNode payload');
"
