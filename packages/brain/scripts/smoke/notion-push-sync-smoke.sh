#!/usr/bin/env bash
# notion-push-sync smoke — 验证 pushDecisions/pushInitiativeContracts + migration 284
set -euo pipefail
BRAIN_CONTAINER="${BRAIN_CONTAINER:-cecelia-brain-smoke}"
if ! docker ps --format '{{.Names}}' | grep -q "^${BRAIN_CONTAINER}$"; then
  echo "[notion-push-sync smoke] SKIP — brain container ${BRAIN_CONTAINER} not running"
  exit 0
fi
docker exec "$BRAIN_CONTAINER" node --input-type=module -e "
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
const src = readFileSync('./src/notion-push-sync.js', 'utf8');
const checks = [
  { name: 'pushDecisions defined', test: () => src.includes('async function pushDecisions') },
  { name: 'pushInitiativeContracts defined', test: () => src.includes('async function pushInitiativeContracts') },
  { name: 'notion_synced_at IS NULL filter', test: () => src.includes('notion_synced_at IS NULL') },
  { name: 'notion_synced_at=NOW() update', test: () => src.includes('notion_synced_at=NOW()') || src.includes('notion_synced_at = NOW()') },
  { name: 'runNotionPushSync calls pushDecisions', test: () => { const idx=src.indexOf('export async function runNotionPushSync'); return idx>-1 && src.slice(idx).includes('pushDecisions('); } },
  { name: 'runNotionPushSync calls pushInitiativeContracts', test: () => { const idx=src.indexOf('export async function runNotionPushSync'); return idx>-1 && src.slice(idx).includes('pushInitiativeContracts('); } },
  { name: 'error catch+warn', test: () => src.includes('console.warn') && (src.includes('.catch(') || src.includes('} catch')) },
];
let fail=false;
for (const c of checks) {
  if (!c.test()) { console.error('FAIL:', c.name); fail=true; }
}
const migDir = './migrations';
const sqlFiles = readdirSync(migDir).filter(f => f.endsWith('.sql'));
const migOk = sqlFiles.some(f => {
  const c = readFileSync(join(migDir, f), 'utf8');
  return c.includes('decisions') && c.includes('notion_synced_at') && c.includes('initiative_contracts');
});
if (!migOk) { console.error('FAIL: migration 284 未覆盖两表'); fail=true; }
if (fail) process.exit(1);
console.log('[notion-push-sync smoke] PASS');
" || { echo "[notion-push-sync smoke] FAIL"; exit 1; }
