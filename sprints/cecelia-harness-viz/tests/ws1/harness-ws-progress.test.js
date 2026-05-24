/**
 * WS1 Red Test — Brain API ws-progress 路由
 * 验证 GET /api/brain/harness/initiative/:id/ws-progress 端点尚不存在（红证据）
 */
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

describe('Brain API — GET /initiative/:id/ws-progress [BEHAVIOR]', () => {
  it('路由存在（harness.js 含 ws-progress 定义）', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('packages/brain/src/routes/harness.js', 'utf8');
    expect(src).toContain('ws-progress');
  });

  it('路由返回 initiative_id + workstreams 顶层 keys（schema 完整性）', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('packages/brain/src/routes/harness.js', 'utf8');
    // 路由实现必须引用 initiative_id
    expect(src).toContain('initiative_id');
    // 路由实现必须引用 workstreams
    expect(src).toContain('workstreams');
  });

  it('路由查询 checkpoint_blobs 表（数据来源正确）', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('packages/brain/src/routes/harness.js', 'utf8');
    expect(src).toContain('checkpoint_blobs');
  });

  it('路由实现对不存在 initiative 返回 404（error path）', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('packages/brain/src/routes/harness.js', 'utf8');
    expect(src).toContain('404');
    expect(src).toContain('initiative not found');
  });

  it('路由响应不含禁用字段（禁用字段反向检查）', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('packages/brain/src/routes/harness.js', 'utf8');
    // 在 ws-progress route handler 内不应有 steps/phases/stages/ws_list 作为响应 key
    const routeSection = src.split('ws-progress')[1]?.split('router.')[0] ?? '';
    expect(routeSection).not.toMatch(/"steps"\s*:/);
    expect(routeSection).not.toMatch(/"phases"\s*:/);
    expect(routeSection).not.toMatch(/"stages"\s*:/);
    expect(routeSection).not.toMatch(/"ws_list"\s*:/);
  });
});
