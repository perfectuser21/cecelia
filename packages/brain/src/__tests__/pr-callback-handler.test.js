/**
 * PR Callback Handler 单元测试
 *
 * 测试 GitHub Webhook 处理逻辑：
 *   - verifyWebhookSignature: HMAC SHA-256 验证
 *   - matchTaskByBranch: 根据分支名匹配任务
 *   - handlePrMerged: 完整 PR 合并处理流程
 *   - extractPrInfo: 从 GitHub payload 提取 PR 信息
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import {
  verifyWebhookSignature,
  matchTaskByBranch,
  handlePrMerged,
  extractPrInfo
} from '../pr-callback-handler.js';

// Mock kr-progress 模块
vi.mock('../kr-progress.js', () => ({
  updateKrProgress: vi.fn().mockResolvedValue({ krId: 'kr-1', progress: 75, completed: 3, total: 4 })
}));

// 创建 mock pool
function createMockPool(queryResults = []) {
  let callIndex = 0;

  const mockClient = {
    query: vi.fn(async () => queryResults[callIndex++] || { rows: [], rowCount: 0 }),
    release: vi.fn()
  };

  const mockPool = {
    query: vi.fn(async () => queryResults[callIndex++] || { rows: [], rowCount: 0 }),
    connect: vi.fn(async () => mockClient),
    _client: mockClient
  };

  return mockPool;
}

// ===== verifyWebhookSignature 测试 =====
describe('verifyWebhookSignature', () => {
  it('应该验证正确的 HMAC SHA-256 签名', () => {
    const secret = 'my-webhook-secret';
    const body = '{"action":"closed"}';
    const signature = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

    expect(verifyWebhookSignature(secret, signature, body)).toBe(true);
  });

  it('应该拒绝错误的签名', () => {
    const secret = 'my-webhook-secret';
    const body = '{"action":"closed"}';
    const wrongSignature = 'sha256=0000000000000000000000000000000000000000000000000000000000000000';

    expect(verifyWebhookSignature(secret, wrongSignature, body)).toBe(false);
  });

  it('应该拒绝缺少 sha256= 前缀的签名', () => {
    const secret = 'my-webhook-secret';
    const body = '{"action":"closed"}';
    const badSignature = crypto.createHmac('sha256', secret).update(body).digest('hex');

    expect(verifyWebhookSignature(secret, badSignature, body)).toBe(false);
  });

  it('应该拒绝空参数', () => {
    expect(verifyWebhookSignature('', 'sha256=abc', 'body')).toBe(false);
    expect(verifyWebhookSignature('secret', '', 'body')).toBe(false);
    expect(verifyWebhookSignature('secret', 'sha256=abc', '')).toBe(false);
    expect(verifyWebhookSignature(null, 'sha256=abc', 'body')).toBe(false);
  });

  it('应该支持 Buffer 类型的 body', () => {
    const secret = 'my-webhook-secret';
    const body = Buffer.from('{"action":"closed"}', 'utf8');
    const signature = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

    expect(verifyWebhookSignature(secret, signature, body)).toBe(true);
  });
});

// ===== extractPrInfo 测试 =====
describe('extractPrInfo', () => {
  it('应该提取合并 PR 的信息', () => {
    const payload = {
      action: 'closed',
      pull_request: {
        merged: true,
        number: 123,
        html_url: 'https://github.com/owner/repo/pull/123',
        title: 'feat: add webhook support',
        merged_at: '2026-03-05T01:00:00Z',
        head: { ref: 'cp-03050939-task-name' }
      },
      repository: {
        full_name: 'owner/repo'
      }
    };

    const result = extractPrInfo(payload);

    expect(result).toEqual({
      repo: 'owner/repo',
      prNumber: 123,
      branchName: 'cp-03050939-task-name',
      prUrl: 'https://github.com/owner/repo/pull/123',
      mergedAt: '2026-03-05T01:00:00Z',
      title: 'feat: add webhook support'
    });
  });

  it('应该对未合并的 PR 返回 null', () => {
    const payload = {
      action: 'closed',
      pull_request: {
        merged: false,
        number: 124,
        html_url: 'https://github.com/owner/repo/pull/124',
        title: 'feat: not merged',
        merged_at: null,
        head: { ref: 'feature/test' }
      },
      repository: { full_name: 'owner/repo' }
    };

    expect(extractPrInfo(payload)).toBeNull();
  });

  it('应该对非 closed 事件返回 null', () => {
    const payload = {
      action: 'opened',
      pull_request: {
        merged: false,
        number: 125,
        html_url: 'https://github.com/owner/repo/pull/125',
        title: 'feat: new PR',
        merged_at: null,
        head: { ref: 'feature/new' }
      },
      repository: { full_name: 'owner/repo' }
    };

    expect(extractPrInfo(payload)).toBeNull();
  });

  it('应该处理缺少 repository 的 payload', () => {
    const payload = {
      action: 'closed',
      pull_request: {
        merged: true,
        number: 126,
        html_url: 'https://github.com/owner/repo/pull/126',
        title: 'feat: test',
        merged_at: '2026-03-05T01:00:00Z',
        head: { ref: 'cp-xxx' }
      }
    };

    const result = extractPrInfo(payload);
    expect(result).not.toBeNull();
    expect(result.repo).toBe('');
  });
});

// ===== matchTaskByBranch 测试 =====
describe('matchTaskByBranch', () => {
  it('应该根据 branch name 匹配 in_progress 任务', async () => {
    const mockTask = {
      id: 'task-uuid-1',
      title: '实现 GitHub Webhook',
      status: 'in_progress',
      project_id: 'proj-1',
      goal_id: 'goal-1',
      metadata: { branch: 'cp-03050939-task-name' },
      payload: null,
      task_type: 'dev'
    };

    const mockPool = {
      query: vi.fn(async () => ({ rows: [mockTask], rowCount: 1 }))
    };

    const result = await matchTaskByBranch(mockPool, 'cp-03050939-task-name');

    expect(result).toEqual(mockTask);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'in_progress'"),
      ['cp-03050939-task-name']
    );
  });

  it('当无匹配任务时应该返回 null 并记录警告', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mockPool = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 }))
    };

    const result = await matchTaskByBranch(mockPool, 'cp-no-match');

    expect(result).toBeNull();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('cp-no-match')
    );

    consoleWarnSpy.mockRestore();
  });

  it('当 branchName 为空时应该返回 null', async () => {
    const mockPool = { query: vi.fn() };

    const result = await matchTaskByBranch(mockPool, '');
    expect(result).toBeNull();
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('当 branchName 为 null 时应该返回 null', async () => {
    const mockPool = { query: vi.fn() };

    const result = await matchTaskByBranch(mockPool, null);
    expect(result).toBeNull();
    expect(mockPool.query).not.toHaveBeenCalled();
  });
});

// ===== handlePrMerged 测试 =====
describe('handlePrMerged', () => {
  const prInfo = {
    repo: 'owner/repo',
    prNumber: 123,
    branchName: 'cp-03050939-task-name',
    prUrl: 'https://github.com/owner/repo/pull/123',
    mergedAt: '2026-03-05T01:00:00Z',
    title: 'feat: add webhook support'
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应该成功更新任务状态为 completed 并更新 KR 进度', async () => {
    const mockTask = {
      id: 'task-uuid-1',
      title: '实现 GitHub Webhook',
      status: 'in_progress',
      project_id: 'proj-1',
      goal_id: 'goal-1',
      metadata: { branch: 'cp-03050939-task-name' },
      payload: null,
      task_type: 'dev'
    };

    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'task-uuid-1', goal_id: 'goal-1', project_id: 'proj-1' }], rowCount: 1 }) // UPDATE
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }), // COMMIT
      release: vi.fn()
    };

    const mockPool = {
      query: vi.fn()
        // matchTaskByBranch 查询
        .mockResolvedValueOnce({ rows: [mockTask], rowCount: 1 }),
      connect: vi.fn(async () => mockClient)
    };

    const result = await handlePrMerged(mockPool, prInfo);

    expect(result.matched).toBe(true);
    expect(result.taskId).toBe('task-uuid-1');
    expect(result.taskTitle).toBe('实现 GitHub Webhook');

    // 验证事务流程
    const clientCalls = mockClient.query.mock.calls.map(c => c[0]);
    expect(clientCalls[0]).toBe('BEGIN');
    expect(clientCalls[1]).toContain("status = 'completed'");
    expect(clientCalls[2]).toBe('COMMIT');
  });

  it('当无匹配任务时应该返回 matched: false', async () => {
    const mockPool = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      connect: vi.fn()
    };

    const result = await handlePrMerged(mockPool, prInfo);

    expect(result.matched).toBe(false);
    expect(result.taskId).toBeNull();
    expect(mockPool.connect).not.toHaveBeenCalled(); // 无匹配则不开事务
  });

  it('当任务已不是 in_progress 时应该幂等处理（不报错）', async () => {
    const mockTask = {
      id: 'task-uuid-1',
      title: '实现 GitHub Webhook',
      status: 'in_progress',
      project_id: 'proj-1',
      goal_id: 'goal-1',
      metadata: {},
      payload: null,
      task_type: 'dev'
    };

    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // UPDATE（rowCount=0 表示任务已不是 in_progress）
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }), // ROLLBACK
      release: vi.fn()
    };

    const mockPool = {
      query: vi.fn(async () => ({ rows: [mockTask], rowCount: 1 })),
      connect: vi.fn(async () => mockClient)
    };

    const result = await handlePrMerged(mockPool, prInfo);

    expect(result.matched).toBe(true);
    expect(result.krProgressUpdated).toBe(false);

    // 验证使用了 ROLLBACK（不是 COMMIT）
    const clientCalls = mockClient.query.mock.calls.map(c => c[0]);
    expect(clientCalls[2]).toBe('ROLLBACK');
  });

  it('当 goal_id 为空时应该尝试通过 project_id 查找 KR', async () => {
    const mockTask = {
      id: 'task-uuid-2',
      title: '另一个任务',
      status: 'in_progress',
      project_id: 'proj-1',
      goal_id: null, // 无直接关联 KR
      metadata: { branch: 'cp-03050939-task-name' },
      payload: null,
      task_type: 'dev'
    };

    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'task-uuid-2', goal_id: null, project_id: 'proj-1' }], rowCount: 1 }) // UPDATE
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }), // COMMIT
      release: vi.fn()
    };

    const mockPool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [mockTask], rowCount: 1 }) // matchTaskByBranch
        .mockResolvedValueOnce({ rows: [{ kr_id: 'kr-via-project' }], rowCount: 1 }), // 通过 project_id 查 KR
      connect: vi.fn(async () => mockClient)
    };

    const { updateKrProgress } = vi.mocked(await import('../kr-progress.js'));
    updateKrProgress.mockResolvedValueOnce({ krId: 'kr-via-project', progress: 50 });

    const result = await handlePrMerged(mockPool, prInfo);

    expect(result.matched).toBe(true);
    expect(result.krProgressUpdated).toBe(true);
  });
});

// ===== 集成测试：模拟 GitHub Webhook payload =====
describe('完整 webhook payload 集成测试', () => {
  it('应该正确处理真实 GitHub pull_request 合并 payload', () => {
    // 模拟 GitHub 真实发送的 pull_request 事件
    const githubPayload = {
      action: 'closed',
      number: 531,
      pull_request: {
        url: 'https://api.github.com/repos/perfectuser21/cecelia/pulls/531',
        id: 123456789,
        number: 531,
        state: 'closed',
        locked: false,
        title: 'fix(brain): 修复 cecelia-run 和 executor 的 WORK_DIR 默认路径',
        user: { login: 'perfectuser21' },
        body: '## Summary\n- 修复了 WORK_DIR 默认路径问题',
        merged: true,
        merged_at: '2026-03-05T01:40:15Z',
        merge_commit_sha: 'abc123def456',
        head: {
          ref: 'cp-03050939-d9b188a6-a64d-4e44-9b5e-8af0c4',
          sha: 'abc123'
        },
        base: {
          ref: 'main',
          sha: 'def456'
        },
        html_url: 'https://github.com/perfectuser21/cecelia/pull/531'
      },
      repository: {
        id: 987654321,
        name: 'cecelia',
        full_name: 'perfectuser21/cecelia'
      }
    };

    const prInfo = extractPrInfo(githubPayload);

    expect(prInfo).not.toBeNull();
    expect(prInfo.repo).toBe('perfectuser21/cecelia');
    expect(prInfo.prNumber).toBe(531);
    expect(prInfo.branchName).toBe('cp-03050939-d9b188a6-a64d-4e44-9b5e-8af0c4');
    expect(prInfo.prUrl).toBe('https://github.com/perfectuser21/cecelia/pull/531');
    expect(prInfo.mergedAt).toBe('2026-03-05T01:40:15Z');
    expect(prInfo.title).toBe('fix(brain): 修复 cecelia-run 和 executor 的 WORK_DIR 默认路径');
  });
});
