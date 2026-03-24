/**
 * PR Callback Handler 单元测试
 *
 * 测试 GitHub Webhook 处理逻辑：
 *   - verifyWebhookSignature: HMAC SHA-256 验证
 *   - matchTaskByBranchOrUrl: 根据分支名匹配任务（in_progress 优先，其次 completed）
 *   - handlePrMerged: 完整 PR 合并处理流程
 *   - extractPrInfo: 从 GitHub payload 提取 PR 信息
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import {
  verifyWebhookSignature,
  matchTaskByBranchOrUrl,
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

// ===== matchTaskByBranchOrUrl 测试 =====
describe('matchTaskByBranchOrUrl', () => {
  it('应该根据 branch name 优先匹配 in_progress 任务', async () => {
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

    const result = await matchTaskByBranchOrUrl(mockPool, 'cp-03050939-task-name');

    expect(result).toEqual(mockTask);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'in_progress'"),
      ['cp-03050939-task-name']
    );
  });

  it('当 in_progress 无匹配时应该查 completed 任务（by pr_url）', async () => {
    const mockCompletedTask = {
      id: 'task-uuid-completed',
      title: '已完成的任务',
      status: 'completed',
      project_id: 'proj-1',
      goal_id: 'goal-1',
      metadata: { branch: 'cp-03050939-task-name' },
      payload: null,
      task_type: 'dev'
    };

    const mockPool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // in_progress 查询无结果
        .mockResolvedValueOnce({ rows: [mockCompletedTask], rowCount: 1 }) // completed 查询有结果
    };

    const result = await matchTaskByBranchOrUrl(mockPool, 'cp-03050939-task-name');

    expect(result).toEqual(mockCompletedTask);
    expect(mockPool.query).toHaveBeenCalledTimes(2);
    // 第二次查询应包含 completed 和 pr_merged_at IS NULL
    expect(mockPool.query.mock.calls[1][0]).toContain("status = 'completed'");
    expect(mockPool.query.mock.calls[1][0]).toContain('pr_merged_at IS NULL');
    expect(mockPool.query.mock.calls[1][0]).toContain("pr_url LIKE");
  });

  it('当无匹配任务时应该返回 null 并记录警告', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mockPool = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 }))
    };

    const result = await matchTaskByBranchOrUrl(mockPool, 'cp-no-match');

    expect(result).toBeNull();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('cp-no-match')
    );

    consoleWarnSpy.mockRestore();
  });

  it('当 branchName 为空时应该返回 null', async () => {
    const mockPool = { query: vi.fn() };

    const result = await matchTaskByBranchOrUrl(mockPool, '');
    expect(result).toBeNull();
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('当 branchName 为 null 时应该返回 null', async () => {
    const mockPool = { query: vi.fn() };

    const result = await matchTaskByBranchOrUrl(mockPool, null);
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

  it('应该在 SQL UPDATE 中直接写入 pr_url 和 pr_merged_at 列', async () => {
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
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-uuid-1',
            goal_id: 'goal-1',
            project_id: 'proj-1',
            pr_url: prInfo.prUrl,
            pr_merged_at: prInfo.mergedAt
          }],
          rowCount: 1
        }) // UPDATE RETURNING
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }), // COMMIT
      release: vi.fn()
    };

    const mockPool = {
      query: vi.fn().mockResolvedValueOnce({ rows: [mockTask], rowCount: 1 }),
      connect: vi.fn(async () => mockClient)
    };

    await handlePrMerged(mockPool, prInfo);

    // 验证 UPDATE SQL 包含 pr_url 和 pr_merged_at 直接列
    const updateSql = mockClient.query.mock.calls[1][0];
    expect(updateSql).toContain('pr_url = $5');
    expect(updateSql).toContain('pr_merged_at = COALESCE($6::timestamp, NOW())');
    expect(updateSql).toContain('RETURNING');
    expect(updateSql).toContain('pr_url');
    expect(updateSql).toContain('pr_merged_at');

    // 验证参数：$5 = prUrl, $6 = mergedAt
    const updateParams = mockClient.query.mock.calls[1][1];
    expect(updateParams).toHaveLength(6);
    expect(updateParams[4]).toBe(prInfo.prUrl);
    expect(updateParams[5]).toBe(prInfo.mergedAt);
  });

  it('应该通过 pr_url 匹配 completed 任务并只更新 pr_merged_at（不改 status）', async () => {
    const mockCompletedTask = {
      id: 'task-uuid-completed',
      title: '已完成的任务',
      status: 'completed',
      project_id: 'proj-1',
      goal_id: 'goal-1',
      metadata: { branch: 'cp-03050939-task-name' },
      payload: null,
      task_type: 'dev'
    };

    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'task-uuid-completed' }], rowCount: 1 }) // UPDATE pr_merged_at
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }), // COMMIT
      release: vi.fn()
    };

    const mockPool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // matchTaskByBranchOrUrl: in_progress 无结果
        .mockResolvedValueOnce({ rows: [mockCompletedTask], rowCount: 1 }), // matchTaskByBranchOrUrl: completed 有结果
      connect: vi.fn(async () => mockClient)
    };

    const result = await handlePrMerged(mockPool, prInfo);

    expect(result.matched).toBe(true);
    expect(result.taskId).toBe('task-uuid-completed');
    expect(result.krProgressUpdated).toBe(false); // 不触发 KR 进度

    // 验证 UPDATE SQL 只更新 pr_url 和 pr_merged_at（SET 中无 status 赋值）
    const updateSql = mockClient.query.mock.calls[1][0];
    expect(updateSql).toContain('pr_url = COALESCE(pr_url, $2)');
    expect(updateSql).toContain('pr_merged_at = $3');
    // 参数只有 3 个（taskId, prUrl, mergedAt），没有新 status 值
    const updateParams = mockClient.query.mock.calls[1][1];
    expect(updateParams).toHaveLength(3);
    expect(updateParams[0]).toBe('task-uuid-completed');
    expect(updateParams[1]).toBe(prInfo.prUrl);
    expect(updateParams[2]).toBe(prInfo.mergedAt);
  });

  it('应该幂等处理 - completed 任务 pr_merged_at 已有值时不重复更新', async () => {
    const mockCompletedTask = {
      id: 'task-uuid-completed',
      title: '已完成的任务',
      status: 'completed',
      project_id: 'proj-1',
      goal_id: 'goal-1',
      metadata: {},
      payload: null,
      task_type: 'dev'
    };

    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // UPDATE（rowCount=0 表示 pr_merged_at 已有值）
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }), // ROLLBACK
      release: vi.fn()
    };

    const mockPool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // matchTaskByBranchOrUrl: in_progress 无结果
        .mockResolvedValueOnce({ rows: [mockCompletedTask], rowCount: 1 }), // matchTaskByBranchOrUrl: completed 有结果
      connect: vi.fn(async () => mockClient)
    };

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handlePrMerged(mockPool, prInfo);

    expect(result.matched).toBe(true);
    expect(result.taskId).toBe('task-uuid-completed');
    expect(result.krProgressUpdated).toBe(false);

    // 验证使用了 ROLLBACK（幂等）
    const clientCalls = mockClient.query.mock.calls.map(c => c[0]);
    expect(clientCalls[2]).toBe('ROLLBACK');

    consoleSpy.mockRestore();
  });

  it('in_progress 任务仍走完整更新路径（status → completed + KR 进度）', async () => {
    const mockInProgressTask = {
      id: 'task-uuid-inprogress',
      title: '进行中的任务',
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
        .mockResolvedValueOnce({
          rows: [{ id: 'task-uuid-inprogress', goal_id: 'goal-1', project_id: 'proj-1', pr_url: prInfo.prUrl, pr_merged_at: prInfo.mergedAt }],
          rowCount: 1
        }) // UPDATE status → completed
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }), // COMMIT
      release: vi.fn()
    };

    const mockPool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [mockInProgressTask], rowCount: 1 }), // matchTaskByBranchOrUrl: in_progress 命中
      connect: vi.fn(async () => mockClient)
    };

    const result = await handlePrMerged(mockPool, prInfo);

    expect(result.matched).toBe(true);
    expect(result.taskId).toBe('task-uuid-inprogress');
    expect(result.krProgressUpdated).toBe(true); // KR 进度已触发

    // 验证 UPDATE SQL 包含 status = 'completed'
    const updateSql = mockClient.query.mock.calls[1][0];
    expect(updateSql).toContain("status = 'completed'");
    expect(updateSql).toContain('pr_url = $5');
    expect(updateSql).toContain('pr_merged_at = COALESCE($6::timestamp, NOW())');

    // 验证事务序列
    const clientCalls = mockClient.query.mock.calls.map(c => c[0]);
    expect(clientCalls[0]).toBe('BEGIN');
    expect(clientCalls[2]).toBe('COMMIT');
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
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })          // task_run_metrics UPDATE pr_merged
        .mockResolvedValueOnce({ rows: [{ prd_content: null }], rowCount: 1 }) // dev_records: SELECT prd_content
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })          // dev_records: INSERT
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

// ===== DoD-4: pr_merged 回填 task_run_metrics =====
describe('handlePrMerged — task_run_metrics pr_merged 回填', () => {
  const prInfo = {
    repo: 'owner/repo',
    prNumber: 456,
    branchName: 'cp-03091900-metrics-test',
    prUrl: 'https://github.com/owner/repo/pull/456',
    mergedAt: '2026-03-09T19:00:00Z',
    title: 'feat: metrics test'
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('in_progress 路径：合并后应 UPDATE task_run_metrics SET pr_merged = TRUE', async () => {
    const mockTask = {
      id: 'task-metrics-001',
      title: '测试 metrics 回填',
      status: 'in_progress',
      project_id: 'proj-metrics',
      goal_id: 'goal-metrics',
      metadata: { branch: 'cp-03091900-metrics-test' },
      payload: null,
      task_type: 'dev'
    };

    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: 'task-metrics-001', goal_id: 'goal-metrics', project_id: 'proj-metrics',
                   pr_url: prInfo.prUrl, pr_merged_at: prInfo.mergedAt }],
          rowCount: 1
        }) // UPDATE tasks → completed
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }), // COMMIT
      release: vi.fn()
    };

    const poolQueries = [];
    const mockPool = {
      query: vi.fn(async (sql, params) => {
        poolQueries.push({ sql, params });
        // First call: matchTaskByBranchOrUrl in_progress
        if (poolQueries.length === 1) return { rows: [mockTask], rowCount: 1 };
        // Subsequent calls: task_run_metrics UPDATE, kr lookup etc.
        return { rows: [], rowCount: 0 };
      }),
      connect: vi.fn(async () => mockClient)
    };

    const result = await handlePrMerged(mockPool, prInfo);
    expect(result.matched).toBe(true);

    // 找到 task_run_metrics UPDATE 调用
    const metricsCall = poolQueries.find(c => c.sql && c.sql.includes('task_run_metrics'));
    expect(metricsCall).toBeDefined();
    expect(metricsCall.sql).toContain('pr_merged = TRUE');
    expect(metricsCall.params[0]).toBe('task-metrics-001');
  });

  it('completed 路径：回填 pr_merged_at 后也应 UPDATE task_run_metrics SET pr_merged = TRUE', async () => {
    const completedTask = {
      id: 'task-metrics-002',
      title: '已完成的任务',
      status: 'completed',
      project_id: 'proj-metrics',
      goal_id: null,
      metadata: {},
      payload: null,
      task_type: 'dev'
    };

    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'task-metrics-002' }], rowCount: 1 }) // UPDATE pr_merged_at
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }), // COMMIT
      release: vi.fn()
    };

    const poolQueries = [];
    const mockPool = {
      query: vi.fn(async (sql, params) => {
        poolQueries.push({ sql, params });
        if (poolQueries.length === 1) return { rows: [], rowCount: 0 }; // in_progress: no match
        if (poolQueries.length === 2) return { rows: [completedTask], rowCount: 1 }; // completed: match
        // task_run_metrics UPDATE
        return { rows: [], rowCount: 0 };
      }),
      connect: vi.fn(async () => mockClient)
    };

    const result = await handlePrMerged(mockPool, prInfo);
    expect(result.matched).toBe(true);
    expect(result.krProgressUpdated).toBe(false); // completed 路径不触发 KR 进度

    // 找到 task_run_metrics UPDATE 调用
    const metricsCall = poolQueries.find(c => c.sql && c.sql.includes('task_run_metrics'));
    expect(metricsCall).toBeDefined();
    expect(metricsCall.sql).toContain('pr_merged = TRUE');
    expect(metricsCall.params[0]).toBe('task-metrics-002');
  });
});
