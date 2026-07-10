/**
 * T9 回归守卫：learnings 表噪音写入源头不得复活。
 * task_completion 事件层记录与 tasks 表信息完全重复（addendum-01 T9）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('T9 noise source removal', () => {
  it('routes/execution.js must not INSERT task_completion learnings', () => {
    expect(src('routes/execution.js')).not.toMatch(/'task_completion'/);
  });

  it('executor.js watchdog failure_pattern INSERT must include summary column', () => {
    const executor = src('executor.js');
    const insertBlock = executor.slice(executor.indexOf("'watchdog_kill'") - 600, executor.indexOf("'watchdog_kill'") + 600);
    expect(insertBlock).toMatch(/INSERT INTO learnings[^;]*summary/s);
  });

  it('routes/tasks.js dev_experience INSERT must include summary column', () => {
    const tasks = src('routes/tasks.js');
    const idx = tasks.indexOf("'dev_experience'");
    const insertBlock = tasks.slice(Math.max(0, idx - 600), idx + 600);
    expect(insertBlock).toMatch(/INSERT INTO learnings[^;]*summary/s);
  });
});
