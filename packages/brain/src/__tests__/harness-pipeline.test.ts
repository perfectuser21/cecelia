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

describe('harness pipeline — report触发时机', () => {
  it('harness_report 只在最后一个 WS 完成时创建（currentWsIdx === totalWsCount）', () => {
    // The report creation must be inside the `currentWsIdx === totalWsCount` block
    const marker = 'currentWsIdx === totalWsCount';
    const idx = execSrc.indexOf(marker);
    expect(idx).toBeGreaterThan(0);
    // harness_report task creation should appear after this marker
    const region = execSrc.slice(idx, idx + 800);
    expect(region).toContain('harness_report');
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
  it('contract_branch 为 null 时不创建 Generator，打印 P0 错误', () => {
    expect(execSrc).toContain('contract_branch=null');
    expect(execSrc).toContain('[P0][execution-callback]');
    // Guard block must contain early return to prevent Generator creation
    const guardIdx = execSrc.indexOf('contract_branch=null');
    const region = execSrc.slice(guardIdx, guardIdx + 200);
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
  it('harness_report 使用 Haiku（report 只是汇总，不需要 Sonnet）', () => {
    expect(modelProfileSrc).toMatch(/harness_report[^}]*haiku/);
    expect(modelProfileSrc).not.toMatch(/harness_report[^}]*sonnet-4-6/);
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
