/**
 * Workstream 2 — dispatcher 防回路 + PR #2816 单元守护不退化 [BEHAVIOR]
 *
 * 守护两件事：
 * 1. PR #2816 自带的单元测试文件 packages/brain/src/__tests__/executor-harness-initiative-status-writeback.test.js
 *    存在，且至少含 4 个 it() 块（防止"删 it 让全绿"）。
 * 2. 本 Sprint 的防回路验证脚本 sprints/golden-path-verify-20260507/scripts/check-no-redispatch-and-units.sh
 *    引用了正确的 PR #2816 单元守护文件路径、tick_decisions 表、dispatch_count ≤ 1 阈值。
 *
 * 预期 Red（当前分支 base 未 rebase main / Generator 尚未产出脚本）：
 *   - PR #2816 单元守护文件不存在 → fs.existsSync = false → expect FAIL
 *   - check-no-redispatch-and-units.sh 不存在 → fs.existsSync = false → expect FAIL
 *
 * 预期 Green（rebase 至 main 含 PR #2816 + Generator 产出脚本后）：
 *   - 文件存在、it 数 ≥ 4、脚本含必需关键字 → 全 PASS
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

const PR2816_GUARD_TEST = path.join(
  REPO_ROOT,
  'packages/brain/src/__tests__/executor-harness-initiative-status-writeback.test.js',
);

const NO_REDISPATCH_SCRIPT = path.join(
  REPO_ROOT,
  'sprints/golden-path-verify-20260507/scripts/check-no-redispatch-and-units.sh',
);

const TARGET_INITIATIVE_TASK_ID = '84075973-99a4-4a0d-9a29-4f0cd8b642f5';

describe('WS2 — PR #2816 单元守护不退化 + dispatcher 防回路 [BEHAVIOR]', () => {
  it('PR #2816 单元守护文件存在（防止文件被删/重命名）', () => {
    expect(fs.existsSync(PR2816_GUARD_TEST)).toBe(true);
  });

  it('PR #2816 单元守护文件含 it() 数量 ≥ 4（防止删测试让全绿）', () => {
    if (!fs.existsSync(PR2816_GUARD_TEST)) {
      // 文件不存在时主动 fail，给出清晰错误（而非黑盒崩溃）
      throw new Error(`守护文件不存在：${PR2816_GUARD_TEST}`);
    }
    const src = fs.readFileSync(PR2816_GUARD_TEST, 'utf8');
    const itCount = (src.match(/^\s*it\s*\(/gm) || []).length;
    expect(itCount).toBeGreaterThanOrEqual(4);
  });

  it('PR #2816 单元守护文件断言 updateTaskStatus completed/failed 模式存在', () => {
    if (!fs.existsSync(PR2816_GUARD_TEST)) {
      throw new Error(`守护文件不存在：${PR2816_GUARD_TEST}`);
    }
    const src = fs.readFileSync(PR2816_GUARD_TEST, 'utf8');
    expect(src).toMatch(/updateTaskStatus[\s\S]*?completed/);
    expect(src).toMatch(/updateTaskStatus[\s\S]*?failed/);
  });

  it('防回路脚本 scripts/check-no-redispatch-and-units.sh 存在', () => {
    expect(fs.existsSync(NO_REDISPATCH_SCRIPT)).toBe(true);
  });

  it('防回路脚本含 tick_decisions 查询 + 目标 task_id + dispatch_count ≤ 1 阈值', () => {
    if (!fs.existsSync(NO_REDISPATCH_SCRIPT)) {
      throw new Error(`脚本不存在：${NO_REDISPATCH_SCRIPT}`);
    }
    const src = fs.readFileSync(NO_REDISPATCH_SCRIPT, 'utf8');
    expect(src).toContain('tick_decisions');
    expect(src).toContain(TARGET_INITIATIVE_TASK_ID);
    // 阈值表达式：bash 的 -le 1 或 <= 1
    expect(src).toMatch(/-le\s+1|<=\s*1/);
  });

  it('防回路脚本含 PR #2816 单元守护文件路径（用于复跑 4 项断言）', () => {
    if (!fs.existsSync(NO_REDISPATCH_SCRIPT)) {
      throw new Error(`脚本不存在：${NO_REDISPATCH_SCRIPT}`);
    }
    const src = fs.readFileSync(NO_REDISPATCH_SCRIPT, 'utf8');
    expect(src).toContain('executor-harness-initiative-status-writeback.test.js');
    // it() 数量 ≥ 4 阈值断言（防止"偷偷删 it 让全绿"）
    expect(src).toMatch(/IT_COUNT[\s\S]{0,120}(?:-ge\s+4|>=\s*4)/);
  });
});
