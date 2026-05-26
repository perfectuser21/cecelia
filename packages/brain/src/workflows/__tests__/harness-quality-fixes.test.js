/**
 * harness-quality-fixes.test.js — 四个 harness pipeline 质量修复的回归测试
 *
 * 修复内容：
 * 1. mac_web evaluator 走 hostExecutor（不进 Docker）
 * 2. WINDOWS_CLOUD_WORKFLOW 按 base_repo 注入（zenithjoy → agent-e2e-video.yml）
 * 3. WORKSPACE_PATH 注入给 mac_web evaluator（brain-result.json 写对路径）
 * 4. CECELIA_GOAL_SETTINGS 注入给 generator 和 evaluator 容器
 */
import { describe, it, expect, vi } from 'vitest';

describe('finalEvaluateDispatchNode — mac_web host executor + env injection', () => {
  it('mac_web 使用 hostExecutor 而非 executor（Docker bypass）', async () => {
    const { finalEvaluateDispatchNode } = await import('../harness-initiative.graph.js');

    const mockExecutor = vi.fn(async () => ({ exit_code: 1, timed_out: false, stderr: '' }));
    const mockHostExecutor = vi.fn(async () => ({ exit_code: 1, timed_out: false, stderr: '' }));
    const mockExecFile = vi.fn(async () => ({ stdout: '', stderr: '' }));

    const state = {
      worktreePath: '/fake/worktree',
      task: { id: 'task-mac', payload: { target_environment: 'mac_web' } },
      taskPlan: { journey_type: 'autonomous', target_environment: 'mac_web' },
      sub_tasks: [],
      initiativeId: 'init-mac',
      githubToken: 'tok',
      contractBranch: null,
      final_e2e_verdict: null,
    };

    await finalEvaluateDispatchNode(state, {
      executor: mockExecutor,
      hostExecutor: mockHostExecutor,
      execFile: mockExecFile,
    });

    expect(mockHostExecutor).toHaveBeenCalled();
    expect(mockExecutor).not.toHaveBeenCalled();
  });

  it('非 mac_web 使用标准 executor（Docker 路径不变）', async () => {
    const { finalEvaluateDispatchNode } = await import('../harness-initiative.graph.js');

    const mockExecutor = vi.fn(async () => ({ exit_code: 1, timed_out: false, stderr: '' }));
    const mockHostExecutor = vi.fn(async () => ({ exit_code: 1, timed_out: false, stderr: '' }));
    const mockExecFile = vi.fn(async () => ({ stdout: '', stderr: '' }));

    const state = {
      worktreePath: '/fake/worktree',
      task: { id: 'task-local', payload: { target_environment: 'local_api' } },
      taskPlan: { journey_type: 'autonomous', target_environment: 'local_api' },
      sub_tasks: [],
      initiativeId: 'init-local',
      githubToken: 'tok',
      contractBranch: null,
      final_e2e_verdict: null,
    };

    await finalEvaluateDispatchNode(state, {
      executor: mockExecutor,
      hostExecutor: mockHostExecutor,
      execFile: mockExecFile,
    });

    expect(mockExecutor).toHaveBeenCalled();
    expect(mockHostExecutor).not.toHaveBeenCalled();
  });

  it('zenithjoy base_repo → WINDOWS_CLOUD_WORKFLOW=agent-e2e-video.yml', async () => {
    const { finalEvaluateDispatchNode } = await import('../harness-initiative.graph.js');

    let injectedEnv = null;
    const mockExecutor = vi.fn(async (opts) => {
      injectedEnv = opts.env || {};
      return { exit_code: 1, timed_out: false, stderr: '' };
    });
    const mockExecFile = vi.fn(async () => ({ stdout: '', stderr: '' }));

    const state = {
      worktreePath: '/fake/worktree',
      task: {
        id: 'task-zenithjoy',
        payload: {
          target_environment: 'windows_cloud',
          base_repo: '/Users/administrator/perfect21/zenithjoy',
        },
      },
      taskPlan: { journey_type: 'user_facing', target_environment: 'windows_cloud' },
      sub_tasks: [],
      initiativeId: 'init-zj',
      githubToken: 'tok',
      contractBranch: null,
      final_e2e_verdict: null,
    };

    await finalEvaluateDispatchNode(state, { executor: mockExecutor, execFile: mockExecFile });

    expect(injectedEnv?.WINDOWS_CLOUD_WORKFLOW).toBe('agent-e2e-video.yml');
  });

  it('cecelia base_repo → WINDOWS_CLOUD_WORKFLOW=e2e-windows.yml', async () => {
    const { finalEvaluateDispatchNode } = await import('../harness-initiative.graph.js');

    let injectedEnv = null;
    const mockExecutor = vi.fn(async (opts) => {
      injectedEnv = opts.env || {};
      return { exit_code: 1, timed_out: false, stderr: '' };
    });
    const mockExecFile = vi.fn(async () => ({ stdout: '', stderr: '' }));

    const state = {
      worktreePath: '/fake/worktree',
      task: {
        id: 'task-cecelia',
        payload: {
          target_environment: 'windows_cloud',
          base_repo: '/Users/administrator/perfect21/cecelia',
        },
      },
      taskPlan: { journey_type: 'autonomous', target_environment: 'windows_cloud' },
      sub_tasks: [],
      initiativeId: 'init-cc',
      githubToken: 'tok',
      contractBranch: null,
      final_e2e_verdict: null,
    };

    await finalEvaluateDispatchNode(state, { executor: mockExecutor, execFile: mockExecFile });

    expect(injectedEnv?.WINDOWS_CLOUD_WORKFLOW).toBe('e2e-windows.yml');
  });

  it('mac_web → WORKSPACE_PATH 注入 worktreePath', async () => {
    const { finalEvaluateDispatchNode } = await import('../harness-initiative.graph.js');

    let injectedEnv = null;
    const mockHostExecutor = vi.fn(async (opts) => {
      injectedEnv = opts.env || {};
      return { exit_code: 1, timed_out: false, stderr: '' };
    });
    const mockExecFile = vi.fn(async () => ({ stdout: '', stderr: '' }));

    const state = {
      worktreePath: '/fake/worktree/mac-test',
      task: { id: 'task-wp', payload: { target_environment: 'mac_web' } },
      taskPlan: { journey_type: 'autonomous', target_environment: 'mac_web' },
      sub_tasks: [],
      initiativeId: 'init-wp',
      githubToken: 'tok',
      contractBranch: null,
      final_e2e_verdict: null,
    };

    await finalEvaluateDispatchNode(state, {
      executor: vi.fn(async () => ({ exit_code: 1, timed_out: false })),
      hostExecutor: mockHostExecutor,
      execFile: mockExecFile,
    });

    expect(injectedEnv?.WORKSPACE_PATH).toBe('/fake/worktree/mac-test');
  });

  it('evaluator 注入 CECELIA_GOAL_SETTINGS（Goal Go 机制）', async () => {
    const { finalEvaluateDispatchNode } = await import('../harness-initiative.graph.js');

    let injectedEnv = null;
    const mockExecutor = vi.fn(async (opts) => {
      injectedEnv = opts.env || {};
      return { exit_code: 1, timed_out: false, stderr: '' };
    });
    const mockExecFile = vi.fn(async () => ({ stdout: '', stderr: '' }));

    const state = {
      worktreePath: '/fake/worktree',
      task: { id: 'task-goal', payload: { target_environment: 'local_api' } },
      taskPlan: { journey_type: 'autonomous', target_environment: 'local_api' },
      sub_tasks: [],
      initiativeId: 'init-goal',
      githubToken: 'tok',
      contractBranch: null,
      final_e2e_verdict: null,
    };

    await finalEvaluateDispatchNode(state, { executor: mockExecutor, execFile: mockExecFile });

    expect(injectedEnv?.CECELIA_GOAL_SETTINGS).toBeTruthy();
    const parsed = JSON.parse(injectedEnv.CECELIA_GOAL_SETTINGS);
    expect(parsed).toHaveProperty('hooks.Stop');
  });
});

