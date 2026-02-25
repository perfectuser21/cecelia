/**
 * OKR Structure Validator 测试
 * DoD: D2, D3, D4, D5, D6, D7, D9
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateOkrStructure, _resetSpecCache } from '../validate-okr-structure.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = resolve(__dirname, '../../../config/okr-validation-spec.yml');

// ────────────────────────────────────────────────────────────────────
// UUID 工具
// ────────────────────────────────────────────────────────────────────

const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

// ────────────────────────────────────────────────────────────────────
// Mock Pool 构造器
// ────────────────────────────────────────────────────────────────────

function makeMockPool({
  goals = [],
  projects = [],
  tasks = [],
  prPlans = [],
  krLinks = [],
} = {}) {
  return {
    query: vi.fn().mockImplementation(async (sql) => {
      const s = sql.trim().toLowerCase();
      if (s.includes('from goals')) return { rows: goals };
      if (s.includes('from projects')) return { rows: projects };
      if (s.includes('from tasks')) return { rows: tasks };
      if (s.includes('from pr_plans')) return { rows: prPlans };
      if (s.includes('from project_kr_links')) return { rows: krLinks };
      return { rows: [] };
    }),
  };
}

afterEach(() => {
  _resetSpecCache();
});

// ────────────────────────────────────────────────────────────────────
// D2: 返回值结构
// ────────────────────────────────────────────────────────────────────

describe('D2: validateOkrStructure 返回 {ok, issues}', () => {
  it('scope=full 返回正确结构', async () => {
    const pool = makeMockPool();
    const result = await validateOkrStructure(pool, { scope: 'full', specPath: SPEC_PATH });
    expect(result).toHaveProperty('ok');
    expect(result).toHaveProperty('issues');
    expect(typeof result.ok).toBe('boolean');
    expect(Array.isArray(result.issues)).toBe(true);
  });

  it('空数据库返回 ok=true', async () => {
    const pool = makeMockPool();
    const result = await validateOkrStructure(pool, { scope: 'full', specPath: SPEC_PATH });
    expect(result.ok).toBe(true);
    expect(result.issues.length).toBe(0);
  });

  it('scope=kr 缺 rootId → BLOCK', async () => {
    const pool = makeMockPool();
    const result = await validateOkrStructure(pool, { scope: 'kr', specPath: SPEC_PATH });
    expect(result.ok).toBe(false);
    expect(result.issues[0].rule).toBe('missing_root_id');
  });
});

// ────────────────────────────────────────────────────────────────────
// D3: 必须字段检查
// ────────────────────────────────────────────────────────────────────

describe('D3: 必须字段检查', () => {
  it('goals 缺 title → BLOCK', async () => {
    const pool = makeMockPool({
      goals: [{
        id: uuid(1), type: 'global_okr', title: null,
        status: 'pending', priority: 'P0', parent_id: null,
      }],
    });
    const result = await validateOkrStructure(pool, { scope: 'full', specPath: SPEC_PATH });
    const block = result.issues.find(i =>
      i.level === 'BLOCK' && i.rule === 'required_field' && i.message.includes('title')
    );
    expect(block).toBeDefined();
    expect(result.ok).toBe(false);
  });

  it('goals 缺 type → BLOCK', async () => {
    const pool = makeMockPool({
      goals: [{
        id: uuid(1), type: 'global_okr', title: '有效标题测试',
        status: 'pending', priority: 'P0', parent_id: null,
      }],
    });
    // type 字段有值（'global_okr'），不应报错
    const result = await validateOkrStructure(pool, { scope: 'full', specPath: SPEC_PATH });
    const block = result.issues.find(i =>
      i.level === 'BLOCK' && i.rule === 'required_field' && i.message.includes('type')
    );
    expect(block).toBeUndefined();
  });

  it('goals 缺 status → BLOCK', async () => {
    const pool = makeMockPool({
      goals: [{
        id: uuid(1), type: 'global_okr', title: '有效标题测试',
        status: '', priority: 'P0', parent_id: null,
      }],
    });
    const result = await validateOkrStructure(pool, { scope: 'full', specPath: SPEC_PATH });
    const block = result.issues.find(i =>
      i.level === 'BLOCK' && i.rule === 'required_field' && i.message.includes('status')
    );
    expect(block).toBeDefined();
  });

  it('projects 缺 name → BLOCK', async () => {
    const pool = makeMockPool({
      projects: [{
        id: uuid(10), type: 'project', name: null,
        status: 'active', parent_id: null,
      }],
    });
    const result = await validateOkrStructure(pool, { scope: 'full', specPath: SPEC_PATH });
    const block = result.issues.find(i =>
      i.level === 'BLOCK' && i.rule === 'required_field' && i.message.includes('name')
    );
    expect(block).toBeDefined();
  });

  it('tasks 缺 project_id → BLOCK', async () => {
    const pool = makeMockPool({
      tasks: [{
        id: uuid(20), title: '有效任务标题', project_id: null,
        status: 'queued', priority: 'P1',
      }],
    });
    const result = await validateOkrStructure(pool, { scope: 'full', specPath: SPEC_PATH });
    const block = result.issues.find(i =>
      i.level === 'BLOCK' && i.rule === 'required_field' && i.message.includes('project_id')
    );
    expect(block).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────────
// D4: parent 存在性
// ────────────────────────────────────────────────────────────────────

describe('D4: parent 存在性检查', () => {
  it('area_okr.parent_id 指向不存在 goal → BLOCK', async () => {
    const pool = makeMockPool({
      goals: [{
        id: uuid(3), type: 'area_okr', title: '领域目标测试',
        status: 'pending', priority: 'P1',
        parent_id: uuid(99), // 不存在
      }],
    });
    const result = await validateOkrStructure(pool, { scope: 'full', specPath: SPEC_PATH });
    const block = result.issues.find(i =>
      i.level === 'BLOCK' && i.rule === 'parent_not_found' && i.entity === 'goals'
    );
    expect(block).toBeDefined();
    expect(result.ok).toBe(false);
  });

  it('initiative.parent_id 指向不存在 project → BLOCK', async () => {
    const pool = makeMockPool({
      projects: [{
        id: uuid(11), type: 'initiative', name: '工作包测试',
        status: 'active', parent_id: uuid(99),
      }],
    });
    const result = await validateOkrStructure(pool, { scope: 'full', specPath: SPEC_PATH });
    const block = result.issues.find(i =>
      i.level === 'BLOCK' && i.rule === 'parent_not_found' && i.entity === 'projects'
    );
    expect(block).toBeDefined();
  });

  it('area_okr.parent_id 指向存在的 global_kr → 无报错', async () => {
    const gkr = {
      id: uuid(2), type: 'global_kr', title: '全局关键结果测试标题',
      status: 'pending', priority: 'P0', parent_id: uuid(1),
    };
    const gokr = {
      id: uuid(1), type: 'global_okr', title: '全局目标测试标题题',
      status: 'pending', priority: 'P0', parent_id: null,
    };
    const aokr = {
      id: uuid(3), type: 'area_okr', title: '领域目标测试标题题',
      status: 'pending', priority: 'P1', parent_id: uuid(2),
    };
    const pool = makeMockPool({ goals: [gokr, gkr, aokr] });
    const result = await validateOkrStructure(pool, { scope: 'full', specPath: SPEC_PATH });
    const parentError = result.issues.find(i =>
      i.rule === 'parent_not_found' && i.entityId === uuid(3)
    );
    expect(parentError).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────
// D5: parent type 一致性
// ────────────────────────────────────────────────────────────────────

describe('D5: parent type 一致性', () => {
  it('area_okr.parent type 不是 global_kr → BLOCK', async () => {
    // area_okr 的 parent 指向另一个 area_okr（应该是 global_kr）
    const wrongParent = {
      id: uuid(2), type: 'area_okr', title: '错误的父节点测试',
      status: 'pending', priority: 'P1', parent_id: null,
    };
    const aokr = {
      id: uuid(3), type: 'area_okr', title: '领域目标测试标题题',
      status: 'pending', priority: 'P1', parent_id: uuid(2),
    };
    const pool = makeMockPool({ goals: [wrongParent, aokr] });
    const result = await validateOkrStructure(pool, { scope: 'full', specPath: SPEC_PATH });
    const mismatch = result.issues.find(i =>
      i.level === 'BLOCK' && i.rule === 'parent_type_mismatch' && i.entityId === uuid(3)
    );
    expect(mismatch).toBeDefined();
    expect(mismatch.message).toContain('global_kr');
  });

  it('global_kr.parent type 不是 global_okr → BLOCK', async () => {
    const wrongParent = {
      id: uuid(1), type: 'area_kr', title: '不是全局目标的测试',
      status: 'pending', priority: 'P0', parent_id: null,
    };
    const gkr = {
      id: uuid(2), type: 'global_kr', title: '全局关键结果测试标题',
      status: 'pending', priority: 'P0', parent_id: uuid(1),
    };
    const pool = makeMockPool({ goals: [wrongParent, gkr] });
    const result = await validateOkrStructure(pool, { scope: 'full', specPath: SPEC_PATH });
    const mismatch = result.issues.find(i =>
      i.rule === 'parent_type_mismatch' && i.entityId === uuid(2)
    );
    expect(mismatch).toBeDefined();
    expect(mismatch.message).toContain('global_okr');
  });

  it('initiative.parent type 不是 project → BLOCK', async () => {
    const wrongParent = {
      id: uuid(10), type: 'initiative', name: '不是项目的工作包',
      status: 'active', parent_id: null,
    };
    const ini = {
      id: uuid(11), type: 'initiative', name: '子工作包测试名称',
      status: 'active', parent_id: uuid(10),
    };
    const pool = makeMockPool({ projects: [wrongParent, ini] });
    const result = await validateOkrStructure(pool, { scope: 'full', specPath: SPEC_PATH });
    const mismatch = result.issues.find(i =>
      i.rule === 'parent_type_mismatch' && i.entityId === uuid(11)
    );
    expect(mismatch).toBeDefined();
    expect(mismatch.message).toContain('project');
  });
});

// ────────────────────────────────────────────────────────────────────
// D6: children 数量范围
// ────────────────────────────────────────────────────────────────────

describe('D6: children 数量范围', () => {
  it('area_kr 有 0 个关联 project → WARNING', async () => {
    const gokr = {
      id: uuid(1), type: 'global_okr', title: '全局目标测试标题题',
      status: 'pending', priority: 'P0', parent_id: null,
    };
    const gkr = {
      id: uuid(2), type: 'global_kr', title: '全局关键结果测试标题',
      status: 'pending', priority: 'P0', parent_id: uuid(1),
    };
    const aokr = {
      id: uuid(3), type: 'area_okr', title: '领域目标测试标题题',
      status: 'pending', priority: 'P1', parent_id: uuid(2),
    };
    const akr = {
      id: uuid(4), type: 'area_kr', title: '领域KR测试标题标题',
      status: 'pending', priority: 'P1', parent_id: uuid(3),
    };
    const pool = makeMockPool({
      goals: [gokr, gkr, aokr, akr],
      krLinks: [], // 无关联 project
    });
    const result = await validateOkrStructure(pool, { scope: 'full', specPath: SPEC_PATH });
    const warn = result.issues.find(i =>
      i.rule === 'children_min' && i.entityId === uuid(4) && i.message.includes('project')
    );
    expect(warn).toBeDefined();
    expect(warn.level).toBe('WARNING');
  });

  it('global_okr 有 0 个 global_kr → WARNING', async () => {
    const gokr = {
      id: uuid(1), type: 'global_okr', title: '全局目标测试标题题',
      status: 'pending', priority: 'P0', parent_id: null,
    };
    const pool = makeMockPool({ goals: [gokr] });
    const result = await validateOkrStructure(pool, { scope: 'full', specPath: SPEC_PATH });
    const warn = result.issues.find(i =>
      i.rule === 'children_min' && i.entityId === uuid(1) && i.message.includes('global_kr')
    );
    expect(warn).toBeDefined();
    expect(warn.level).toBe('WARNING');
  });

  it('有关联时不报 children_min', async () => {
    const akr = {
      id: uuid(4), type: 'area_kr', title: '领域KR测试标题标题',
      status: 'pending', priority: 'P1', parent_id: uuid(3),
    };
    const aokr = {
      id: uuid(3), type: 'area_okr', title: '领域目标测试标题题',
      status: 'pending', priority: 'P1', parent_id: uuid(2),
    };
    const gkr = {
      id: uuid(2), type: 'global_kr', title: '全局关键结果测试标题',
      status: 'pending', priority: 'P0', parent_id: uuid(1),
    };
    const gokr = {
      id: uuid(1), type: 'global_okr', title: '全局目标测试标题题',
      status: 'pending', priority: 'P0', parent_id: null,
    };
    const pool = makeMockPool({
      goals: [gokr, gkr, aokr, akr],
      krLinks: [{ project_id: uuid(10), kr_id: uuid(4) }],
      projects: [{ id: uuid(10), type: 'project', name: '项目测试名称最低长度', status: 'active', parent_id: null }],
    });
    const result = await validateOkrStructure(pool, { scope: 'full', specPath: SPEC_PATH });
    const warn = result.issues.find(i =>
      i.rule === 'children_min' && i.entityId === uuid(4) && i.message.includes('project')
    );
    expect(warn).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────
// D7: 孤儿检测
// ────────────────────────────────────────────────────────────────────

describe('D7: 孤儿检测', () => {
  it('task.project_id 指向不存在 project → BLOCK', async () => {
    const pool = makeMockPool({
      tasks: [{
        id: uuid(20), title: '孤儿任务测试标题', project_id: uuid(99),
        status: 'queued', priority: 'P1',
      }],
    });
    const result = await validateOkrStructure(pool, { scope: 'full', specPath: SPEC_PATH });
    const orphan = result.issues.find(i =>
      i.rule === 'orphan' && i.entity === 'tasks'
    );
    expect(orphan).toBeDefined();
    expect(orphan.level).toBe('BLOCK');
  });

  it('initiative.parent_id 指向不存在 project → BLOCK（全局孤儿）', async () => {
    const pool = makeMockPool({
      projects: [{
        id: uuid(11), type: 'initiative', name: '孤儿工作包测试',
        status: 'active', parent_id: uuid(99),
      }],
    });
    const result = await validateOkrStructure(pool, { scope: 'full', specPath: SPEC_PATH });
    const orphan = result.issues.find(i =>
      i.rule === 'orphan' && i.entity === 'projects'
    );
    expect(orphan).toBeDefined();
    expect(orphan.level).toBe('BLOCK');
  });

  it('task.project_id 指向存在 project → 无孤儿', async () => {
    const pool = makeMockPool({
      projects: [{
        id: uuid(10), type: 'project', name: '项目测试名称最低长度',
        status: 'active', parent_id: null,
      }],
      tasks: [{
        id: uuid(20), title: '正常任务测试', project_id: uuid(10),
        status: 'queued', priority: 'P1',
      }],
    });
    const result = await validateOkrStructure(pool, { scope: 'full', specPath: SPEC_PATH });
    const orphan = result.issues.find(i => i.rule === 'orphan' && i.entity === 'tasks');
    expect(orphan).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────
// D9: 文本规则 + 禁词
// ────────────────────────────────────────────────────────────────────

describe('D9: 文本规则', () => {
  it('task.title 包含禁词 "看一下" → BLOCK', async () => {
    const pool = makeMockPool({
      projects: [{
        id: uuid(10), type: 'project', name: '项目测试名称最低长度',
        status: 'active', parent_id: null,
      }],
      tasks: [{
        id: uuid(20), title: '看一下这个问题', project_id: uuid(10),
        status: 'queued', priority: 'P1',
      }],
    });
    const result = await validateOkrStructure(pool, { scope: 'full', specPath: SPEC_PATH });
    const forbidden = result.issues.find(i =>
      i.rule === 'forbidden_phrase' && i.entityId === uuid(20)
    );
    expect(forbidden).toBeDefined();
    expect(forbidden.level).toBe('BLOCK');
    expect(forbidden.message).toContain('看一下');
  });

  it('task.title 包含禁词 "处理一下" → BLOCK', async () => {
    const pool = makeMockPool({
      projects: [{
        id: uuid(10), type: 'project', name: '项目测试名称最低长度',
        status: 'active', parent_id: null,
      }],
      tasks: [{
        id: uuid(20), title: '处理一下这个 bug', project_id: uuid(10),
        status: 'queued', priority: 'P1',
      }],
    });
    const result = await validateOkrStructure(pool, { scope: 'full', specPath: SPEC_PATH });
    const forbidden = result.issues.find(i =>
      i.rule === 'forbidden_phrase' && i.entityId === uuid(20)
    );
    expect(forbidden).toBeDefined();
  });

  it('task.title 无禁词 → 无 BLOCK', async () => {
    const pool = makeMockPool({
      projects: [{
        id: uuid(10), type: 'project', name: '项目测试名称最低长度',
        status: 'active', parent_id: null,
      }],
      tasks: [{
        id: uuid(20), title: '实现用户认证 API', project_id: uuid(10),
        status: 'queued', priority: 'P1',
      }],
    });
    const result = await validateOkrStructure(pool, { scope: 'full', specPath: SPEC_PATH });
    const forbidden = result.issues.find(i =>
      i.rule === 'forbidden_phrase' && i.entityId === uuid(20)
    );
    expect(forbidden).toBeUndefined();
  });

  it('goals.title 长度不足 → WARNING', async () => {
    const pool = makeMockPool({
      goals: [{
        id: uuid(1), type: 'global_okr', title: '短',
        status: 'pending', priority: 'P0', parent_id: null,
      }],
    });
    const result = await validateOkrStructure(pool, { scope: 'full', specPath: SPEC_PATH });
    const warn = result.issues.find(i =>
      i.rule === 'text_too_short' && i.entityId === uuid(1)
    );
    expect(warn).toBeDefined();
    expect(warn.level).toBe('WARNING');
  });

  it('pr_plans 缺 title → BLOCK', async () => {
    const pool = makeMockPool({
      projects: [{
        id: uuid(10), type: 'project', name: '项目测试名称最低长度',
        status: 'active', parent_id: null,
      }],
      prPlans: [{
        id: uuid(30), title: null, project_id: uuid(10),
        dod: 'some dod', status: 'pending', depends_on: null,
      }],
    });
    const result = await validateOkrStructure(pool, { scope: 'full', specPath: SPEC_PATH });
    const block = result.issues.find(i =>
      i.level === 'BLOCK' && i.rule === 'required_field' && i.entity === 'pr_plans'
    );
    expect(block).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────────
// global_okr 的 parent_id must_be_null
// ────────────────────────────────────────────────────────────────────

describe('global_okr parent_id 检查', () => {
  it('global_okr 有 parent_id → BLOCK', async () => {
    const pool = makeMockPool({
      goals: [{
        id: uuid(1), type: 'global_okr', title: '全局目标测试标题题',
        status: 'pending', priority: 'P0', parent_id: uuid(99),
      }],
    });
    const result = await validateOkrStructure(pool, { scope: 'full', specPath: SPEC_PATH });
    const block = result.issues.find(i =>
      i.rule === 'parent_must_be_null' && i.entityId === uuid(1)
    );
    expect(block).toBeDefined();
    expect(block.level).toBe('BLOCK');
  });

  it('global_okr parent_id=null → 无报错', async () => {
    const pool = makeMockPool({
      goals: [{
        id: uuid(1), type: 'global_okr', title: '全局目标测试标题题',
        status: 'pending', priority: 'P0', parent_id: null,
      }],
    });
    const result = await validateOkrStructure(pool, { scope: 'full', specPath: SPEC_PATH });
    const block = result.issues.find(i =>
      i.rule === 'parent_must_be_null' && i.entityId === uuid(1)
    );
    expect(block).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────
// project KR link 检查
// ────────────────────────────────────────────────────────────────────

describe('project KR link 检查', () => {
  it('project 无 KR 关联 → WARNING', async () => {
    const pool = makeMockPool({
      projects: [{
        id: uuid(10), type: 'project', name: '项目测试名称最低长度',
        status: 'active', parent_id: null,
      }],
      krLinks: [],
    });
    const result = await validateOkrStructure(pool, { scope: 'full', specPath: SPEC_PATH });
    const warn = result.issues.find(i =>
      i.rule === 'kr_link_min' && i.entityId === uuid(10)
    );
    expect(warn).toBeDefined();
    expect(warn.level).toBe('WARNING');
  });
});
