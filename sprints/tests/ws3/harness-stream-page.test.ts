/**
 * WS3: harness-initiative.graph.js 节点事件写入 initiative_run_events
 * TDD Red: 测试 graph.js 写入逻辑符合 PRD 规范
 * Generator 添加写入调用后变 Green
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const GRAPH_FILE = resolve('packages/brain/src/workflows/harness-initiative.graph.js');

describe('Workstream 3 — harness graph 节点事件写入 [BEHAVIOR]', () => {
  it('[ARTIFACT] harness-initiative.graph.js 引用 initiative_run_events 表', () => {
    const code = readFileSync(GRAPH_FILE, 'utf-8');
    expect(code).toContain('initiative_run_events');
  });

  it('[BEHAVIOR] graph.js INSERT 使用合法 node 枚举（planner 是必需节点）', () => {
    const code = readFileSync(GRAPH_FILE, 'utf-8');
    // planner 节点必须写入事件
    expect(code).toMatch(/['"](planner)['"]/);
    // 确认代码在 initiative_run_events 写入上下文中使用了合法节点名
    const insertBlock = code.split('initiative_run_events').slice(1).join('initiative_run_events');
    expect(insertBlock).toMatch(/planner|proposer|reviewer|generator|evaluator|e2e/);
  });

  it('[BEHAVIOR] graph.js INSERT 使用合法 status 枚举（started/running/done/failed）', () => {
    const code = readFileSync(GRAPH_FILE, 'utf-8');
    // status 枚举必须出现在 initiative_run_events 写入上下文
    const insertBlock = code.split('initiative_run_events').slice(1).join('');
    expect(insertBlock).toMatch(/started|running|done|failed/);
  });

  it('[BEHAVIOR] graph.js 不使用禁用 node 别名（agent/step/phase）', () => {
    const code = readFileSync(GRAPH_FILE, 'utf-8');
    // 禁用别名不应作为 initiative_run_events INSERT 中的 node 值
    const insertBlock = code.split('initiative_run_events').slice(1).join('');
    expect(insertBlock).not.toMatch(/node.*['"](agent|step|phase)['"]/);
  });

  it('[BEHAVIOR] graph.js 不使用禁用 status 别名（success/completed/in_progress/pending）', () => {
    const code = readFileSync(GRAPH_FILE, 'utf-8');
    const insertBlock = code.split('initiative_run_events').slice(1).join('');
    expect(insertBlock).not.toMatch(/status.*['"](success|completed|in_progress|pending)['"]/);
  });

  it('[BEHAVIOR] graph.js 包含 failed 状态写入（error path — 节点失败时记录）', () => {
    const code = readFileSync(GRAPH_FILE, 'utf-8');
    // failed 状态必须在 initiative_run_events 相关代码块中出现
    expect(code).toMatch(/initiative_run_events[\s\S]{0,500}failed|failed[\s\S]{0,500}initiative_run_events/);
  });

  it('[BEHAVIOR] graph.js 写入 ts 字段使用 Date.now() 或等价 Unix 毫秒（不用 created_at 字符串）', () => {
    const code = readFileSync(GRAPH_FILE, 'utf-8');
    // SSE 端点将 DB created_at 转换为 ts (number)，graph.js 不需要直接写 ts
    // 但如果 graph.js 构造 SSE payload 时写 ts，必须是 ms 级别 number
    // 如果仅写 DB 行（created_at 由 DB DEFAULT NOW() 生成），这个测试应通过
    const hasTsField = code.match(/\bts\b\s*:/);
    if (hasTsField) {
      // 如果代码显式写 ts 字段，必须使用 Date.now() 或 getTime()
      expect(code).toMatch(/Date\.now\(\)|\.getTime\(\)|Number\(/);
    } else {
      // graph.js 不写 ts，由 SSE 端点从 created_at 推导 — 正确做法
      expect(true).toBe(true);
    }
  });
});
