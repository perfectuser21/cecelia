/**
 * 依赖单一写口守卫（链 bf5088a3 棒5，任务 3fad28e0）。
 *
 * 依赖曾散在三处写：harness-dag 直 INSERT task_dependencies、proposal.js 直写 payload.depends_on、
 * 建单入口把 depends_on 当普通 payload。现在只允许 lib/task-dependencies.js 写；
 * gap-dependencies.js 是 Gap 账本边（带 gap_id / status，语义独立）显式白名单。
 * 变异测试证明守卫真会响：把违规写法塞进一份临时文件，扫描必须报出。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../', import.meta.url));

const WRITER_ALLOWLIST = new Set([
  'lib/task-dependencies.js',
  'impact-contract/gap-dependencies.js', // Gap 账本边：gap_id/status 语义，不是任务依赖写口
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

const EDGE_INSERT = /INSERT\s+INTO\s+task_dependencies/i;
// 写 payload.depends_on：jsonb_build_object('depends_on' / '{depends_on}' / JSON.stringify({ depends_on ...
const PAYLOAD_WRITE = /jsonb_build_object\(\s*'depends_on'|'\{depends_on\}'|JSON\.stringify\(\s*\{\s*depends_on\s*:/;

export function findViolations(files) {
  const bad = [];
  for (const { rel, text } of files) {
    if (WRITER_ALLOWLIST.has(rel)) continue;
    if (EDGE_INSERT.test(text)) bad.push({ rel, kind: 'edge_insert' });
    if (PAYLOAD_WRITE.test(text)) bad.push({ rel, kind: 'payload_depends_on_write' });
  }
  return bad;
}

const realFiles = walk(SRC).map((p) => ({ rel: relative(SRC, p), text: readFileSync(p, 'utf8') }));

describe('task_dependencies / payload.depends_on 单一写口', () => {
  it('src 内除写口模块外无人直写边或 payload.depends_on', () => {
    expect(findViolations(realFiles)).toEqual([]);
  });

  it('写口模块本身存在且含唯一的边 INSERT', () => {
    const w = realFiles.find((f) => f.rel === 'lib/task-dependencies.js');
    expect(w, 'lib/task-dependencies.js 必须存在').toBeTruthy();
    expect(w.text.match(/INSERT\s+INTO\s+task_dependencies/gi)).toHaveLength(1);
  });

  it('变异：把 harness-dag 改回直写边 → 守卫必红', () => {
    const dag = realFiles.find((f) => f.rel === 'harness-dag.js');
    const mutated = { rel: dag.rel, text: `${dag.text}\n// INSERT INTO task_dependencies (from_task_id, to_task_id) VALUES ($1,$2)` };
    expect(findViolations([mutated])).toEqual([{ rel: 'harness-dag.js', kind: 'edge_insert' }]);
  });

  it('变异：proposal.js 直写 payload.depends_on → 守卫必红', () => {
    const p = realFiles.find((f) => f.rel === 'proposal.js');
    const mutated = { rel: p.rel, text: `${p.text}\nconst x = JSON.stringify({ depends_on: newDeps });` };
    expect(findViolations([mutated])).toEqual([{ rel: 'proposal.js', kind: 'payload_depends_on_write' }]);
  });
});
