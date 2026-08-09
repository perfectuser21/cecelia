#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../../.." && pwd)"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
cd "$ROOT_DIR"

node -e "
const fs = require('fs');
const migration = fs.readFileSync('packages/brain/migrations/395_workbench_projection.sql', 'utf8');
for (const table of ['projection_outbox', 'projection_links', 'projection_commands', 'projection_targets']) {
  if (!migration.includes(table)) throw new Error('migration 395 missing ' + table);
}
const routes = fs.readFileSync('packages/brain/src/routes/projections.js', 'utf8');
for (const endpoint of ['/projections/status', '/workbench/summary', '/workbench/activity']) {
  if (!routes.includes(endpoint)) throw new Error('projection route missing ' + endpoint);
}
console.log('[smoke] Workbench projection topology PASS');
"

if ! curl -sf --max-time 3 "$BRAIN_URL/api/brain/health" >/dev/null 2>&1; then
  echo "[smoke] Brain unavailable; topology verification completed"
  exit 0
fi

for endpoint in /api/brain/workbench/summary /api/brain/projections/status; do
  curl -sf --max-time 10 "$BRAIN_URL$endpoint" >/dev/null
  echo "[smoke] GET $endpoint PASS"
done

echo "[smoke] Workbench projection API PASS"
