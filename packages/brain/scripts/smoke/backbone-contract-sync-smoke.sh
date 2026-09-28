#!/usr/bin/env bash
# Smoke: backbone-contract-sync — 主干活动契约 git→Brain→Notion（决策 0834e2fb / 92f6226b，任务 2fdd5f12）
# 验证（不连真库、不发网络；假 GitHub + 假 pool 走同步全链）：
#   1. 同步：仓库哈希变 → 拉 YAML → journey_steps 写契约副本 + 钉 commit 的正本链接；哈希不变不拉 YAML
#   2. Notion 属性：正本只读链接 / 契约哈希 / 后置条件探针 / 步骤清单齐
#   3. 接线：scheduler JOBS 挂 backbone-contract-sync 且在 scheduler-liveness 之前；迁移 482 + 回滚存在；smoke 登记 allowlist
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[backbone-contract-sync-smoke] 1. 同步全链（假 GitHub + 假 pool）"
node --input-type=module -e "
import { syncActivityContracts, buildBackboneActivityProps } from './src/activity-contract-sync.js';
const HEAD = 'b'.repeat(40);
const YAML = 'version: 1\ncapability: keyword_acquisition\nactivities:\n  - key: preflight\n    name: 预检\n    order: 1\n    version: 1.0.0\n    compatibility: backward\n    postconditions: [{ probe: pf_lock_acquired, asserts: 本 run 持有设备锁 }]\n    execution: { location: xian-m4, via: harvest-cron.sh }\n    invokers: [code]\n    steps: [{ key: acquire_device_lock, name: 拿设备锁, order: 1, check: lock-acquire rc=0 }]\n';
let yamlFetched = 0;
const mkFetch = (sha) => async (url) => {
  if (url.includes('/commits/main')) return { ok: true, text: async () => HEAD };
  if (url.includes('contracts.json')) return { ok: true, text: async () => JSON.stringify({ capabilities: { keyword_acquisition: { activities: { preflight: sha } } } }) };
  if (url.includes('keyword_acquisition.yaml')) { yamlFetched++; return { ok: true, text: async () => YAML }; }
  return { ok: false, status: 404, text: async () => '' };
};
const row = { id: 'r1', journey_id: 'J', capability_key: 'keyword_acquisition', activity_key: 'preflight', contract_sha256: null, status: 'planned' };
const writes = [];
const pool = { async query(text, params) {
  if (/FROM journey_steps/.test(text)) return { rows: [{ ...row }] };
  if (/UPDATE journey_steps SET name/.test(text)) { writes.push(params); Object.assign(row, { contract_sha256: params[3], contract: JSON.parse(params[2]), contract_source: params[4] }); }
  return { rows: [] };
} };
const deps = (sha) => ({ fetchFn: mkFetch(sha), resolveToken: async () => 't' });
const r1 = await syncActivityContracts(pool, deps('s1'));
if (r1.updated[0] !== 'keyword_acquisition.preflight' || writes.length !== 1) { console.error('FAIL 哈希变应写回', r1); process.exit(1); }
if (!row.contract_source.includes('/blob/' + HEAD + '/product-map/contracts/keyword_acquisition.yaml')) { console.error('FAIL 正本链接应钉 commit'); process.exit(1); }
const before = yamlFetched;
await syncActivityContracts(pool, deps('s1'));
if (yamlFetched !== before || writes.length !== 1) { console.error('FAIL 哈希不变不应拉 YAML/写库'); process.exit(1); }
const p = buildBackboneActivityProps({ ...row, promise: '中台显示可用小号数' });
const txt = (k) => p[k].rich_text.map((x) => x.text.content).join('');
if (!p['正本（只读·改请走 git）'].url.includes('zenithjoy-workspace')) { console.error('FAIL 缺只读正本链接'); process.exit(1); }
if (txt('契约哈希') !== 's1' || !txt('Postconditions').includes('pf_lock_acquired') || !txt('步骤清单').includes('acquire_device_lock')) { console.error('FAIL 属性缺项'); process.exit(1); }
console.log('哈希变才同步 / 正本钉 commit / 哈希不变零写 / Notion 只读标记 ✓');
"

echo "[backbone-contract-sync-smoke] 2. 接线"
grep -q "name: 'backbone-contract-sync'" src/scheduler-jobs.js || { echo "FAIL JOBS 未挂 backbone-contract-sync"; exit 1; }
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const s = readFileSync('src/scheduler-jobs.js', 'utf8');
if (s.indexOf(\"name: 'backbone-contract-sync'\") > s.indexOf(\"name: 'scheduler-liveness'\")) { console.error('FAIL scheduler-liveness 必须排最后'); process.exit(1); }
"
test -f migrations/482_backbone_activity_contracts.sql || { echo "FAIL 缺迁移 482"; exit 1; }
test -f migrations/rollback/482_backbone_activity_contracts.down.sql || { echo "FAIL 缺回滚 482"; exit 1; }
grep -q "backbone-contract-sync-smoke.sh" ../quality/smoke-allowlist.txt || { echo "FAIL smoke 未登记 allowlist"; exit 1; }
echo "[backbone-contract-sync-smoke] PASS"