describe('host-executor module', () => {
  it('exports executeOnHost function', async () => {
    const mod = await import('../../spawn/host-executor.js');
    expect(typeof mod.executeOnHost).toBe('function');
  });

  it('throws if task.id missing', async () => {
    const { executeOnHost } = await import('../../spawn/host-executor.js');
    await expect(executeOnHost({ task: {}, prompt: 'test' })).rejects.toThrow('task.id required');
  });

  it('throws if prompt is not a string', async () => {
    const { executeOnHost } = await import('../../spawn/host-executor.js');
    await expect(executeOnHost({ task: { id: 'tid' }, prompt: null })).rejects.toThrow('prompt required');
  });
});

describe('harness-task.graph — generator spawn CECELIA_GOAL_SETTINGS', () => {
  it('harness-task.graph.js 源码包含 CECELIA_GOAL_SETTINGS 注入给 generator', () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(
      new URL('../harness-task.graph.js', import.meta.url),
      'utf8'
    );
    // 验证 spawnNode（generator）注入 CECELIA_GOAL_SETTINGS
    expect(src).toContain('CECELIA_GOAL_SETTINGS');
    expect(src).toContain('buildHarnessGoalSettings');
    // 验证 generator 相关的 goal condition 文本
    expect(src).toContain('workstream implementation PR has been created');
  });

  it('harness-task.graph.js 源码包含 evaluateContractNode 的 CECELIA_GOAL_SETTINGS', () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(
      new URL('../harness-task.graph.js', import.meta.url),
      'utf8'
    );
    // 验证 evaluateContractNode 也注入 CECELIA_GOAL_SETTINGS
    expect(src).toContain('evaluation is complete and .brain-result.json');
  });
});
