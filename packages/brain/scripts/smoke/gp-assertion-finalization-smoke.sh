#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRAIN_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$BRAIN_DIR"

node --input-type=module <<'NODE'
import {
  normalizeContractState,
  sameContractState,
} from './src/lib/gp-assertion-finalization.js';

const hash = 'a'.repeat(64);
const signed = {
  hasHistory: true,
  signed: { id: 'contract-smoke', content_hash: hash },
};
const frozen = normalizeContractState(signed);
if (frozen.id !== 'contract-smoke' || frozen.hash !== hash) process.exit(1);
if (!sameContractState(frozen, signed)) process.exit(1);
if (sameContractState(frozen, {
  ...signed,
  signed: { ...signed.signed, content_hash: 'b'.repeat(64) },
})) process.exit(1);
console.log('GP_ASSERTION_FINALIZATION_SMOKE_PASS');
NODE
