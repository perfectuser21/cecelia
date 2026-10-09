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
    // Task 3（qiumi-task-router PR1）之后 retired 名单改从 lib/task-type-registry.js
    // 的 RETIRED_HARNESS_TYPES_DISPATCH 派生集合读取，dispatcher.js 里不再手抄字面量，
    // 所以"防回退"改为对真实运行值断言（比原来的源码文本 grep 更硬，不会因为格式化/
    // 换行改动误报）。
    const { RETIRED_HARNESS_TYPES_DISPATCH } = await import('../lib/task-type-registry.js');
    for (const t of ['harness_task', 'harness_ci_watch', 'harness_fix', 'harness_final_e2e', 'harness_planner']) {
      expect(RETIRED_HARNESS_TYPES_DISPATCH).toContain(t);
    }

    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.resolve(__dirname, '../dispatcher.js'), 'utf8');
    // 验 dispatcher.js 真的接了注册表的派生集合（防止 import 被顺手删掉但测试还是绿的）
    expect(src).toContain('RETIRED_HARNESS_TYPES_DISPATCH');
    // 验有 retired-type SQL drain（dispatcher.js 注释里写 "2.5 Drain"）
    expect(src).toContain('2.5 Drain');
    expect(src).toContain('pipeline_terminal_failure');
  });
});
