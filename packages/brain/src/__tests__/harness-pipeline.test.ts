/**
 * harness-pipeline.test.ts
 * 验证 execution.js harness pipeline 编排逻辑的关键路径
 * 覆盖：report触发时机 / goal_id绕过 / contract_branch guard / 幂等检查
 *       Proposer 去重 / auth 失败 skipCount
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// __dirname = packages/brain/src/__tests__/
const execSrc = fs.readFileSync(
  path.join(__dirname, '../routes/execution.js'),
  'utf8'
);
const serverSrc = fs.readFileSync(
  path.join(__dirname, '../../server.js'),
  'utf8'
);
const tickSrc = fs.readFileSync(
  path.join(__dirname, '../tick.js'),
  'utf8'
);
const modelProfileSrc = fs.readFileSync(
  path.join(__dirname, '../model-profile.js'),
  'utf8'
);
const quarantineSrc = fs.readFileSync(
  path.join(__dirname, '../quarantine.js'),
  'utf8'
);

describe('harness pipeline — evaluator触发时机', () => {
  it('harness_evaluate 只在最后一个 WS 完成时创建（currentWsIdx === totalWsCount）', () => {
    // v5.0: Generator 完成后创建 harness_evaluate（不是 harness_report）
    const marker = 'currentWsIdx === totalWsCount';
    const idx = execSrc.indexOf(marker);
    expect(idx).toBeGreaterThan(0);
    // harness_evaluate task creation should appear after this marker
    const region = execSrc.slice(idx, idx + 2000);
    expect(region).toContain('harness_evaluate');
    expect(region).toContain('project_id');
  });

  it('harness_report 创建前不应有不带 totalWsCount 检查的早期触发', () => {
    // Should NOT have report creation before the WS count check
    expect(execSrc).not.toContain('execution_callback_harness_serial');
  });
});

describe('harness pipeline — goal_id 绕过', () => {
  it('串行 WS 链使用 execution_callback_harness trigger，绕过 goal_id 必填校验', () => {
    // 串行 WS 创建不再使用 execution_callback_harness_serial
    expect(execSrc).not.toContain('execution_callback_harness_serial');
    // actions.js 白名单包含 execution_callback_harness
    const actionsSrc = fs.readFileSync(
      path.join(__dirname, '../actions.js'),
      'utf8'
    );
    expect(actionsSrc).toContain('execution_callback_harness');
  });
});

describe('harness pipeline — contract_branch guard', () => {
  it('contract_branch=null 时先做 fallback（git ls-remote），fallback 失败才终止不创建 Generator', () => {
    // P0 guard 仍然存在（fallback 失败后才触发）
    expect(execSrc).toContain('contract_branch=null');
    expect(execSrc).toContain('[P0][execution-callback]');
    // Fallback 逻辑：查找 cp-harness-review-approved-{taskIdShort} 分支
    expect(execSrc).toContain('cp-harness-review-approved-');
    expect(execSrc).toContain('git ls-remote --heads origin');
    // RECOVERY 日志：fallback 成功时输出
    expect(execSrc).toContain('[RECOVERY][execution-callback]');
    // fallback 失败才 return（P0 guard 仍在，但在 fallback 之后）
    const p0Idx = execSrc.indexOf('[P0][execution-callback]');
    const region = execSrc.slice(p0Idx, p0Idx + 300);
    expect(region).toContain('return');
  });
});

describe('harness pipeline — 幂等保护', () => {
  it('创建 WS{N+1} 前查 DB 检查是否已存在', () => {
    expect(execSrc).toContain('already queued');
    expect(execSrc).toContain("workstream_index");
    // Check the idempotency query exists
    expect(execSrc).toContain("status IN ('queued','in_progress')");
  });
});

describe('harness pipeline — 模型配置', () => {
  it('harness_report 使用 Sonnet（与 generate/fix 保持一致）', () => {
    expect(modelProfileSrc).toMatch(/harness_report[^}]*claude-sonnet-4-6/);
    expect(modelProfileSrc).not.toMatch(/harness_report[^}]*haiku/);
  });

  it('harness GAN 三件套（planner/propose/review）使用 Opus', () => {
    expect(modelProfileSrc).toMatch(/harness_planner[^}]*opus/);
    expect(modelProfileSrc).toMatch(/harness_contract_propose[^}]*opus/);
    expect(modelProfileSrc).toMatch(/harness_contract_review[^}]*opus/);
  });
});

describe('BRAIN_QUIET_MODE — 噪音关闭', () => {
  it('server.js: startSelfDriveLoop 被 BRAIN_QUIET_MODE 门控', () => {
    const idx = serverSrc.indexOf('startSelfDriveLoop');
    expect(idx).toBeGreaterThan(0);
    const region = serverSrc.slice(idx - 200, idx + 50);
    expect(region).toContain('BRAIN_QUIET_MODE');
  });

  it('tick.js: triggerDeptHeartbeats 被 BRAIN_QUIET_MODE 门控', () => {
    const callIdx = tickSrc.indexOf('triggerDeptHeartbeats(pool)');
    expect(callIdx).toBeGreaterThan(0);
    const region = tickSrc.slice(callIdx - 400, callIdx + 100);
    expect(region).toContain('BRAIN_QUIET_MODE');
  });
});

describe('harness pipeline — Proposer 去重', () => {
  it('Layer 1 创建 Proposer 前先查 DB 检查是否已有活跃的同 planner_task_id Proposer', () => {
    // 去重查询：task_type = proposeType AND payload->>'planner_task_id' = $2
    expect(execSrc).toContain("payload->>'planner_task_id'");
    // 查询包含 queued/in_progress 状态检查
    const dedupIdx = execSrc.indexOf("payload->>'planner_task_id'");
    const region = execSrc.slice(dedupIdx - 100, dedupIdx + 300);
    expect(region).toContain("status IN ('queued', 'in_progress')");
  });

  it('Layer 1 发现已有活跃 Proposer 时打印 skip 日志，不重复创建', () => {
    // 已有 Proposer 时跳过创建并打印日志
    expect(execSrc).toContain('已有活跃 Proposer');
    expect(execSrc).toContain('跳过创建');
    // 去重逻辑使用 if/else 结构，保证有 Proposer 时 createHarnessTask 不被调用
    // existingProposer.rows.length > 0 与日志在相邻行
    expect(execSrc).toContain('existingProposer.rows.length > 0');
    const checkIdx = execSrc.indexOf('existingProposer.rows.length > 0');
    const region = execSrc.slice(checkIdx, checkIdx + 300);
    expect(region).toContain('已有活跃 Proposer');
  });
});

describe('harness pipeline — report 失败自动重试', () => {
  it('harness_report 分支存在且含有 createHarnessTask 调用', () => {
    const idx = execSrc.indexOf("harnessType === 'harness_report'");
    expect(idx).toBeGreaterThan(0);
    const block = execSrc.substring(idx, idx + 1500);
    const nc = block.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(nc).toMatch(/createTask|createHarnessTask/);
  });

  it('createHarnessTask 在 result null 条件守护之后（不无条件执行）', () => {
    const idx = execSrc.indexOf("harnessType === 'harness_report'");
    const block = execSrc.substring(idx, idx + 1500);
    const nc = block.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const nullIdx = nc.search(/result\s*===?\s*null|!\s*result/);
    const createIdx = nc.search(/createTask|createHarnessTask/);
    expect(nullIdx).toBeGreaterThan(0);
    expect(createIdx).toBeGreaterThan(nullIdx);
  });

  it('retry_count >= 3 上限使用 >= 运算符，之后有 return/break/throw 终止', () => {
    const idx = execSrc.indexOf("harnessType === 'harness_report'");
    const block = execSrc.substring(idx, idx + 1500);
    const nc = block.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(nc).toMatch(/retry_count\s*>=\s*3/);
    const li = nc.search(/retry_count\s*>=\s*3/);
    const af = nc.substring(li, li + 300);
    expect(af.substring(0, 200)).toMatch(/return|break|throw/);
  });

  it('重试 payload 包含 sprint_dir、planner_task_id、retry_count、pr_url', () => {
    const idx = execSrc.indexOf("harnessType === 'harness_report'");
    const block = execSrc.substring(idx, idx + 1500);
    const nc = block.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(nc).toContain('sprint_dir');
    expect(nc).toContain('planner_task_id');
    expect(nc).toContain('retry_count');
    expect(nc).toContain('pr_url');
  });

  it('retry_count >= 3 到 return 之间不允许出现 createHarnessTask', () => {
    const idx = execSrc.indexOf("harnessType === 'harness_report'");
    const block = execSrc.substring(idx, idx + 1500);
    const nc = block.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const li = nc.search(/retry_count\s*>=\s*3/);
    const af = nc.substring(li, li + 300);
    const ti = af.search(/return|break|throw/);
    expect(ti).toBeGreaterThan(0);
    expect(af.substring(0, ti)).not.toMatch(/createTask|createHarnessTask/);
  });
});

describe('quarantine — auth/network/rate_limit 失败 skipCount', () => {
  it('handleTaskFailure 支持 skipCount 选项', () => {
    // 函数签名支持 options 参数
    expect(quarantineSrc).toContain('async function handleTaskFailure(taskId, options = {})');
    expect(quarantineSrc).toContain('skipCount = false');
  });

  it('skipCount=true 时只 requeue，不累计失败次数', () => {
    // skipCount 分支：UPDATE tasks SET status=queued + 返回 skipped_count: true
    // 检查整个 quarantine.js 中存在这些关键字符串
    expect(quarantineSrc).toContain("status='queued'");
    expect(quarantineSrc).toContain('skipped_count: true');
    expect(quarantineSrc).toContain('failure_count: 0, skipped_count: true');
  });

  it('execution-callback 对 isTransientApiError 传 skipCount=true', () => {
    // execution.js 中对 auth/network/rate_limit 调用 handleTaskFailure({ skipCount })
    expect(execSrc).toContain('skipCount = isTransientApiError');
    expect(execSrc).toContain('handleTaskFailure(task_id, { skipCount })');
    expect(execSrc).toContain('skipped_count');
  });
});

describe('harness pipeline — planner branch 持久化', () => {
  it('harness_planner 完成后使用 JSONB merge 写入 result.branch', () => {
    // JSONB merge 语义：COALESCE(result, '{}') || jsonb_build_object('branch', $1)
    expect(execSrc).toContain("COALESCE(result, '{}') || jsonb_build_object('branch', $1)");
    // 写入操作在 plannerBranch 非 null 时才执行
    expect(execSrc).toContain('persisted to result.branch for task');
  });

  it('JSONB merge 写入在提取 plannerBranch 之后、创建 Proposer 之前执行', () => {
    const plannerBlock = execSrc.slice(execSrc.indexOf("Layer 1: harness_planner 完成"));
    const mergeIdx = plannerBlock.indexOf('COALESCE(result');
    const proposerIdx = plannerBlock.indexOf('proposeType');
    // merge 必须在 Proposer 创建之前
    expect(mergeIdx).toBeGreaterThan(0);
    expect(proposerIdx).toBeGreaterThan(mergeIdx);
  });
});
