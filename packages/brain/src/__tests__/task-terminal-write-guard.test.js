/**
 * 任务终态写入守卫（链 bf5088a3 第 2 棒，决策 105a5868 / ec7bf540）
 *
 * 09-22 七层审计：接棒只挂在 PATCH /tasks 一条路径，executor / monitor-loop / crystallize /
 * attempt-run 直接 `UPDATE tasks SET status='completed'` 绕过；openclaw 写 completed_no_pr 不被接棒。
 * 本守卫机械化：
 *  ① 生产源码里任何 `UPDATE tasks … SET … status = '<终态>'` 只能出现在 lib/task-terminal.js；
 *  ② 任何参数化 `status = $N` / `status = $${…}` 的 tasks 写入者必须登记在 TASK_STATUS_WRITER_REGISTRY；
 *  ③ 登记为「可能写终态」的模块源码必须调用 afterTerminalTransition( 或 finalizeTask(；
 *  ④ 登记表不许有幽灵条目（模块不存在 / 已不再参数化写 status）。
 *
 * proven-to-fire：`scanTerminalWrites` 对一段直写终态的源码必须报违规（见末尾用例）。
 */
import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { TASK_STATUS_WRITER_REGISTRY, TERMINAL_WRITE_HUB_MODULE } from '../lib/task-terminal.js';
import { TERMINAL_STATUSES } from '../lib/task-status-transitions.js';

const SOURCE_ROOT = fileURLToPath(new URL('..', import.meta.url));

async function listProductionModules(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const modules = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      modules.push(...await listProductionModules(absolute));
    } else if (entry.isFile() && entry.name.endsWith('.js') && !/\.(test|spec)\.js$/.test(entry.name)) {
      modules.push(absolute);
    }
  }
  return modules;
}

