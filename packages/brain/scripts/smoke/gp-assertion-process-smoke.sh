#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
node --input-type=module <<'NODE'
import { createAssertionExecutor } from './src/lib/gp-assertion-process.js';

try {
  createAssertionExecutor();
  process.exit(1);
} catch (error) {
  if (error.code !== 'TRUSTED_PROCESS_ADAPTER_REQUIRED') process.exit(1);
}
console.log('GP_ASSERTION_PROCESS_SMOKE_PASS');
NODE
