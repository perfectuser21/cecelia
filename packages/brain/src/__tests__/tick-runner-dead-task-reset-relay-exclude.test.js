/**
 * tick-runner.js "6.6 Dead task reset" 回归测试 — T2 executor_kind 版本
 *
 * 历史：
 *   P1 bug 39b97ade — 旧 SQL 用 payload->>'orchestrator' != 'skill-relay' 排除 relay 任务。
 *   T2（2026-07-10）— 改用 executor_kind IN ('brain-local', 'bridge') 精确限定，
 *   删除 skill-relay 特判：relay-container/headed-session/external-worker/null 全部自然排除。
 *
 * 测试策略：源码自省（tick-runner.js import 链入 30+ 模块 + 需要真实 PG，不适合真实 import）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TICK_RUNNER_PATH = resolve(__dirname, '../tick-runner.js');
const SRC = readFileSync(TICK_RUNNER_PATH, 'utf8');

function extractDeadTaskResetBlock(src) {
  const startIdx = src.indexOf('6.6. Dead task reset');
  expect(startIdx, '必须能找到 "6.6. Dead task reset" 注释').toBeGreaterThan(-1);
  const endIdx = src.indexOf('// 7. Dispatch tasks', startIdx);
  expect(endIdx, '必须能找到 "// 7. Dispatch tasks" 作为区段结束标记').toBeGreaterThan(startIdx);
  return src.slice(startIdx, endIdx);
}

describe('tick-runner.js — 6.6 Dead task reset（T2 executor_kind 版）', () => {
  const block = extractDeadTaskResetBlock(SRC);

  it('WHERE 子句保留原有判据（execution_attempts=0 / status IN / updated_at 陈旧）', () => {
    expect(block).toMatch(/execution_attempts\s*=\s*0/);
    expect(block).toMatch(/status IN \('in_progress', 'queued'\)/);
    expect(block).toMatch(/updated_at < NOW\(\) - INTERVAL '10 minutes'/);
  });

  it('T2：使用 executor_kind IN (\'brain-local\', \'bridge\') 精确过滤', () => {
    expect(block).toMatch(/executor_kind\s+IN\s*\(\s*'brain-local'\s*,\s*'bridge'\s*\)/);
  });

  it('T2：不再含旧的 skill-relay payload 排除条件（已由合同化替代）', () => {
    expect(block).not.toMatch(/skill-relay/);
    expect(block).not.toMatch(/payload->>'orchestrator'/);
  });

  it('排除条件位于同一条 UPDATE 语句内（在 RETURNING 之前）', () => {
    const updateIdx = block.indexOf('UPDATE tasks');
    const kindIdx = block.indexOf("executor_kind IN");
    const returningIdx = block.indexOf('RETURNING');
    expect(updateIdx).toBeGreaterThan(-1);
    expect(kindIdx).toBeGreaterThan(updateIdx);
    expect(returningIdx).toBeGreaterThan(kindIdx);
  });
});
