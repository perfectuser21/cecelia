/**
 * FT-1: canary-drill-inject-form — 注入形态验证
 * Red 阶段 — 验证 queued 注入形态的 watchdog 过滤 bug，以及修复后 in_progress 形态能命中处置流程
 *
 * FT-1A: queued + 无 initiative_runs 行 → watchdog resumeStalledRelayRuns 不调用 spawnFn（复现旧行为）
 * FT-1B: in_progress + initiative_runs 行（orchestrator_version=v2, phase=running）→ watchdog 调用 spawnFn（修复后 Green）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resumeStalledRelayRuns } from '../harness-relay-watchdog.js';

// Mock docker/gh 最外层命令（不影响纯 JS 逻辑）
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    execSync: vi.fn((cmd) => {
      if (typeof cmd === 'string' && (cmd.includes('docker') || cmd.includes('gh'))) {
        return '';
      }
      return '';
    }),
  };
});

function makeDbStub({ taskStatus = 'queued', hasInitiativeRun = false } = {}) {
  return {
    query: vi.fn(async (sql) => {
      // initiative_runs 查询
      if (sql.includes('initiative_runs') && sql.includes('SELECT')) {
        if (!hasInitiativeRun) return { rows: [] };
        return {
          rows: [{
            initiative_id: 'canary-task-001',
            orchestrator_version: 'v2',
            orchestrator_host: 'skill-relay-canary-drill',
            phase: 'running',
            attempts: 0,
            started_at: new Date(Date.now() - 60_000).toISOString(),
            deadline_at: new Date(Date.now() + 30 * 60_000).toISOString(),
            pr_url: null,
          }],
        };
      }
      // tasks 查询
      if (sql.includes('tasks') && sql.includes('SELECT')) {
        return {
          rows: [{
            id: 'canary-task-001',
            status: taskStatus,
            payload: {
              orchestrator: 'skill-relay',
              canary: 'true',
              last_container_exit_code: 137,
            },
            result: {},
            pr_url: null,
            created_at: new Date().toISOString(),
          }],
        };
      }
      // UPDATE/INSERT 返回空
      return { rows: [] };
    }),
  };
}

describe('FT-1: 注入形态验证', () => {
  it('A: queued + 无 initiative_runs 行 → watchdog resumeStalledRelayRuns 不调用 spawnFn（复现旧行为 Red）', async () => {
    const spawnFn = vi.fn(async () => ({ ok: true }));
    const dbPool = makeDbStub({ taskStatus: 'queued', hasInitiativeRun: false });
    const execFn = vi.fn(() => '');

    await resumeStalledRelayRuns({ dbPool, execFn, spawnFn });

    // queued 任务被 L275 过滤（task.status !== 'in_progress'）→ spawnFn 永不被调用
    // 这是 Bug-1 复现：watchdog 永远不处置 queued 任务
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('B: in_progress + initiative_runs 行（orchestrator_version=v2, phase=running）→ watchdog 调用 spawnFn 或触发处置（修复后 Green）', async () => {
    const spawnFn = vi.fn(async () => ({ ok: true }));
    const dbPool = makeDbStub({ taskStatus: 'in_progress', hasInitiativeRun: true });
    // docker ps 返回空字符串（容器不在跑）→ 触发重点火
    const execFn = vi.fn((cmd) => {
      if (typeof cmd === 'string' && cmd.includes('docker ps')) return '';
      if (typeof cmd === 'string' && cmd.includes('gh pr')) return JSON.stringify({ state: 'CLOSED' });
      return '';
    });

    await resumeStalledRelayRuns({ dbPool, execFn, spawnFn });

    // 修复后：in_progress + initiative_runs 行 → watchdog 进入处置分支 → spawnFn 被调用
    // Red 阶段：此断言预期失败，因为当前 registerCanaryTask 不会设置 status=in_progress
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });
});
