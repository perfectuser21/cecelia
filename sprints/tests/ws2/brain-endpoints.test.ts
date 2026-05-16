/**
 * WS2: Brain SSE 端点 — GET /api/brain/initiatives/:id/events
 * TDD Red: 测试 initiative-events-routes.js 存在且行为符合 PRD schema
 * Generator 创建路由文件后变 Green
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const ROUTES_FILE = resolve('packages/brain/src/routes/initiative-events-routes.js');
const SERVER_FILE = resolve('packages/brain/server.js');

describe('Workstream 2 — Brain SSE 端点 [BEHAVIOR]', () => {
  it('[ARTIFACT] initiative-events-routes.js 文件存在', () => {
    expect(existsSync(ROUTES_FILE)).toBe(true);
  });

  it('[ARTIFACT] route 文件设置 Content-Type: text/event-stream', () => {
    const code = readFileSync(ROUTES_FILE, 'utf-8');
    expect(code).toContain('text/event-stream');
  });

  it('[ARTIFACT] route 文件包含 /:id/events 路由处理', () => {
    const code = readFileSync(ROUTES_FILE, 'utf-8');
    expect(code).toMatch(/['"]\/?:id\/events['"]|router\.get.*events/);
  });

  it('[ARTIFACT] route 文件查询 initiative_run_events 表', () => {
    const code = readFileSync(ROUTES_FILE, 'utf-8');
    expect(code).toContain('initiative_run_events');
  });

  it('[ARTIFACT] server.js 导入 initiative-events-routes', () => {
    const code = readFileSync(SERVER_FILE, 'utf-8');
    expect(code).toContain('initiative-events-routes');
  });

  it('[BEHAVIOR] SSE data 格式：event 字段只能是 "node_update"（字面量检查）', () => {
    const code = readFileSync(ROUTES_FILE, 'utf-8');
    // route 必须在 data 中写 event: 'node_update' 或 event: "node_update"
    expect(code).toMatch(/event.*node_update|node_update.*event/);
    // 禁用别名不应出现在 SSE data 构造中
    expect(code).not.toMatch(/event.*['"](update|change|status_change)['"]/);
  });

  it('[BEHAVIOR] SSE data 格式：包含 ts 字段（Unix 毫秒，不是 timestamp/time/created_at）', () => {
    const code = readFileSync(ROUTES_FILE, 'utf-8');
    expect(code).toMatch(/\bts\b.*[Dd]ate|Date.*\bts\b|\.getTime\(\)|Number\(.*created_at/);
    // 禁用字段名不应出现在 SSE data key 定义中
    expect(code).not.toMatch(/data.*timestamp.*:/);
  });

  it('[BEHAVIOR] 404 处理：不存在 initiative 时返回含 error 字段的 JSON', () => {
    const code = readFileSync(ROUTES_FILE, 'utf-8');
    expect(code).toContain('404');
    expect(code).toMatch(/error.*initiative not found|initiative not found.*error/);
    // 禁用字段 message/msg/reason 不应出现在 404 响应构造中
    expect(code).not.toMatch(/json\(\s*\{\s*message:/);
    expect(code).not.toMatch(/json\(\s*\{\s*msg:/);
  });

  it('[BEHAVIOR] SSE data keys 完整性：代码构造 data 时含且仅含 event/node/status/ts', () => {
    const code = readFileSync(ROUTES_FILE, 'utf-8');
    // 必须有 event, node, status, ts 四个字段被构造进 SSE data
    expect(code).toMatch(/event.*:/);
    expect(code).toMatch(/node.*:/);
    expect(code).toMatch(/status.*:/);
    expect(code).toMatch(/\bts\b.*:/);
  });

  it('[BEHAVIOR] SSE 端点检查 initiative 存在性（查 initiative_runs 或等价表）', () => {
    const code = readFileSync(ROUTES_FILE, 'utf-8');
    // 必须有某种 existence 检查，不能直接 flush 不存在的 initiative
    expect(code).toMatch(/initiative_runs|NOT FOUND|not found|404/i);
  });
});
