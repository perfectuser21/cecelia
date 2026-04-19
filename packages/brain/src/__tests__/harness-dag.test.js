/**
 * harness-dag.test.js — Harness v2 DAG 调度器单元测试
 *
 * 覆盖：
 *   - parseTaskPlan: schema 校验正负例
 *   - detectCycle: 直接/间接/无环
 *   - topologicalOrder: 线性/分支/汇合
 *
 * 纯函数测试，不碰 DB。DB 场景见 integration test。
 */

import { describe, it, expect } from 'vitest';
import {
  parseTaskPlan,
  detectCycle,
  topologicalOrder,
} from '../harness-dag.js';

// ─── fixture 构造器 ────────────────────────────────────────────────────────

function makeValidTask(id, depends_on = []) {
  return {
    task_id: id,
    title: `Task ${id}`,
    scope: `scope of ${id}`,
    dod: [`[BEHAVIOR] ${id} works`],
    files: [`packages/brain/src/${id}.js`],
    depends_on,
    complexity: 'S',
    estimated_minutes: 30,
  };
}

function makeValidPlan(tasks) {
  return {
    initiative_id: 'test-initiative-1',
    tasks,
  };
}

// ─── parseTaskPlan ──────────────────────────────────────────────────────────

describe('parseTaskPlan', () => {
  it('接受合法线性 DAG', () => {
    const plan = makeValidPlan([
      makeValidTask('ws1', []),
      makeValidTask('ws2', ['ws1']),
      makeValidTask('ws3', ['ws2']),
    ]);
    const out = parseTaskPlan(JSON.stringify(plan));
    expect(out.tasks).toHaveLength(3);
    expect(out.initiative_id).toBe('test-initiative-1');
  });

  it('接受 Markdown code fence 包裹的 JSON', () => {
    const plan = makeValidPlan([makeValidTask('ws1')]);
    const wrapped = '```json\n' + JSON.stringify(plan, null, 2) + '\n```';
    const out = parseTaskPlan(wrapped);
    expect(out.tasks[0].task_id).toBe('ws1');
  });

  it('接受大段文本中嵌入的 JSON', () => {
    const plan = makeValidPlan([makeValidTask('ws1')]);
    const mixed = `some prose text\n\n${JSON.stringify(plan)}\n\ntrailing text`;
    const out = parseTaskPlan(mixed);
    expect(out.tasks[0].task_id).toBe('ws1');
  });

  it('拒空 tasks', () => {
    expect(() => parseTaskPlan(JSON.stringify({ initiative_id: 'x', tasks: [] })))
      .toThrow(/tasks must be non-empty/);
  });

  it('拒少字段（无 dod）', () => {
    const t = makeValidTask('ws1');
    delete t.dod;
    expect(() => parseTaskPlan(JSON.stringify(makeValidPlan([t]))))
      .toThrow(/dod/);
  });

  it('拒无效 complexity', () => {
    const t = makeValidTask('ws1');
    t.complexity = 'XL';
    expect(() => parseTaskPlan(JSON.stringify(makeValidPlan([t]))))
      .toThrow(/complexity/);
  });

  it('拒 estimated_minutes 越界', () => {
    const t = makeValidTask('ws1');
    t.estimated_minutes = 10;
    expect(() => parseTaskPlan(JSON.stringify(makeValidPlan([t]))))
      .toThrow(/estimated_minutes/);

    const t2 = makeValidTask('ws1');
    t2.estimated_minutes = 120;
    expect(() => parseTaskPlan(JSON.stringify(makeValidPlan([t2]))))
      .toThrow(/estimated_minutes/);
  });

  it('拒自环', () => {
    const t = makeValidTask('ws1', ['ws1']);
    expect(() => parseTaskPlan(JSON.stringify(makeValidPlan([t]))))
      .toThrow(/self/);
  });

  it('拒引用不存在的 task_id', () => {
    const t = makeValidTask('ws1', ['ws99']);
    expect(() => parseTaskPlan(JSON.stringify(makeValidPlan([t]))))
      .toThrow(/unknown/);
  });

  it('拒重复 task_id', () => {
    const plan = makeValidPlan([
      makeValidTask('ws1'),
      makeValidTask('ws1'),
    ]);
    expect(() => parseTaskPlan(JSON.stringify(plan)))
      .toThrow(/duplicate/);
  });

  it('拒环依赖', () => {
    const plan = makeValidPlan([
      makeValidTask('ws1', ['ws2']),
      makeValidTask('ws2', ['ws1']),
    ]);
    expect(() => parseTaskPlan(JSON.stringify(plan)))
      .toThrow(/cycle/);
  });

  it('拒 >8 tasks 硬上限', () => {
    const tasks = Array.from({ length: 9 }, (_, i) => makeValidTask(`ws${i + 1}`));
    const plan = { initiative_id: 'x', tasks, justification: 'many' };
    expect(() => parseTaskPlan(JSON.stringify(plan)))
      .toThrow(/> 8/);
  });

  it('拒 >5 tasks 但无 justification', () => {
    const tasks = Array.from({ length: 6 }, (_, i) => makeValidTask(`ws${i + 1}`));
    const plan = { initiative_id: 'x', tasks };
    expect(() => parseTaskPlan(JSON.stringify(plan)))
      .toThrow(/justification/);
  });

  it('接受 6 tasks 且有 justification', () => {
    const tasks = Array.from({ length: 6 }, (_, i) => makeValidTask(`ws${i + 1}`));
    const plan = { initiative_id: 'x', tasks, justification: '这个 initiative 范围宽，合理拆 6' };
    const out = parseTaskPlan(JSON.stringify(plan));
    expect(out.tasks).toHaveLength(6);
  });

  it('拒非字符串 jsonString', () => {
    expect(() => parseTaskPlan(null)).toThrow(/string/);
    expect(() => parseTaskPlan(123)).toThrow(/string/);
  });

  it('拒无效 JSON', () => {
    expect(() => parseTaskPlan('not json at all')).toThrow(/JSON/);
    expect(() => parseTaskPlan('{bad: json}')).toThrow(/JSON/);
  });
});

