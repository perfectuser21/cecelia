/**
 * Cross-Package API 集成测试
 *
 * 覆盖范围：
 *   1. Brain API（port 5221）任务 CRUD — tasks/tasks 端点
 *   2. Brain API 战略决策 CRUD — strategic-decisions 端点
 *   3. 跨模块校验：创建的任务可通过 GET /api/brain/tasks 查询到
 *   4. Workspace API（port 5220）— 服务未运行时自动跳过
 *
 * 关键设计：
 *   - beforeAll 创建所有测试数据
 *   - afterAll 通过 PATCH/PUT 将测试数据置为终态（cancelled/expired）实现清理
 *   - 所有测试数据标题以 [TEST-XPKG] 为前缀，方便识别
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BRAIN_BASE = process.env.BRAIN_BASE || 'http://localhost:5221';
const WORKSPACE_BASE = process.env.API_BASE || 'http://localhost:5220';
const TEST_PREFIX = '[TEST-XPKG]';

// ────────────────────────────────────────────────────────────
// 工具函数：检查服务是否可用
// ────────────────────────────────────────────────────────────
async function isServiceAvailable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────────────────────
// Suite 1: Brain API Tasks — CRUD + 自动清理
// ────────────────────────────────────────────────────────────
describe('Brain API — Task CRUD with Auto Cleanup', () => {
  let createdTaskId: string;
  let secondTaskId: string;
  let brainAvailable = false;

  beforeAll(async () => {
    brainAvailable = await isServiceAvailable(`${BRAIN_BASE}/api/brain/tasks`);
    if (!brainAvailable) return;

    // 创建主测试任务
    const res = await fetch(`${BRAIN_BASE}/api/brain/tasks/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `${TEST_PREFIX} 主集成测试任务`,
        description: 'Cross-Package 集成测试自动创建，测试完毕后自动清理',
        priority: 'P2',
        task_type: 'dev',
        trigger_source: 'test',
      }),
    });
    expect(res.status).toBe(201);
    const task = await res.json();
    createdTaskId = task.id;

    // 创建辅助测试任务（用于验证列表查询）
    const res2 = await fetch(`${BRAIN_BASE}/api/brain/tasks/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `${TEST_PREFIX} 辅助测试任务`,
        priority: 'P2',
        task_type: 'research',
        trigger_source: 'test',
      }),
    });
    expect(res2.status).toBe(201);
    const task2 = await res2.json();
    secondTaskId = task2.id;
  });

  afterAll(async () => {
    if (!brainAvailable) return;

    // 清理：将测试任务状态置为 cancelled
    const cleanupIds = [createdTaskId, secondTaskId].filter(Boolean);
    for (const id of cleanupIds) {
      await fetch(`${BRAIN_BASE}/api/brain/tasks/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      });
    }
  });

  it('应跳过当 Brain 服务不可用时', () => {
    if (!brainAvailable) {
      console.log('[SKIP] Brain API 不可用，跳过 Task CRUD 测试');
      return;
    }
    expect(createdTaskId).toBeTruthy();
  });

  it('创建任务后应返回 201 及任务 ID', () => {
    if (!brainAvailable) return;
    expect(createdTaskId).toBeTruthy();
    expect(typeof createdTaskId).toBe('string');
  });

  it('GET /api/brain/tasks/tasks/:id 应返回刚创建的任务', async () => {
    if (!brainAvailable) return;
    const res = await fetch(`${BRAIN_BASE}/api/brain/tasks/tasks/${createdTaskId}`);
    expect(res.status).toBe(200);
    const task = await res.json();
    expect(task.id).toBe(createdTaskId);
    expect(task.title).toContain(TEST_PREFIX);
    expect(task.status).toBe('queued');
  });

  it('GET /api/brain/tasks 跨模块查询应包含创建的任务', async () => {
    if (!brainAvailable) return;
    const res = await fetch(`${BRAIN_BASE}/api/brain/tasks?limit=200`);
    expect(res.status).toBe(200);
    const tasks = await res.json();
    expect(Array.isArray(tasks)).toBe(true);
    const found = tasks.find((t: { id: string }) => t.id === createdTaskId);
    expect(found).toBeTruthy();
  });

  it('PATCH 更新任务优先级应成功', async () => {
    if (!brainAvailable) return;
    const res = await fetch(`${BRAIN_BASE}/api/brain/tasks/tasks/${createdTaskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority: 'P1' }),
    });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.priority).toBe('P1');
  });

  it('GET /api/brain/tasks/tasks 列表应包含两个测试任务', async () => {
    if (!brainAvailable) return;
    const res = await fetch(`${BRAIN_BASE}/api/brain/tasks/tasks?limit=200`);
    expect(res.status).toBe(200);
    const result = await res.json();
    // 兼容返回数组或 { data: [...] } 两种格式
    const tasks: Array<{ id: string }> = Array.isArray(result) ? result : (result.data ?? []);
    const ids = tasks.map((t) => t.id);
    expect(ids).toContain(createdTaskId);
    expect(ids).toContain(secondTaskId);
  });

  it('PATCH 不存在的任务应返回 404', async () => {
    if (!brainAvailable) return;
    const res = await fetch(
      `${BRAIN_BASE}/api/brain/tasks/tasks/00000000-0000-0000-0000-000000000000`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: 'P0' }),
      }
    );
    expect(res.status).toBe(404);
  });
});

// ────────────────────────────────────────────────────────────
// Suite 2: Brain API Strategic Decisions — CRUD + 自动清理
// ────────────────────────────────────────────────────────────
describe('Brain API — Strategic Decisions CRUD with Auto Cleanup', () => {
  let createdDecisionId: string;
  let brainAvailable = false;

  beforeAll(async () => {
    brainAvailable = await isServiceAvailable(`${BRAIN_BASE}/api/brain/strategic-decisions`);
    if (!brainAvailable) return;

    const res = await fetch(`${BRAIN_BASE}/api/brain/strategic-decisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: 'test',
        topic: `${TEST_PREFIX} 集成测试决策`,
        decision: '此决策由集成测试自动创建，测试结束后自动置为 expired',
        reason: 'Cross-Package 集成测试验证 afterAll cleanup 机制',
        status: 'active',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    createdDecisionId = body.data?.id ?? body.id;
  });

  afterAll(async () => {
    if (!brainAvailable || !createdDecisionId) return;

    // 清理：将测试决策状态置为 expired
    await fetch(`${BRAIN_BASE}/api/brain/strategic-decisions/${createdDecisionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'expired' }),
    });
  });

  it('创建战略决策应返回 201', () => {
    if (!brainAvailable) return;
    expect(createdDecisionId).toBeTruthy();
  });

  it('GET 列表应包含刚创建的决策', async () => {
    if (!brainAvailable) return;
    const res = await fetch(`${BRAIN_BASE}/api/brain/strategic-decisions?status=active&limit=100`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const decisions: Array<{ id: string }> = body.data ?? body;
    const found = decisions.find((d) => d.id === createdDecisionId);
    expect(found).toBeTruthy();
  });

  it('决策的 topic 应包含 TEST_PREFIX', async () => {
    if (!brainAvailable) return;
    const res = await fetch(`${BRAIN_BASE}/api/brain/strategic-decisions?status=active&limit=100`);
    const body = await res.json();
    const decisions: Array<{ id: string; topic: string }> = body.data ?? body;
    const found = decisions.find((d) => d.id === createdDecisionId);
    expect(found?.topic).toContain(TEST_PREFIX);
  });
});

// ────────────────────────────────────────────────────────────
// Suite 3: Workspace API — 服务不可用时跳过
// ────────────────────────────────────────────────────────────
describe('Workspace API — 可用时执行集成校验', () => {
  let workspaceAvailable = false;
  let testProjectId: string;

  beforeAll(async () => {
    workspaceAvailable = await isServiceAvailable(`${WORKSPACE_BASE}/api/workspaces`);
    if (!workspaceAvailable) return;

    const wsRes = await fetch(`${WORKSPACE_BASE}/api/workspaces`);
    const workspaces = await wsRes.json();
    const workspaceId = workspaces[0]?.id;

    const projRes = await fetch(`${WORKSPACE_BASE}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: workspaceId,
        name: `${TEST_PREFIX} Cross-Package Test Project`,
      }),
    });
    if (projRes.status === 201) {
      const project = await projRes.json();
      testProjectId = project.id;
    }
  });

  afterAll(async () => {
    if (!workspaceAvailable || !testProjectId) return;
    await fetch(`${WORKSPACE_BASE}/api/projects/${testProjectId}`, { method: 'DELETE' });
  });

  it('Workspace API 不可用时跳过（CI 环境正常行为）', () => {
    if (!workspaceAvailable) {
      console.log('[SKIP] Workspace API 不可用，跳过 Workspace 集成测试');
      return;
    }
    expect(testProjectId).toBeTruthy();
  });

  it('GET /api/workspaces 应返回工作区列表', async () => {
    if (!workspaceAvailable) return;
    const res = await fetch(`${WORKSPACE_BASE}/api/workspaces`);
    expect(res.status).toBe(200);
    const workspaces = await res.json();
    expect(Array.isArray(workspaces)).toBe(true);
  });

  it('创建的测试 Project 可被 GET 查询', async () => {
    if (!workspaceAvailable || !testProjectId) return;
    const res = await fetch(`${WORKSPACE_BASE}/api/projects/${testProjectId}`);
    expect(res.status).toBe(200);
    const project = await res.json();
    expect(project.name).toContain(TEST_PREFIX);
  });
});
