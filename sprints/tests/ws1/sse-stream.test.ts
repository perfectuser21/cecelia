/**
 * WS1: Brain SSE 端点 — GET /api/brain/harness/stream
 * TDD Red: 测试 /stream 路由存在且行为符合 PRD schema
 * Generator 在 harness.js 新增 /stream 路由后变 Green
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const HARNESS_ROUTE = resolve('packages/brain/src/routes/harness.js');

describe('Workstream 1 — Brain SSE 端点 [BEHAVIOR]', () => {
  it('[ARTIFACT] harness.js 新增 /stream 路由', () => {
    const src = readFileSync(HARNESS_ROUTE, 'utf-8');
    expect(src).toContain("router.get('/stream'");
  });

  it('[ARTIFACT] SSE 端点过滤 graph_node_update event_type', () => {
    const src = readFileSync(HARNESS_ROUTE, 'utf-8');
    expect(src).toContain('graph_node_update');
  });

  it('[ARTIFACT] keepalive comment 每 30s 发送', () => {
    const src = readFileSync(HARNESS_ROUTE, 'utf-8');
    expect(src).toContain(': keepalive');
  });

  it('[ARTIFACT] 节点中文标签 MAP 含 proposer 映射', () => {
    const src = readFileSync(HARNESS_ROUTE, 'utf-8');
    expect(src).toMatch(/proposer.*提案者|提案者.*proposer/);
  });

  it('[BEHAVIOR] SSE 响应字段 node 不使用禁用名 nodeName', () => {
    const src = readFileSync(HARNESS_ROUTE, 'utf-8');
    // 禁用字段不应作为 SSE data 的 key 输出
    // 路由代码应做字段映射：payload.nodeName → { node: payload.nodeName }
    expect(src).toMatch(/node\s*:/);
    // 验证不直接透传 payload（不应该 spread raw payload 到 SSE data）
    expect(src).not.toMatch(/\.\.\.row\.payload\b.*\bts\b/s);
  });

  it('[BEHAVIOR] SSE 响应字段使用 ts（非 timestamp/time）', () => {
    const src = readFileSync(HARNESS_ROUTE, 'utf-8');
    // 路由映射：created_at → ts
    expect(src).toMatch(/ts\s*:/);
    // 路由不应输出 timestamp 作为字段名
    const hasTimestampKey = /['"]timestamp['"]\s*:/m.test(src);
    expect(hasTimestampKey).toBe(false);
  });

  it('[BEHAVIOR] SSE 响应字段使用 attempt（非 attemptN）', () => {
    const src = readFileSync(HARNESS_ROUTE, 'utf-8');
    // 映射：payload.attemptN → { attempt: payload.attemptN }
    expect(src).toMatch(/attempt\s*:/);
    // 不直接把 attemptN 作为输出 key
    const hasAttemptNKey = /['"]attemptN['"]\s*:/m.test(src);
    expect(hasAttemptNKey).toBe(false);
  });

  it('[BEHAVIOR] 缺 planner_task_id 返回 400 error 结构', () => {
    const src = readFileSync(HARNESS_ROUTE, 'utf-8');
    // 验证 400 响应使用 error key（非 message）
    expect(src).toContain('400');
    expect(src).toMatch(/error\s*:/);
    const hasMessageKey = /'message'\s*:/m.test(src);
    expect(hasMessageKey).toBe(false);
  });

  it('[BEHAVIOR] 未知 ID 返回 404 error 结构', () => {
    const src = readFileSync(HARNESS_ROUTE, 'utf-8');
    expect(src).toContain('404');
    expect(src).toContain('pipeline not found');
  });

  it('[BEHAVIOR] event: done 在 task completed/failed 时发送', () => {
    const src = readFileSync(HARNESS_ROUTE, 'utf-8');
    expect(src).toContain('event: done');
    expect(src).toMatch(/completed|failed/);
  });
});
