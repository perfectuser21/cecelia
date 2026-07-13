/**
 * P1 bug 39b97ade regression — tick-runner.js "6.6 Dead task reset" 误伤 skill-relay 任务。
 *
 * 根因：skill-relay 路径（harness-skill-relay.js::spawnSkillRelaySession）不走 LangGraph 的
 * fresh-start 分支，execution_attempts 永远停在 0；relay session 靠外部容器自证存活，
 * tasks.updated_at 长时间不动是正常态。旧 SQL 只按 execution_attempts=0 AND updated_at 陈旧
 * 判定"死任务"，对 skill-relay in_progress 任务是误杀 —— 今日两次实证（a3d61486 双容器毒死
 * 原 session / 4cedf175 人工救回）：Brain 重启后被清 claimed_by、requeue，dispatcher 重新
 * claim 后再次 spawn，撞上仍在跑的旧容器。
 *
 * 修复：WHERE 子句加 orchestrator != 'skill-relay' 排除（对齐 #3594 harness-watchdog.js
 * 区段A/B 先例写法）。
 *
 * 设计说明：tick-runner.js 顶层 import 链入 ~30+ 模块、需要真实 PostgreSQL，
 * 沿用本文件既有约定（见 tick-runner.test.js）用源码自省而非真实 import 测试。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TICK_RUNNER_PATH = resolve(__dirname, '../tick-runner.js');
const SRC = readFileSync(TICK_RUNNER_PATH, 'utf8');

// 定位 "6.6. Dead task reset" 注释块开始到下一个 "// 7." 阶段之间的代码区段
function extractDeadTaskResetBlock(src) {
  const startIdx = src.indexOf('6.6. Dead task reset');
  expect(startIdx, '必须能找到 "6.6. Dead task reset" 注释').toBeGreaterThan(-1);
  const endIdx = src.indexOf('// 7. Dispatch tasks', startIdx);
  expect(endIdx, '必须能找到 "// 7. Dispatch tasks" 作为区段结束标记').toBeGreaterThan(startIdx);
  return src.slice(startIdx, endIdx);
}

describe('tick-runner.js — 6.6 Dead task reset executor_kind 白名单（T2 回归）', () => {
  const block = extractDeadTaskResetBlock(SRC);

  it('WHERE 子句仍保留原有判据（execution_attempts=0 / status IN (...) / updated_at 陈旧）', () => {
    expect(block).toMatch(/execution_attempts\s*=\s*0/);
    expect(block).toMatch(/status IN \('in_progress', 'queued'\)/);
    expect(block).toMatch(/updated_at < NOW\(\) - INTERVAL '10 minutes'/);
  });

  it('WHERE 子句改用 executor_kind IN 白名单（T2 核心断言）', () => {
    expect(block).toMatch(/executor_kind\s+IN\s+\(\s*'brain-local'\s*,\s*'bridge'\s*\)/);
  });

  it('不再包含 IS DISTINCT FROM skill-relay（旧排除写法已删除）', () => {
    expect(block).not.toMatch(/IS DISTINCT FROM\s+'skill-relay'/);
  });

  it('白名单条件位于同一条 UPDATE 语句内（在 RETURNING 之前）', () => {
    const updateIdx = block.indexOf('UPDATE tasks');
    const excludeIdx = block.indexOf("executor_kind IN");
    const returningIdx = block.indexOf('RETURNING');
    expect(updateIdx).toBeGreaterThan(-1);
    expect(excludeIdx).toBeGreaterThan(updateIdx);
    expect(returningIdx).toBeGreaterThan(excludeIdx);
  });
});
