#!/usr/bin/env node
/**
 * 闹钟总账静态快照导入（第二阶段第 4 步，任务 fe10d1a0，规则见 src/ops-alarm-import.js）。
 * 走正式 API（POST /api/brain/agent-ops/alarms/import），不直写生产库。
 *
 *   node scripts/ops/import-alarm-ledger-inventory.mjs            # 干跑：只打印规划摘要
 *   node scripts/ops/import-alarm-ledger-inventory.mjs --apply    # 真写（事务，幂等，可重跑）
 *
 * 环境变量：BRAIN_URL（默认 http://localhost:5221）、CECELIA_INTERNAL_TOKEN（Bearer）。
 * 先决条件：517 迁移已上产、scheduler-liveness 已跑过一轮（Brain job 行已落表，才能补挂树列）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const apply = process.argv.includes('--apply');
const base = (process.env.BRAIN_URL || 'http://localhost:5221').replace(/\/$/, '');
const token = process.env.CECELIA_INTERNAL_TOKEN;
const items = JSON.parse(readFileSync(join(here, 'inventory', 'alarm-ledger-20261004.json'), 'utf8'));

const res = await fetch(`${base}/api/brain/agent-ops/alarms/import`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ items, dry_run: !apply }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok || !body.success) {
  console.error(`导入失败 HTTP ${res.status}:`, JSON.stringify(body.error ?? body));
  process.exit(1);
}
console.log(JSON.stringify(body.data, null, 2));
console.log(apply ? '✅ 已写入' : '（干跑，未写入；确认后加 --apply）');
