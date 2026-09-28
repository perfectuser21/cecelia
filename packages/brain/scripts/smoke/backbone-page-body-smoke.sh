#!/usr/bin/env bash
# Smoke: backbone-page-body — Backbone Activities 契约写入 Notion 页面正文（任务 d852c852，决策 0834e2fb 单向只读）
# 验证（不连真库、不发网络；假 notionReq + 假 pool）：
#   1. 正文首块是只读提示（链回 git 正本），含后置条件探针；指纹不变第二轮零 Notion 调用
#   2. 接线：job 在推属性后写正文；迁移 483 + 回滚存在；smoke 登记 allowlist
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[backbone-page-body-smoke] 1. 页面正文（只读提示在首块 + 含后置条件 + 指纹不变零调用）"
node --input-type=module -e "
import { buildBackboneActivityBody, syncBackboneBodies } from './src/activity-contract-sync.js';
const r = { id: 'r1', notion_id: 'p1', capability_key: 'keyword_acquisition', activity_key: 'preflight', contract_sha256: 'c'.repeat(64),
  contract_source: 'https://github.com/perfectuser21/zenithjoy-workspace/blob/x/product-map/contracts/keyword_acquisition.yaml',
  contract: { name: '预检', version: '1.0.0', postconditions: [{ probe: 'pf_lock_acquired', asserts: '持锁' }], steps: [{ key: 'acquire_device_lock', name: '拿设备锁', order: 1, check: 'rc=0' }] } };
const b = buildBackboneActivityBody(r);
if (b[0].type !== 'callout' || !JSON.stringify(b[0]).includes('只读')) { console.error('FAIL 首块应为只读提示'); process.exit(1); }
if (!JSON.stringify(b[0]).includes(r.contract_source)) { console.error('FAIL 只读提示应链回 git 正本'); process.exit(1); }
if (!JSON.stringify(b).includes('探针 pf_lock_acquired')) { console.error('FAIL 正文缺后置条件'); process.exit(1); }
let calls = 0; const notionReq = async (_t, p, m) => { calls++; return m === 'GET' ? { results: [], has_more: false } : {}; };
let digest = null;
const pool = { async query(t, p) { if (/FROM journey_steps/.test(t)) return { rows: [{ ...r, notion_body_digest: digest }] }; if (/notion_body_digest =/.test(t)) digest = p[1]; return { rows: [] }; } };
await syncBackboneBodies(pool, 'tok', { notionReq });
const first = calls;
await syncBackboneBodies(pool, 'tok', { notionReq });
if (first === 0 || calls !== first) { console.error('FAIL 指纹不变应零调用', first, calls); process.exit(1); }
console.log('正文首块只读且链回正本 / 含后置条件 / 指纹不变零调用 ✓');
"

echo "[backbone-page-body-smoke] 2. 接线"
grep -q "syncBackboneBodies(p, token())" src/activity-contract-sync.js || { echo "FAIL job 未接正文同步"; exit 1; }
test -f migrations/483_backbone_body_digest.sql || { echo "FAIL 缺迁移 483"; exit 1; }
test -f migrations/rollback/483_backbone_body_digest.down.sql || { echo "FAIL 缺回滚 483"; exit 1; }
grep -q "backbone-page-body-smoke.sh" ../quality/smoke-allowlist.txt || { echo "FAIL smoke 未登记 allowlist"; exit 1; }
echo "[backbone-page-body-smoke] PASS"
