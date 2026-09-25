/**
 * 登记闸：多刀工作必须挂 project 根（链 bf5088a3 棒5·PR B，任务 3fad28e0）。
 * 「有表不填」的根因是没有闸：同一次工作登记 ≥2 个有依赖关系的任务，却没人强制挂 task_type='project' 根，
 * 于是 Notion 看板看不见项目与依赖。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  findProjectRoot, assertProjectRootForMultiTask, isMultiTaskRegistration, ProjectRootGateError,
} from '../project-root-gate.js';

const ROOT = '11111111-1111-4111-8111-111111111111';
const PARENT = '22222222-2222-4222-8222-222222222222';
const DEP = '33333333-3333-4333-8333-333333333333';

function makeDb({ root = null, siblings = false } = {}) {
  return {
    query: vi.fn(async (sql) => {
      if (/WITH RECURSIVE up/.test(sql)) return { rows: root ? [{ id: root }] : [] };
      if (/FROM tasks WHERE parent_task_id/.test(sql)) return { rows: siblings ? [{ one: 1 }] : [] };
      return { rows: [] };
    }),
  };
}

describe('isMultiTaskRegistration', () => {
  it('depends_on 非空 或 payload.multi_task===true → 多刀；否则不是', () => {
    expect(isMultiTaskRegistration({ dependsOn: [DEP], payload: {} })).toBe(true);
    expect(isMultiTaskRegistration({ dependsOn: null, payload: { multi_task: true } })).toBe(true);
    expect(isMultiTaskRegistration({ dependsOn: [], payload: {} })).toBe(false);
    expect(isMultiTaskRegistration({ dependsOn: null, payload: {} })).toBe(false);
    expect(isMultiTaskRegistration({ dependsOn: null, payload: { multi_task: 'true' } })).toBe(false);
  });
});

describe('findProjectRoot', () => {
  it('沿 parent_task_id 祖先链（含自身）找 task_type=project；找不到返回 null', async () => {
    expect(await findProjectRoot(makeDb({ root: ROOT }), PARENT)).toEqual({ id: ROOT });
    expect(await findProjectRoot(makeDb(), PARENT)).toBeNull();
  });
  it('非 uuid / 空 → null，不查库', async () => {
    const db = makeDb({ root: ROOT });
    expect(await findProjectRoot(db, 'nope')).toBeNull();
    expect(await findProjectRoot(db, null)).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('assertProjectRootForMultiTask', () => {
  it('单刀（无依赖、无 multi_task 声明）→ 直通，不查库（行为不变）', async () => {
    const db = makeDb();
    await expect(assertProjectRootForMultiTask(db, { taskType: 'dev', parentTaskId: null, dependsOn: null, payload: {} })).resolves.toBeUndefined();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('违规输入被拒：有依赖却没有 parent → project_root_required', async () => {
    const err = await assertProjectRootForMultiTask(makeDb(), { taskType: 'dev', parentTaskId: null, dependsOn: [DEP], payload: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ProjectRootGateError);
    expect(err.code).toBe('project_root_required');
    expect(err.hint).toMatch(/project/);
  });

  it('违规输入被拒：有依赖，parent 祖先链上没有 project 根 → project_root_required', async () => {
    const err = await assertProjectRootForMultiTask(makeDb(), { taskType: 'dev', parentTaskId: PARENT, dependsOn: [DEP], payload: {} }).catch((e) => e);
    expect(err.code).toBe('project_root_required');
  });

  it('违规输入被拒：声明 multi_task 却没根 → project_root_required', async () => {
    const err = await assertProjectRootForMultiTask(makeDb(), { taskType: 'dev', parentTaskId: null, dependsOn: null, payload: { multi_task: true } }).catch((e) => e);
    expect(err.code).toBe('project_root_required');
  });

  it('有 project 根 + 依赖 → 通过', async () => {
    await expect(assertProjectRootForMultiTask(makeDb({ root: ROOT }), { taskType: 'dev', parentTaskId: PARENT, dependsOn: [DEP], payload: {} })).resolves.toBeUndefined();
  });

  it('违规输入被拒：multi_task + 父下已有兄弟 + 没写 depends_on 键 → depends_on_required', async () => {
    const err = await assertProjectRootForMultiTask(makeDb({ root: ROOT, siblings: true }), {
      taskType: 'dev', parentTaskId: PARENT, dependsOn: null, payload: { multi_task: true },
    }).catch((e) => e);
    expect(err.code).toBe('depends_on_required');
  });

  it('multi_task + 显式 depends_on:[]（刻意无依赖）/ 父下没有兄弟（第一刀）→ 通过', async () => {
    await expect(assertProjectRootForMultiTask(makeDb({ root: ROOT, siblings: true }), {
      taskType: 'dev', parentTaskId: PARENT, dependsOn: [], payload: { multi_task: true },
    })).resolves.toBeUndefined();
    await expect(assertProjectRootForMultiTask(makeDb({ root: ROOT, siblings: false }), {
      taskType: 'dev', parentTaskId: PARENT, dependsOn: null, payload: { multi_task: true },
    })).resolves.toBeUndefined();
  });

  it('project 根自身豁免（根没有根）', async () => {
    const db = makeDb();
    await expect(assertProjectRootForMultiTask(db, { taskType: 'project', parentTaskId: null, dependsOn: [DEP], payload: { multi_task: true } })).resolves.toBeUndefined();
    expect(db.query).not.toHaveBeenCalled();
  });
});
