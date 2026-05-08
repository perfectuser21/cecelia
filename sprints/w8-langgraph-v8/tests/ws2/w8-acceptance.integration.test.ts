/**
 * W8 Acceptance — Workstream 2: full-graph 17 节点 + sub_task spawn credentials 注入参数 + checkpoint resume
 *
 * 集成测试：用 MemorySaver 跑 compileHarnessFullGraph()，全部依赖 mock 掉，
 * 验证节点字典里 17 个必走节点都被遍历 + sub_task spawn 时 args.env 含 CECELIA_CREDENTIALS（仅参数）+
 * Command(resume) 唤回后无重 spawn（幂等门）。**实跑实证由 WS3 acceptance-report.md (DRY_RUN=0) 补充**。
 *
 * Generator 阶段会创建 packages/brain/src/__tests__/integration/w8-acceptance.integration.test.js。
 * 当前 Round 2 Red 阶段：测试文件不存在 + import 路径会失败，断言全 fail。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const TEST_FILE = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'brain',
  'src',
  '__tests__',
  'integration',
  'w8-acceptance.integration.test.js'
);

function readTestFile(): string {
  return fs.readFileSync(TEST_FILE, 'utf8');
}

describe('Workstream 2 — w8-acceptance.integration.test.js shape [BEHAVIOR]', () => {
  it('集成测试文件存在', () => {
    expect(fs.existsSync(TEST_FILE)).toBe(true);
  });

  it('文件 import compileHarnessFullGraph（驱动 17 节点全图）', () => {
    expect(readTestFile()).toMatch(/compileHarnessFullGraph/);
  });

  it('文件 import MemorySaver 和 Command（resume 实证）', () => {
    const c = readTestFile();
    expect(c).toMatch(/MemorySaver/);
    expect(c).toMatch(/Command/);
  });

  it('文件 mock account-rotation（验 CECELIA_CREDENTIALS 注入参数路径）', () => {
    expect(readTestFile()).toMatch(/account-rotation/);
  });

  it('断言 spawn mock 调用 args.env 含 CECELIA_CREDENTIALS（仅注入参数验证）', () => {
    expect(readTestFile()).toMatch(/CECELIA_CREDENTIALS/);
  });

  it('引用 acceptance-fixture.json 作为输入（与 WS1 fixture 一致）', () => {
    expect(readTestFile()).toMatch(/acceptance-fixture\.json/);
  });

  it('断言顶层 12 节点（prep/planner/parsePrd/ganLoop/inferTaskPlan/dbUpsert/pick_sub_task/run_sub_task/evaluate/advance/final_evaluate/report）都被遍历且 spy 各 ≥ 1 次', () => {
    const c = readTestFile();
    const top12 = [
      'prep',
      'planner',
      'parsePrd',
      'ganLoop',
      'inferTaskPlan',
      'dbUpsert',
      'pick_sub_task',
      'run_sub_task',
      'evaluate',
      'advance',
      'final_evaluate',
      'report',
    ];
    for (const node of top12) {
      expect(c).toContain(node);
    }
  });

  it('断言 sub-graph 5 节点（spawn/await_callback/parse_callback/poll_ci/merge_pr）都被遍历且 spy 各 ≥ 1 次', () => {
    const c = readTestFile();
    const sub5 = ['spawn', 'await_callback', 'parse_callback', 'poll_ci', 'merge_pr'];
    for (const node of sub5) {
      expect(c).toContain(node);
    }
  });

  it('Command(resume) 唤回后断言 state.report_path 非空（走完到 report 节点）', () => {
    const c = readTestFile();
    // 期望测试源码包含 report_path 字面量（resume 后状态断言点）
    expect(c).toMatch(/report_path/);
  });

  it('断言 spawn 调用次数 = sub_task 数（resume 前后无重 spawn — 幂等门生效）', () => {
    const c = readTestFile();
    // 期望测试源码出现"幂等"语义断言（mock spawn call count）
    expect(c).toMatch(/spawn[\s\S]{0,200}(toHaveBeenCalledTimes|callCount|\.calls\.length)/);
  });
});
