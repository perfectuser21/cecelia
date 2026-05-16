/**
 * WS2: Dashboard HarnessPipelineDetailPage — EventSource 实时日志区
 * TDD Red: 测试组件新增 EventSource hook 和实时日志区
 * Generator 修改 HarnessPipelineDetailPage.tsx 后变 Green
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const DETAIL_PAGE = resolve(
  'apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx'
);

describe('Workstream 2 — Dashboard 实时日志区 [BEHAVIOR]', () => {
  it('[ARTIFACT] 组件含 new EventSource( 构造', () => {
    const src = readFileSync(DETAIL_PAGE, 'utf-8');
    expect(src).toContain('new EventSource(');
  });

  it('[BEHAVIOR] EventSource URL 使用 planner_task_id query param', () => {
    const src = readFileSync(DETAIL_PAGE, 'utf-8');
    expect(src).toContain('planner_task_id');
  });

  it('[BEHAVIOR] EventSource URL 不使用禁用 query param 名 (task_id/taskId/pipeline_id/tid)', () => {
    const src = readFileSync(DETAIL_PAGE, 'utf-8');
    // 禁用参数名不应出现在 EventSource URL 构造中
    expect(src).not.toMatch(/EventSource\s*\([^)]*[?&](taskId|pipeline_id|tid)=/);
  });

  it('[BEHAVIOR] 组件读取 SSE data.node 字段（非禁用字段 nodeName）', () => {
    const src = readFileSync(DETAIL_PAGE, 'utf-8');
    // 使用合规字段名
    expect(src).toMatch(/\.node\b|data\.node|event\.node/);
    // 不使用禁用字段名
    expect(src).not.toMatch(/\.nodeName\b|data\.nodeName/);
  });

  it('[BEHAVIOR] 组件读取 SSE data.label 字段（非禁用字段 name）', () => {
    const src = readFileSync(DETAIL_PAGE, 'utf-8');
    expect(src).toMatch(/\.label\b|data\.label/);
    expect(src).not.toMatch(/\.name\b.*SSE|data\.name\b/);
  });

  it('[BEHAVIOR] 组件处理 done 事件并显示完成状态', () => {
    const src = readFileSync(DETAIL_PAGE, 'utf-8');
    // done 事件处理（addEventListener('done', ...) 或 type === 'done'）
    expect(src).toMatch(/addEventListener\s*\(\s*['"]done['"]|type.*done|event.*done/);
    // 完成状态文案
    expect(src).toMatch(/已完成|失败|Pipeline 已完成|Pipeline 失败/);
  });

  it('[BEHAVIOR] EventSource 在组件卸载时 close（无内存泄漏）', () => {
    const src = readFileSync(DETAIL_PAGE, 'utf-8');
    expect(src).toMatch(/\.close\(\)|es\.close|eventSource\.close|sse\.close/);
  });
});