// ─── detectCycle ────────────────────────────────────────────────────────────

describe('detectCycle', () => {
  it('空数组无环', () => {
    expect(detectCycle([])).toBe(false);
  });

  it('线性无环', () => {
    expect(detectCycle([
      { task_id: 'a', depends_on: [] },
      { task_id: 'b', depends_on: ['a'] },
      { task_id: 'c', depends_on: ['b'] },
    ])).toBe(false);
  });

  it('检测直接环 A→B→A', () => {
    expect(detectCycle([
      { task_id: 'a', depends_on: ['b'] },
      { task_id: 'b', depends_on: ['a'] },
    ])).toBe(true);
  });

  it('检测间接环 A→B→C→A', () => {
    expect(detectCycle([
      { task_id: 'a', depends_on: ['c'] },
      { task_id: 'b', depends_on: ['a'] },
      { task_id: 'c', depends_on: ['b'] },
    ])).toBe(true);
  });

  it('菱形无环（a→b,c→d 两条独立路径）', () => {
    expect(detectCycle([
      { task_id: 'a', depends_on: [] },
      { task_id: 'b', depends_on: ['a'] },
      { task_id: 'c', depends_on: ['a'] },
      { task_id: 'd', depends_on: ['b', 'c'] },
    ])).toBe(false);
  });

  it('忽略未知依赖（容错）', () => {
    expect(detectCycle([
      { task_id: 'a', depends_on: ['ghost'] },
    ])).toBe(false);
  });
});

// ─── topologicalOrder ──────────────────────────────────────────────────────

describe('topologicalOrder', () => {
  it('空数组返回空', () => {
    expect(topologicalOrder([])).toEqual([]);
  });

  it('线性 DAG a→b→c 顺序执行 a,b,c', () => {
    const order = topologicalOrder([
      { task_id: 'c', depends_on: ['b'] },
      { task_id: 'b', depends_on: ['a'] },
      { task_id: 'a', depends_on: [] },
    ]);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('分支：a 后 b 和 c 可并行，d 依赖两者', () => {
    const order = topologicalOrder([
      { task_id: 'a', depends_on: [] },
      { task_id: 'b', depends_on: ['a'] },
      { task_id: 'c', depends_on: ['a'] },
      { task_id: 'd', depends_on: ['b', 'c'] },
    ]);
    // a 第一，d 最后；中间 b/c 顺序由实现决定
    expect(order[0]).toBe('a');
    expect(order[3]).toBe('d');
    expect(new Set(order.slice(1, 3))).toEqual(new Set(['b', 'c']));
  });

  it('完全独立的多个节点保留原顺序', () => {
    const order = topologicalOrder([
      { task_id: 'a', depends_on: [] },
      { task_id: 'b', depends_on: [] },
      { task_id: 'c', depends_on: [] },
    ]);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('环抛错', () => {
    expect(() => topologicalOrder([
      { task_id: 'a', depends_on: ['b'] },
      { task_id: 'b', depends_on: ['a'] },
    ])).toThrow(/cycle/);
  });
});
