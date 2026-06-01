#!/usr/bin/env bash
# Smoke test: dispatcher.js 对 harness_initiative 跳过 bridge guard
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

node --input-type=module -e "
import { readFileSync } from 'fs';
const src = readFileSync('./packages/brain/src/dispatcher.js', 'utf8');

if (!src.includes('harness_initiative')) {
  console.error('FAIL: harness_initiative bypass not found in dispatcher.js');
  process.exit(1);
}
if (!src.includes('needsBridgeCheck')) {
  console.error('FAIL: needsBridgeCheck logic missing');
  process.exit(1);
}
console.log('OK: harness-bridge-bypass smoke passed');
"
