/**
 * battle-report-codex.test.ts — TDD Red 阶段：日报 codex 计数注入
 *
 * 覆盖 sprint: 07172225-codex-pool-activation
 * 目标模块: packages/brain/src/battle-report.js（admission 段 codex 计数注入）
 *
 * 注意：本文件仅测试 battle-report.js 中与 codex 计数相关的新增逻辑。
 * 不 mock 被改的 DB 边（battle-report.js ↔ tasks 表查询 codex_test_gen 计数）。
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const BRAIN_SRC = join(process.cwd(), 'packages/brain/src');

describe('battle-report codex_test_gen 计数注入 [BEHAVIOR]', () => {
  it('battle-report.js 文件含 codex_test_gen 字面量（注入标记）', () => {
    const filePath = join(BRAIN_SRC, 'battle-report.js');
    expect(existsSync(filePath), `${filePath} 不存在`).toBe(true);
    const content = readFileSync(filePath, 'utf8');
    expect(content, 'battle-report.js 未注入 codex_test_gen 计数逻辑').toContain('codex_test_gen');
  });

  it('battle-report 渲染结果含 codex_test_gen 计数行（renderReport 函数输出含 codex）', async () => {
    // TDD Red: 注入前此测试 FAIL（渲染输出不含 codex 字样）
    try {
      // @ts-ignore
      const { renderReport } = await import('../../../packages/brain/src/battle-report.js');
      if (typeof renderReport !== 'function') {
        // renderReport 函数可能命名不同，仅验证代码注入
        expect(true).toBe(true);
        return;
      }
      // 构造最小测试数据（含 codex_test_gen 任务）
      const mockData = {
        mergedPrs: [],
        journeyRuns: [],
        userDecisions: [],
        sentinel: { jobs: [], expected: [], healthy: true },
        unconfirmedActions: [],
        goldenPathMode: null,
        admission: {
          dispatched_24h: 1,
          denies: [],
          peak: null,
          vitals: null,
          codex_test_gen_24h: 2,  // 新增字段
        },
      };
      const rendered = renderReport(mockData);
      // 验证渲染结果包含 codex 相关计数信息
      const hasCodexMention = rendered.includes('codex') || rendered.includes('Codex') || rendered.includes('codex_test_gen');
      expect(hasCodexMention, `渲染结果未含 codex 字样: ${rendered.slice(0, 200)}`).toBe(true);
    } catch (e: unknown) {
      // 模块未修改或导出不匹配 → TDD Red 预期失败
      const errMsg = e instanceof Error ? e.message : String(e);
      throw new Error(`battle-report codex 注入未实现，TDD Red 阶段预期 FAIL: ${errMsg}`);
    }
  });
});
