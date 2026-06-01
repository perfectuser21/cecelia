#!/usr/bin/env bash
# Smoke test: plannerNode 在 harness-initiative.graph.js 中注入 initiative_runs 历史上下文
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

node --input-type=module -e "
import { readFileSync } from 'fs';

const src = readFileSync('./packages/brain/src/workflows/harness-initiative.graph.js', 'utf8');

if (!src.includes('fetchRunHistory')) {
  console.error('FAIL: fetchRunHistory comment missing in harness-initiative.graph.js');
  process.exit(1);
}

if (!src.includes('/api/brain/harness/runs?limit=10')) {
  console.error('FAIL: fetch call to /api/brain/harness/runs?limit=10 missing');
  process.exit(1);
}

if (!src.includes('runHistoryText')) {
  console.error('FAIL: runHistoryText variable missing');
  process.exit(1);
}

if (!src.includes('plannerPromptFinal')) {
  console.error('FAIL: plannerPromptFinal variable missing');
  process.exit(1);
}

if (!src.includes('Run历史')) {
  console.error('FAIL: Run历史 label missing in prompt injection');
  process.exit(1);
}

if (!src.includes('non-blocking')) {
  console.error('FAIL: non-blocking comment missing (fetch must be non-blocking)');
  process.exit(1);
}

console.log('OK: harness-planner-run-history smoke passed');
"
