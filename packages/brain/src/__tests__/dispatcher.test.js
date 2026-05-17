/**
 * dispatcher.test.js — 1:1 单测 stub（lint-test-pairing 要求精确名匹配）
 *
 * 实际功能 test 在 dispatcher-default-graph / dispatcher-initiative-lock /
 * dispatcher-quota-cooling.test.js + initiative-lock.test.js（mock query 验 SQL）。
 * 本文件仅为满足 lint-test-pairing 命名约束（每 src 文件对应同名 test）。
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));

describe('dispatcher.js — module load smoke', () => {
  it('import dispatchNextTask 不抛', async () => {
    const mod = await import('../dispatcher.js');
    expect(typeof mod.dispatchNextTask).toBe('function');
  });

  it('Phase 2.5 retired drain 常量正确（防回退）', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.resolve(__dirname, '../dispatcher.js'), 'utf8');
    // 验 retired 列表含 PR #2656 退役的 5 个类型
    for (const t of ['harness_task', 'harness_ci_watch', 'harness_fix', 'harness_final_e2e', 'harness_planner']) {
      expect(src).toContain(`'${t}'`);
    }
    // 验有 retired-type SQL drain（dispatcher.js 注释里写 "2.5 Drain"）
    expect(src).toContain('2.5 Drain');
    expect(src).toContain('pipeline_terminal_failure');
  });
});
