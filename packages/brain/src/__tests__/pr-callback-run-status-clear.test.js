/**
 * pr-callback-handler — PR 合并时清除活跃运行标记回归测试
 *
 * 场景：GitHub PR 已 MERGED（71 项 CI 通过），但 Brain task 仍有
 * payload.run_status='triggered' 和 payload.current_run_id 非空。
 *
 * 根因：handlePrMerged 在 in_progress 路径更新任务时，payloadUpdate 不包含
 * current_run_id=null 和 run_status='merged'，导致活跃 run 标记遗留。
 *
 * 修复后：UPDATE SQL 应同时清除 current_run_id 并将 run_status 设为 'merged'。
 */

import { describe, it, expect, vi } from 'vitest';
import { handlePrMerged } from '../pr-callback-handler.js';

vi.mock('../kr-progress.js', () => ({
  updateKrProgress: vi.fn().mockResolvedValue({ krId: 'kr-1', progress: 75 }),
}));

function makeClientPool(inProgressRows, overrideQuery) {
  const calls = [];
  const client = {
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params, target: 'client' });
      if (overrideQuery) return overrideQuery(sql, params, 'client');
      if (/BEGIN/i.test(sql)) return {};
      if (/COMMIT|ROLLBACK/i.test(sql)) return {};
      if (/UPDATE\s+tasks/i.test(sql)) return { rowCount: 1, rows: [{ id: 'task-1', goal_id: null, project_id: null, pr_url: 'https://github.com/x/y/pull/1', pr_merged_at: '2026-08-01T00:00:00Z' }] };
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  const pool = {
    _calls: calls,
    _client: client,
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params, target: 'pool' });
      if (overrideQuery) return overrideQuery(sql, params, 'pool');
      // matchTaskByBranchOrUrl: in_progress 查询
      if (/SELECT.*FROM\s+tasks.*status\s*=\s*\$1/is.test(sql) || /status\s*=\s*'in_progress'/i.test(sql)) {
        return { rows: inProgressRows, rowCount: inProgressRows.length };
      }
      return { rows: [], rowCount: 0 };
    }),
    connect: vi.fn(async () => client),
  };
  return { pool, calls, client };
}

describe('handlePrMerged — 清除活跃 run 标记', () => {
  it('in_progress 任务合并时 UPDATE SQL 应清除 current_run_id', async () => {
    const inProgressTask = {
      id: 'task-abc',
      title: '测试任务',
      status: 'in_progress',
      project_id: null,
      goal_id: null,
      metadata: { branch: 'cp-abc123' },
      payload: { current_run_id: 'run-xyz-456', run_status: 'triggered' },
      task_type: 'dev',
    };
    const { pool, calls } = makeClientPool([inProgressTask]);

    await handlePrMerged(pool, {
      repo: 'owner/repo',
      prNumber: 1,
      branchName: 'cp-abc123',
      prUrl: 'https://github.com/owner/repo/pull/1',
      mergedAt: '2026-08-01T00:00:00Z',
      title: 'feat: fix',
    });

    // 找到对 tasks 执行的 UPDATE
    const taskUpdate = calls.find(c =>
      /UPDATE\s+tasks/i.test(c.sql) &&
      c.target === 'client'
    );
    expect(taskUpdate).toBeDefined();

    // 修复前：UPDATE 不含 current_run_id 清除逻辑
    // 修复后：UPDATE 必须清除 current_run_id（用 - 'current_run_id' 或设为 null）
    const hasClearRunId =
      /current_run_id/i.test(taskUpdate.sql) ||
      /- 'current_run_id'/i.test(taskUpdate.sql);
    expect(hasClearRunId).toBe(true);
  });

  it('in_progress 任务合并时 UPDATE SQL 应将 run_status 设为终态', async () => {
    const inProgressTask = {
      id: 'task-def',
      title: '测试任务 2',
      status: 'in_progress',
      project_id: null,
      goal_id: null,
      metadata: { branch: 'cp-def456' },
      payload: { current_run_id: 'run-abc-789', run_status: 'triggered' },
      task_type: 'dev',
    };
    const { pool, calls } = makeClientPool([inProgressTask]);

    await handlePrMerged(pool, {
      repo: 'owner/repo',
      prNumber: 2,
      branchName: 'cp-def456',
      prUrl: 'https://github.com/owner/repo/pull/2',
      mergedAt: '2026-08-01T01:00:00Z',
      title: 'fix: bug',
    });

    const taskUpdate = calls.find(c =>
      /UPDATE\s+tasks/i.test(c.sql) &&
      c.target === 'client'
    );
    expect(taskUpdate).toBeDefined();

    // 修复前：run_status 保持 'triggered'，task.payload 永远显示活跃
    // 修复后：UPDATE SQL 直接设置 run_status 或通过 payloadUpdate JSON 写入终态值
    const sqlHasRunStatus = /run_status/i.test(taskUpdate.sql);
    const paramsHaveRunStatus = (taskUpdate.params || []).some(p =>
      typeof p === 'string' && p.includes('run_status')
    );
    expect(sqlHasRunStatus || paramsHaveRunStatus).toBe(true);
  });

  it('provider 无关：Claude/Codex/Grok payload 均应清除 current_run_id', async () => {
    // 验证 provider 元数据字段不影响清除行为（控制契约与 provider 无关）
    const providers = ['claude', 'codex', 'grok'];
    for (const provider of providers) {
      const task = {
        id: `task-${provider}`,
        title: `${provider} 任务`,
        status: 'in_progress',
        project_id: null,
        goal_id: null,
        metadata: { branch: `cp-${provider}123` },
        payload: {
          current_run_id: `run-${provider}-001`,
          run_status: 'triggered',
          executor_kind: provider === 'codex' ? 'codex-bridge' : provider === 'grok' ? 'grok-bridge' : 'claude-local',
        },
        task_type: 'dev',
      };
      const { pool, calls } = makeClientPool([task]);

      await handlePrMerged(pool, {
        repo: 'owner/repo',
        prNumber: 10,
        branchName: `cp-${provider}123`,
        prUrl: `https://github.com/owner/repo/pull/10`,
        mergedAt: '2026-08-01T02:00:00Z',
        title: `feat(${provider}): test`,
      });

      const taskUpdate = calls.find(c =>
        /UPDATE\s+tasks/i.test(c.sql) &&
        c.target === 'client'
      );
      expect(taskUpdate, `provider=${provider} 应有 tasks UPDATE`).toBeDefined();
      const hasClearRunId = /current_run_id/i.test(taskUpdate.sql) || /- 'current_run_id'/i.test(taskUpdate.sql);
      expect(hasClearRunId, `provider=${provider} 应清除 current_run_id`).toBe(true);
    }
  });
});
