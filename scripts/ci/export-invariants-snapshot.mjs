#!/usr/bin/env node
/**
 * export-invariants-snapshot.mjs — 导出 Brain invariant 全集快照供 CI 对账
 * ----------------------------------------------------------------------------
 * CI 环境没有 Brain/DB，check-invariant-coverage.mjs 在 CI 走快照模式。
 * 本脚本在本地（Brain 活着）执行，把 GET /api/brain/invariants 的结果
 * 精简后写入 config/invariants-snapshot.json（带 exported_at，超 30 天 CI 告警提醒刷新）。
 *
 * 用法：node scripts/ci/export-invariants-snapshot.mjs [--out config/invariants-snapshot.json]
 *       BRAIN_URL 覆盖默认 http://localhost:5221
 * 导出后 git commit 该文件。
 */
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : 'config/invariants-snapshot.json';
const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';

const res = await fetch(`${BRAIN_URL}/api/brain/invariants`, { signal: AbortSignal.timeout(5000) });
if (!res.ok) {
  console.error(`ERROR: GET ${BRAIN_URL}/api/brain/invariants → HTTP ${res.status}`);
  process.exit(1);
}
const rows = await res.json();
if (!Array.isArray(rows)) {
  console.error('ERROR: API 返回非数组');
  process.exit(1);
}

const snapshot = {
  exported_at: new Date().toISOString(),
  source: `${BRAIN_URL}/api/brain/invariants`,
  note: '由 scripts/ci/export-invariants-snapshot.mjs 导出；CI 无 Brain 时 check-invariant-coverage.mjs 读此文件',
  count: rows.length,
  invariants: rows.map((r) => ({
    id: r.id,
    topic: r.topic,
    priority: r.priority,
    created_at: r.created_at,
    // 内容摘要方便人认（完整内容以 Brain decisions 表为准）
    digest: (r.decision || '').slice(0, 120),
  })),
};

writeFileSync(OUT, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`✅ 已导出 ${rows.length} 条 invariant 快照 → ${OUT} (exported_at=${snapshot.exported_at})`);
