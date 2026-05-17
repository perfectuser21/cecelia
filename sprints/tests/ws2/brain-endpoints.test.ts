/**
 * WS2 TDD Red Phase — Brain SSE + REST endpoints
 * /api/brain/harness/pipeline/:initiative_id/stream 和 /events 尚未实现
 * Generator 添加路由后变 Green
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '../../../');
const HARNESS_ROUTES = join(REPO_ROOT, 'packages/brain/src/routes/harness.js');

describe('WS2 — Brain harness routes — static structure [BEHAVIOR]', () => {
  it('harness.js 包含 /pipeline/:initiative_id/stream 路由', () => {
    const content = readFileSync(HARNESS_ROUTES, 'utf-8');
    const hasRoute = content.includes('/pipeline/:initiative_id/stream')
      || content.includes("pipeline/:initiative_id/stream");
    expect(hasRoute, '路由 /pipeline/:initiative_id/stream 不存在').toBe(true);
  });

  it('harness.js 包含 /pipeline/:initiative_id/events 路由', () => {
    const content = readFileSync(HARNESS_ROUTES, 'utf-8');
    const hasRoute = content.includes('/pipeline/:initiative_id/events')
      || content.includes("pipeline/:initiative_id/events");
    expect(hasRoute, '路由 /pipeline/:initiative_id/events 不存在').toBe(true);
  });

  it('SSE 路由设置 Content-Type: text/event-stream', () => {
    const content = readFileSync(HARNESS_ROUTES, 'utf-8');
    expect(content).toContain('text/event-stream');
  });

  it('SSE 路由包含 keepalive 机制（30s 心跳）', () => {
    const content = readFileSync(HARNESS_ROUTES, 'utf-8');
    expect(content).toContain('keepalive');
  });

  it('SSE 路由查询参数使用 after_event_id（禁用 planner_task_id/taskId/since）', () => {
    const content = readFileSync(HARNESS_ROUTES, 'utf-8');
    expect(content).not.toContain('planner_task_id');
    expect(content).not.toContain("'taskId'");
    expect(content).not.toContain('"taskId"');
    const hasAfterEventId = content.includes('after_event_id');
    expect(hasAfterEventId, 'after_event_id 断点续接参数不存在').toBe(true);
  });

  it('路由查询 initiative_run_events 表（不是 task_events）', () => {
    const content = readFileSync(HARNESS_ROUTES, 'utf-8');
    expect(content).toContain('initiative_run_events');
    // 新路由不应使用旧的 task_events（SSE 端点专用 initiative_run_events）
  });

  it('done 事件 data 使用 status 和 verdict 字段（禁用 result/outcome）', () => {
    const content = readFileSync(HARNESS_ROUTES, 'utf-8');
    // done 事件应包含 status 和 verdict
    const hasDoneFields = content.includes('verdict') && content.includes('"done"');
    expect(hasDoneFields, 'done 事件缺少 status/verdict 字段').toBe(true);
  });

  it('node_update data 使用 ts 字段（禁用 timestamp/time）', () => {
    const content = readFileSync(HARNESS_ROUTES, 'utf-8');
    // 字段名应为 ts，不应为 timestamp
    const usesTs = content.includes('"ts"') || content.includes("'ts'") || content.includes('ts:');
    expect(usesTs, 'node_update 应使用 ts 字段而非 timestamp').toBe(true);
  });
});
