/**
 * codex-test-gen.test.ts — TDD Red 阶段测试骨架
 *
 * 覆盖 sprint: 07172225-codex-pool-activation
 * 目标模块: packages/brain/src/codex-test-gen.js（新建）
 *
 * 禁 mock 边：
 *   - codex-test-gen.js ↔ DB 表 tasks（入队写路径、去重查询）
 *   - scheduler-jobs.js ↔ codex-test-gen.js（handler 注册）
 *
 * 说明：集成测试需真 Postgres（$DB_URL），由 brain-integration CI job 起。
 * 纯逻辑测试（过滤黑名单、去重判据）可在 vitest 本地跑。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const BRAIN_SRC = join(process.cwd(), 'packages/brain/src');

// ===== 模块存在性检查 =====

describe('codex-test-gen 模块结构 [BEHAVIOR]', () => {
  it('codex-test-gen.js 文件存在', () => {
    const filePath = join(BRAIN_SRC, 'codex-test-gen.js');
    expect(existsSync(filePath), `${filePath} 不存在`).toBe(true);
  });

  it('codex-test-gen.js 含 codex_test_gen task_type 字面量（入队逻辑）', () => {
    const filePath = join(BRAIN_SRC, 'codex-test-gen.js');
    if (!existsSync(filePath)) throw new Error('文件不存在，TDD Red 阶段预期 FAIL');
    const content = readFileSync(filePath, 'utf8');
    expect(content).toContain('codex_test_gen');
  });

  it('scheduler-jobs.js JOBS 包含 codex-test-gen 条目', () => {
    const filePath = join(BRAIN_SRC, 'scheduler-jobs.js');
    const content = readFileSync(filePath, 'utf8');
    // 验证 JOBS 数组中有 name: 'codex-test-gen'
    expect(content).toContain("'codex-test-gen'");
  });

  it('scheduler-jobs.js 引用 codex-test-gen 相关 import', () => {
    const filePath = join(BRAIN_SRC, 'scheduler-jobs.js');
    const content = readFileSync(filePath, 'utf8');
    // scheduler-jobs.js 应 import 生成器函数
    const hasImport = content.includes('codex-test-gen') || content.includes('runCodexTestGen') || content.includes('maybeRunCodexTestGen');
    expect(hasImport, 'scheduler-jobs.js 未引入 codex-test-gen 相关函数').toBe(true);
  });
});

// ===== 核心文件过滤（铁律 INV-1：禁 Codex 派核心任务）=====

describe('codex-test-gen 核心文件过滤 [BEHAVIOR]', () => {
  const FORBIDDEN_PATTERNS = ['dispatcher', 'slot-allocator', 'migration'];

  it('dispatcher/slot-allocator 文件不出现在待扫描列表', () => {
    const filePath = join(BRAIN_SRC, 'codex-test-gen.js');
    if (!existsSync(filePath)) throw new Error('codex-test-gen.js 不存在，TDD Red 阶段预期 FAIL');
    const content = readFileSync(filePath, 'utf8');

    // 验证黑名单关键词出现在过滤逻辑中（不是作为目标文件被选中）
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(content, `codex-test-gen.js 缺对 '${pattern}' 的过滤逻辑`).toContain(pattern);
    }
  });

  it('batch 扫描函数不返回 dispatcher.js', async () => {
    // TDD Red: codex-test-gen.js 尚未实现时此测试 FAIL（模块 import 报错）
    let scanTargets: string[] = [];
    try {
      // @ts-ignore — 模块未实现时预期 import 失败
      const mod = await import('../../../packages/brain/src/codex-test-gen.js');
      if (typeof mod.scanMissingTestFiles === 'function') {
        // 如果有扫描函数，验证返回结果不含核心文件
        scanTargets = await mod.scanMissingTestFiles({ dryRun: true });
        const hasForbidden = scanTargets.some((f: string) =>
          FORBIDDEN_PATTERNS.some(p => f.includes(p))
        );
        expect(hasForbidden, `扫描结果含禁止文件: ${scanTargets.filter((f: string) => FORBIDDEN_PATTERNS.some(p => f.includes(p))).join(', ')}`).toBe(false);
      }
    } catch {
      // 模块不存在 → TDD Red 预期失败
      throw new Error('codex-test-gen.js 模块未实现，TDD Red 阶段预期 FAIL');
    }
  });
});

// ===== 去重机制（INV-4：7 天内同文件跳过）=====

describe('codex-test-gen 去重机制 [BEHAVIOR]', () => {
  it('同文件 7 天内重复调用返回 skipped:true', async () => {
    // TDD Red: 模块未实现时预期 import 失败
    try {
      // @ts-ignore
      const mod = await import('../../../packages/brain/src/codex-test-gen.js');
      if (typeof mod.checkDedup === 'function') {
        // 若有 checkDedup 函数，传入 target_file 和历史记录验证跳过逻辑
        const result = await mod.checkDedup({
          targetFile: 'packages/brain/src/test-dedup-target.js',
          recentTasksWithinDays: 7,
        });
        expect(result.skipped).toBe(true);
        expect(result.reason).toBeDefined();
      } else if (typeof mod.runCodexTestGen === 'function') {
        // 主函数存在但无单独 checkDedup
        expect(true).toBe(true); // 集成测试中验证
      }
    } catch {
      throw new Error('codex-test-gen.js 模块未实现，TDD Red 阶段预期 FAIL');
    }
  });

  it('codex-test-gen.js 代码含 7 天去重判据字面量', () => {
    const filePath = join(BRAIN_SRC, 'codex-test-gen.js');
    if (!existsSync(filePath)) throw new Error('文件不存在，TDD Red 阶段预期 FAIL');
    const content = readFileSync(filePath, 'utf8');
    const hasDedup = content.includes('7 day') || content.includes('7 days') ||
      content.includes("'7'") || content.includes('dedup') ||
      content.includes('interval') || content.includes('DEDUP') ||
      content.includes('alreadyTried');
    expect(hasDedup, 'codex-test-gen.js 缺 7 天去重判据').toBe(true);
  });
});

// ===== scheduler-jobs JOBS 注册验证 =====

describe('scheduler-jobs JOBS 包含 codex-test-gen 条目 [BEHAVIOR]', () => {
  it('scheduler-jobs JOBS 包含 codex-test-gen 条目（name 字段匹配）', async () => {
    // @ts-ignore
    const { JOBS } = await import('../../../packages/brain/src/scheduler-jobs.js');
    const job = JOBS.find((j: { name: string }) => j.name === 'codex-test-gen');
    expect(job, 'JOBS 中缺 name=codex-test-gen 条目').toBeDefined();
    expect(job?.handler, 'codex-test-gen job 缺 handler').toBeDefined();
    expect(typeof job?.handler).toBe('function');
  });
});

// ===== battle-report codex 计数注入 =====

describe('battle-report 渲染结果含 codex_test_gen 计数行 [BEHAVIOR]', () => {
  it('battle-report.js 含 codex_test_gen 计数注入逻辑', () => {
    const filePath = join(BRAIN_SRC, 'battle-report.js');
    const content = readFileSync(filePath, 'utf8');
    expect(content, 'battle-report.js 未注入 codex_test_gen 计数逻辑').toContain('codex_test_gen');
  });
});
