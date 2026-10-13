#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../../../.." && pwd)"
report_file="$(mktemp)"
trap 'rm -f "$report_file"' EXIT
DB_NAME="${DB_NAME:-cecelia_scratch}" node "$repo_root/packages/brain/scripts/runtime-catalog-preflight.mjs" > "$report_file"
node - "$report_file" <<'JS'
const fs = require('node:fs');
const assert = require('node:assert/strict');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
assert.equal(report.production_migration_applied, false);
assert.equal(report.constraints.length, 4);
assert.equal(report.ready_for_identity_constraints, true);
assert.match(report.baseline.sha256, /^[a-f0-9]{64}$/);
assert.ok(report.constraints.every(c => c.available && c.mismatches === 0));
console.log('PASS: 版本身份与不可变历史只读预检');
JS
