#!/usr/bin/env bash
set -euo pipefail
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
BRAIN_URL="${BRAIN_URL%/}"
BRAIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$BRAIN_ROOT"
RESPONSE="$(curl -fsS --max-time 15 "$BRAIN_URL/api/brain/okr/company-key-results")"
node --input-type=module - "$RESPONSE" <<'JS'
import assert from 'node:assert/strict';
const body = JSON.parse(process.argv[2]);
assert.equal(body.success, true);
assert.ok(Array.isArray(body.items));
console.info(`公司 KR 只读合同验证：${body.items.length} 条`);
JS
