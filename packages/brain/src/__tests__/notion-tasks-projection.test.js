/**
 * pushTasks 投影 Project / Blocked by（链 bf5088a3 棒5·PR B，任务 3fad28e0，决策 105a5868）。
 *
 * Notion Tasks 库（d5bc40c2）实测已有 Project（dual→Projects 库）与 Blocked by（dual 自关联）两列，
 * 但 pushTasks 此前只推 Name/Status/Description（+ parent 是 project 时的 Project）。
 * 纪律：
 *  1. Blocked by 只推「已投影且带本系统指纹」的前置任务（旧时代 13483 条遗产 notion_id 指向别处，不能当 relation 目标）
 *  2. 依赖/根后到 → 指纹变化即重推（pushed_project / pushed_blockers），不能只靠 status 指纹
 *  3. 缺列先补（Notion 缺列 400 的血训）；补不上 / 推送含 Blocked by 报错 → 该列 flag-off 安全跳过，
 *     且绝不清 notion_id（400 会被 isWrongDatabaseError 误判成错库而重建页面 = 重复页）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockNotionReq = vi.fn();
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));
vi.mock('../recurring-notion-sync.js', () => ({ notionReq: mockNotionReq, getToken: () => 'fake-token' }));
vi.mock('../work-routing-store.js', () => ({ createRoutedTask: vi.fn() }));

const TASKS_DB = 'd5bc40c2-ba63-82ef-965a-8153b7ad81a0';

const task = (over = {}) => ({
  id: 't-1', title: '子任务', status: 'queued', priority: 'P2', task_type: 'dev', kind: 'agent',
  notion_id: null, notion_props: null, project_notion_id: null, blocker_notion_ids: [], ...over,
});

beforeEach(() => {
  mockQuery.mockReset();
  mockNotionReq.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

describe('buildTaskNotionProperties（纯函数）', () => {
  it('blockedBy 关闭 → 只有原三列（+ Project），与今天一致', async () => {
    const { buildTaskNotionProperties } = await import('../notion-push-sync.js');
    const p = buildTaskNotionProperties(task({ blocker_notion_ids: ['b1'] }), { blockedBy: false });
    expect(Object.keys(p).sort()).toEqual(['Description', 'Name', 'Status']);
  });

  it('project 根已投影 → Project relation；blockedBy 开启且有前置 → Blocked by relation', async () => {
    const { buildTaskNotionProperties } = await import('../notion-push-sync.js');
    const p = buildTaskNotionProperties(task({ project_notion_id: 'proj-1', blocker_notion_ids: ['b1', 'b2'] }), { blockedBy: true });
    expect(p.Project).toEqual({ relation: [{ id: 'proj-1' }] });
    expect(p['Blocked by']).toEqual({ relation: [{ id: 'b1' }, { id: 'b2' }] });
  });

  it('前置被全部移除（指纹里曾有）→ 发空 relation 清掉；从没有过前置 → 不发该列', async () => {
    const { buildTaskNotionProperties } = await import('../notion-push-sync.js');
    const cleared = buildTaskNotionProperties(task({ notion_props: { pushed_blockers: 'b1' }, blocker_notion_ids: [] }), { blockedBy: true });
    expect(cleared['Blocked by']).toEqual({ relation: [] });
    const never = buildTaskNotionProperties(task({ blocker_notion_ids: [] }), { blockedBy: true });
    expect('Blocked by' in never).toBe(false);
  });

  it('一致性：推送用到的每个 Notion 列，要么是库既有列白名单，要么在缺列即补的清单里', async () => {
    const { buildTaskNotionProperties } = await import('../notion-push-sync.js');
    const { buildTasksDbProps } = await import('../ops-notion-schema.js');
    const EXISTING = new Set(['Name', 'Status', 'Description', 'Project']); // 2026-09-25 实测 Tasks 库既有列
    const ensured = new Set(Object.keys(buildTasksDbProps(TASKS_DB)));
    const used = Object.keys(buildTaskNotionProperties(
      task({ project_notion_id: 'p', blocker_notion_ids: ['b'] }), { blockedBy: true },
    ));
    const orphan = used.filter((k) => !EXISTING.has(k) && !ensured.has(k));
    expect(orphan, `这些列推送会用到但既不在库既有列也不在补列清单（Notion 缺列 400）：${orphan}`).toEqual([]);
    expect(buildTasksDbProps(TASKS_DB)['Blocked by']).toEqual({ relation: { database_id: TASKS_DB, dual_property: {} } });
  });
});

describe('pushTasksForTest 行为', () => {
  it('create：带 Project 与 Blocked by，指纹写回 pushed_project / pushed_blockers', async () => {
    mockNotionReq.mockResolvedValue({ id: 'page-new' });
    const { pushTasksForTest } = await import('../notion-push-sync.js');
    await pushTasksForTest({ query: mockQuery }, 'tok', [task({ project_notion_id: 'proj-1', blocker_notion_ids: ['b1'] })], { blockedBy: true });
    const create = mockNotionReq.mock.calls.find((c) => c[1] === '/pages' && c[2] === 'POST');
    expect(create[3].properties['Blocked by']).toEqual({ relation: [{ id: 'b1' }] });
    expect(create[3].properties.Project).toEqual({ relation: [{ id: 'proj-1' }] });
    const upd = mockQuery.mock.calls.find((c) => /UPDATE tasks/.test(c[0]));
    expect(upd[1]).toEqual(expect.arrayContaining(['t-1', 'queued', 'proj-1', 'b1']));
  });

  it('blockedBy 关闭：不发 Blocked by，也不动 pushed_blockers 指纹（等列恢复后自然重推）', async () => {
    mockNotionReq.mockResolvedValue({ id: 'page-new' });
    const { pushTasksForTest } = await import('../notion-push-sync.js');
    await pushTasksForTest({ query: mockQuery }, 'tok', [task({ blocker_notion_ids: ['b1'] })], { blockedBy: false });
    const create = mockNotionReq.mock.calls.find((c) => c[1] === '/pages' && c[2] === 'POST');
    expect('Blocked by' in create[3].properties).toBe(false);
    const upd = mockQuery.mock.calls.find((c) => /UPDATE tasks/.test(c[0]));
    expect(upd[0]).not.toMatch(/pushed_blockers/);
  });

  it('违规形态：推送因 Blocked by 报 400 → 不清 notion_id（否则会被误判错库、重建重复页）', async () => {
    mockNotionReq.mockRejectedValue(new Error('Notion 400: Blocked by is not a property that exists.'));
    const { pushTasksForTest } = await import('../notion-push-sync.js');
    await pushTasksForTest(
      { query: mockQuery }, 'tok',
      [task({ notion_id: 'our-page', notion_props: { pushed_status: 'queued' }, status: 'in_progress', blocker_notion_ids: ['b1'] })],
      { blockedBy: true },
    );
    const cleared = mockQuery.mock.calls.find((c) => /notion_id=NULL/.test(String(c[0]).replace(/\s+/g, '')) || /notion_id\s*=\s*NULL/.test(c[0]));
    expect(cleared).toBeUndefined();
  });
});

describe('PUSH_TASKS_QUERY 指纹与依赖取数', () => {
  it('带 pushed_project / pushed_blockers 指纹，blocker 必须是本系统已投影（pushed_status）且只取 hard 边', async () => {
    const { PUSH_TASKS_QUERY } = await import('../notion-push-sync.js');
    expect(PUSH_TASKS_QUERY).toMatch(/pushed_project/);
    expect(PUSH_TASKS_QUERY).toMatch(/pushed_blockers/);
    expect(PUSH_TASKS_QUERY).toMatch(/task_dependencies/);
    expect(PUSH_TASKS_QUERY).toMatch(/edge_type\s*=\s*'hard'/);
    expect(PUSH_TASKS_QUERY).toMatch(/pushed_status/);
    expect(PUSH_TASKS_QUERY).toMatch(/blocker_notion_ids/);
  });
});

describe('缺列即补 + flag-off', () => {
  it('ensureTasksProjection：库已有 Blocked by → 不发 PATCH；缺 → PATCH 补列', async () => {
    const mod = await import('../notion-push-sync.js');
    mod.resetTasksProjectionStateForTest();
    mockNotionReq.mockResolvedValueOnce({ properties: { 'Blocked by': { type: 'relation' } } });
    expect(await mod.ensureTasksProjection({ query: mockQuery }, 'tok')).toBe(true);
    expect(mockNotionReq.mock.calls.some((c) => c[2] === 'PATCH')).toBe(false);

    mod.resetTasksProjectionStateForTest();
    mockNotionReq.mockReset();
    mockNotionReq.mockResolvedValueOnce({ properties: {} }).mockResolvedValueOnce({});
    expect(await mod.ensureTasksProjection({ query: mockQuery }, 'tok')).toBe(true);
    const patch = mockNotionReq.mock.calls.find((c) => c[2] === 'PATCH');
    expect(patch[1]).toBe(`/databases/${TASKS_DB}`);
    expect(Object.keys(patch[3].properties)).toEqual(['Blocked by']);
  });

  it('违规形态：补列失败 → 返回 false（flag-off 跳过投影，不抛不阻塞），TTL 内不再重试', async () => {
    const mod = await import('../notion-push-sync.js');
    mod.resetTasksProjectionStateForTest();
    mockNotionReq.mockRejectedValue(new Error('Notion 403: no access'));
    expect(await mod.ensureTasksProjection({ query: mockQuery }, 'tok')).toBe(false);
    const calls = mockNotionReq.mock.calls.length;
    expect(await mod.ensureTasksProjection({ query: mockQuery }, 'tok')).toBe(false);
    expect(mockNotionReq.mock.calls.length).toBe(calls);
    expect(mod.isTasksBlockedByActive()).toBe(false);
  });
});