const TERMINAL_ALT = TERMINAL_STATUSES.join('|');
const LITERAL_IN_SET = new RegExp(`\\bstatus\\s*=\\s*'(?:${TERMINAL_ALT})'`);
const PARAM_IN_SET = /\bstatus\s*=\s*\$/;
const LITERAL_PUSH = new RegExp(`\\b(?:set\\w*|updates?)\\.push\\(\\s*[\`'"]\\s*status\\s*=\\s*'(?:${TERMINAL_ALT})'`, 'i');
// 覆盖两种动态拼装：`updates.push(\`status = $${i}\`)` 与 `const updates = ['status = $2']`
const PARAM_PUSH = /\b(?:set\w*|updates?)(?:\.push\(|\s*=\s*\[)\s*[`'"]\s*status\s*=\s*\$/i;
const UPDATE_TASKS = /UPDATE\s+(?:public\.)?tasks\b/g;

/** 取每条 UPDATE tasks 语句的 SET 段（到第一个 WHERE 或 1500 字符为止）。 */
export function extractSetSegments(source) {
  const segments = [];
  for (const match of source.matchAll(UPDATE_TASKS)) {
    const rest = source.slice(match.index, match.index + 1500);
    const whereAt = rest.search(/\bWHERE\b/);
    segments.push(whereAt === -1 ? rest : rest.slice(0, whereAt));
  }
  return segments;
}

/** 扫描一段源码：返回 { literal: boolean, parametric: boolean }。 */
export function scanTerminalWrites(source) {
  const segments = extractSetSegments(source);
  const hasUpdateTasks = segments.length > 0;
  const literal = segments.some((s) => LITERAL_IN_SET.test(s)) || (hasUpdateTasks && LITERAL_PUSH.test(source));
  const parametric = segments.some((s) => PARAM_IN_SET.test(s)) || (hasUpdateTasks && PARAM_PUSH.test(source));
  return { literal, parametric };
}

async function scanRepo() {
  const modules = await listProductionModules(SOURCE_ROOT);
  const literalViolations = [];
  const parametricWriters = [];
  for (const modulePath of modules) {
    const relative = path.relative(SOURCE_ROOT, modulePath);
    const source = await readFile(modulePath, 'utf8');
    const { literal, parametric } = scanTerminalWrites(source);
    if (literal && relative !== TERMINAL_WRITE_HUB_MODULE) literalViolations.push(relative);
    if (parametric && relative !== TERMINAL_WRITE_HUB_MODULE) parametricWriters.push(relative);
  }
  return { literalViolations, parametricWriters };
}

describe('任务终态写入守卫（所有终态路径必经 task-terminal）', () => {
  it('① 生产源码里不存在 hub 之外的字面量终态写入', async () => {
    const { literalViolations } = await scanRepo();
    expect(literalViolations, '以下模块直写终态，必须改经 lib/task-terminal.js 的 finalizeTask').toEqual([]);
  });

  it('② 参数化 status 写入者全部登记在 TASK_STATUS_WRITER_REGISTRY', async () => {
    const { parametricWriters } = await scanRepo();
    const registered = new Set(TASK_STATUS_WRITER_REGISTRY.map((r) => r.module));
    const missing = parametricWriters.filter((m) => !registered.has(m));
    expect(missing, '参数化 UPDATE tasks SET status = $N 写入者未登记（登记时声明 may_write_terminal 与理由）').toEqual([]);
  });

  it('③ 登记为可能写终态的模块必须调用 afterTerminalTransition( 或 finalizeTask(', async () => {
    for (const row of TASK_STATUS_WRITER_REGISTRY) {
      expect(row).toMatchObject({ module: expect.any(String), may_write_terminal: expect.any(Boolean), reason: expect.any(String) });
      if (!row.may_write_terminal) continue;
      const source = await readFile(path.join(SOURCE_ROOT, row.module), 'utf8');
      const hooked = /\bafterTerminalTransition\s*\(/.test(source) || /\bfinalizeTask\s*\(/.test(source);
      expect(hooked, `${row.module} 可能写终态但没有经过 afterTerminalTransition/finalizeTask`).toBe(true);
    }
  });

  it('④ 登记表无幽灵条目：每条都对应仍在参数化写 status 的真实模块', async () => {
    const { parametricWriters } = await scanRepo();
    const live = new Set(parametricWriters);
    const ghosts = TASK_STATUS_WRITER_REGISTRY.map((r) => r.module).filter((m) => !live.has(m));
    expect(ghosts, '登记表里的模块已不再参数化写 status，删掉条目').toEqual([]);
  });

  it('proven-to-fire：直写终态的源码片段被判违规；WHERE 里的终态字面量不误判', () => {
    expect(scanTerminalWrites(`await pool.query(\`UPDATE tasks SET status = 'completed', updated_at = NOW() WHERE id = $1\`, [id]);`))
      .toEqual({ literal: true, parametric: false });
    expect(scanTerminalWrites(`UPDATE tasks SET status='failed', completed_at=NOW() WHERE id=$1::uuid`))
      .toEqual({ literal: true, parametric: false });
    expect(scanTerminalWrites(`UPDATE tasks\n  SET pr_status = 'merged',\n      status = 'completed_no_pr'\n  WHERE id = $1`))
      .toEqual({ literal: true, parametric: false });
    expect(scanTerminalWrites(`UPDATE tasks SET status = $2, payload = $3 WHERE id = $1`))
      .toEqual({ literal: false, parametric: true });
    expect(scanTerminalWrites(`setClauses.push(\`status = $\${paramIdx++}\`);\nawait pool.query(\`UPDATE tasks SET \${setClauses.join(', ')} WHERE id = $1\`);`))
      .toEqual({ literal: false, parametric: true });
    expect(scanTerminalWrites(`const updates = ['status = $2'];\nawait pool.query(\`UPDATE tasks SET \${updates.join(', ')} WHERE id = $1\`);`))
      .toEqual({ literal: false, parametric: true });
    expect(scanTerminalWrites(`UPDATE tasks SET claimed_by = NULL WHERE id = $1 AND status = 'completed'`))
      .toEqual({ literal: false, parametric: false });
    expect(scanTerminalWrites(`SELECT id FROM tasks WHERE status = 'completed'`))
      .toEqual({ literal: false, parametric: false });
  });
});
