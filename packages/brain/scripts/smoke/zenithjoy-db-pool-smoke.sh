#!/usr/bin/env bash
# Smoke: zenithjoy-db 可切换连接池（拆库刀1，决策 0710）
# 真加载 ESM 模块验证切换契约：env 未设=主池引用；设了=独立池指向目标库。
set -euo pipefail

echo "[zj-db-pool-smoke] 1. env 未设 → 返回主 pool 同一引用（向后兼容）"
node --input-type=module -e "
import defaultPool from './packages/brain/src/db.js';
import { getZenithjoyPool } from './packages/brain/src/zenithjoy-db.js';
if (getZenithjoyPool() !== defaultPool) { console.error('FAIL: 未设 env 应返回主池引用'); process.exit(1); }
console.log('主池引用 ✓');
"

echo "[zj-db-pool-smoke] 2. ZENITHJOY_DB_NAME 设置 → 独立池指向该库"
ZENITHJOY_DB_NAME=zenithjoy_smoke_probe node --input-type=module -e "
import defaultPool from './packages/brain/src/db.js';
import { getZenithjoyPool } from './packages/brain/src/zenithjoy-db.js';
const p = getZenithjoyPool();
if (p === defaultPool) { console.error('FAIL: 设了 env 不应返回主池'); process.exit(1); }
if (p.options.database !== 'zenithjoy_smoke_probe') { console.error('FAIL: database=' + p.options.database); process.exit(1); }
console.log('独立池 database=zenithjoy_smoke_probe ✓');
"

echo "[zj-db-pool-smoke] 3. execution.js 发布回执块已接线（源码契约）"
node -e "
const src = require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');
if (!src.includes(\"from '../zenithjoy-db.js'\")) { console.error('FAIL: execution.js 未 import zenithjoy-db'); process.exit(1); }
const block = src.slice(src.indexOf('content_publish 完成'), src.indexOf('小任务积累触发'));
if (!block.includes('zjPool.query')) { console.error('FAIL: 发布回执块未用 zjPool'); process.exit(1); }
console.log('execution.js 接线 ✓');
"

echo "[zj-db-pool-smoke] ✅ 全部通过"
