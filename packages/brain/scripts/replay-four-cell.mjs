#!/usr/bin/env node
// replay-four-cell.mjs — 件1 验收:拿最近 N 个真实任务回放四格分类,输出分布与逐条判定。
// 用法: DATABASE_URL=... node scripts/replay-four-cell.mjs [N=30]
import pg from 'pg';
import { classifyArtifactKind, classifyAnswerKnown } from '../src/work-router.js';

const n = Number(process.argv[2] ?? 30);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgres://administrator@localhost:5432/cecelia' });
const { rows } = await pool.query(
  `SELECT id, title, task_type, payload, description FROM tasks
   WHERE created_at > now() - interval '30 day' AND task_type NOT IN ('notion_synced')
   ORDER BY created_at DESC LIMIT $1`, [n],
);
const dist = {};
for (const t of rows) {
  const req = { ...t, payload: t.payload ?? {}, change_kind: t.payload?.change_kind };
  const ak = classifyArtifactKind(req);
  const known = classifyAnswerKnown(req);
  const cell = `${ak}/${known ? 'known' : 'unknown'}`;
  dist[cell] = (dist[cell] ?? 0) + 1;
  console.log(`${cell.padEnd(18)} ${t.task_type.padEnd(20)} ${String(t.title).slice(0, 46)}`);
}
console.log('\n分布:', JSON.stringify(dist));
await pool.end();
