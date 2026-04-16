/**
 * harness-proposer-dedup-auth-skip.test.ts
 * 验证两个行为：
 * 1. Proposer 去重：同 planner_task_id 已有 queued/in_progress 的任务时跳过创建
 * 2. auth/network/rate_limit 失败时传 skipCount=true，不累计 quarantine 计数
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// harness 路由已迁移到 harness-router.js，读两个文件合并搜索
const execSrc = fs.readFileSync(
  path.join(__dirname, '../harness-router.js'),
  'utf8'
) + '\n' + fs.readFileSync(
  path.join(__dirname, '../routes/execution.js'),
  'utf8'
);
const quarantineSrc = fs.readFileSync(
  path.join(__dirname, '../quarantine.js'),
  'utf8'
);

describe('Proposer 去重（Fix 1）', () => {
  it('execution.js 应在创建 harness_contract_propose 前查重', () => {
    expect(execSrc).toContain("payload->>'planner_task_id'");
    expect(execSrc).toContain("status IN ('queued', 'in_progress')");
  });

  it('execution.js 应包含去重跳过日志', () => {
    expect(execSrc).toContain('已有活跃 Proposer');
  });

  it('去重检查在 harness_planner 成功路径内', () => {
    const plannerIdx = execSrc.indexOf("harnessType === 'harness_planner'");
    expect(plannerIdx).toBeGreaterThan(0);
    const dedupIdx = execSrc.indexOf('已有活跃 Proposer');
    expect(dedupIdx).toBeGreaterThan(plannerIdx);
  });
});

describe('auth/network/rate_limit 失败不计 quarantine（Fix 2）', () => {
  it('quarantine.js handleTaskFailure 接受 skipCount 选项', () => {
    expect(quarantineSrc).toContain('skipCount');
    expect(quarantineSrc).toMatch(/handleTaskFailure\s*\(\s*taskId\s*,\s*(options|\{)/);
  });

  it('quarantine.js skipCount=true 时只 requeue，不累计失败次数', () => {
    expect(quarantineSrc).toContain('skipped_count: true');
  });

  it('execution.js 对 isTransientApiError 传 skipCount', () => {
    expect(execSrc).toContain('skipCount');
    expect(execSrc).toContain('isTransientApiError');
    expect(execSrc).toContain('skipCount = isTransientApiError');
  });

  it('execution.js 调 handleTaskFailure 时传入 skipCount', () => {
    expect(execSrc).toContain('handleTaskFailure(task_id, { skipCount })');
  });
});
