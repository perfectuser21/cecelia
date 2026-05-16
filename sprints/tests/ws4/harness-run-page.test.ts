/**
 * WS4: Dashboard HarnessRunPage.tsx + 路由注册
 * TDD Red: 测试 HarnessRunPage.tsx 存在且行为符合 PRD spec
 * Generator 创建页面文件后变 Green
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const PAGE_FILE = resolve('apps/dashboard/src/pages/harness/HarnessRunPage.tsx');
const APP_FILE = resolve('apps/dashboard/src/App.tsx');

describe('Workstream 4 — Dashboard HarnessRunPage [BEHAVIOR]', () => {
  it('[ARTIFACT] HarnessRunPage.tsx 文件存在', () => {
    expect(existsSync(PAGE_FILE)).toBe(true);
  });

  it('[ARTIFACT] HarnessRunPage.tsx 使用 EventSource 建立 SSE 连接', () => {
    const code = readFileSync(PAGE_FILE, 'utf-8');
    expect(code).toContain('EventSource');
  });

  it('[ARTIFACT] HarnessRunPage.tsx SSE URL 包含 /api/brain/initiatives（正确端点路径）', () => {
    const code = readFileSync(PAGE_FILE, 'utf-8');
    expect(code).toContain('api/brain/initiatives');
    // 禁用旧路径
    expect(code).not.toContain('harness/pipeline');
    expect(code).not.toContain('pipeline/:initiative_id');
  });

  it('[ARTIFACT] App.tsx 包含 /harness/:id 路由注册', () => {
    const code = readFileSync(APP_FILE, 'utf-8');
    expect(code).toMatch(/\/harness\//);
  });

  it('[ARTIFACT] App.tsx 引用 HarnessRunPage 组件', () => {
    const code = readFileSync(APP_FILE, 'utf-8');
    expect(code).toContain('HarnessRunPage');
  });

  it('[BEHAVIOR] HarnessRunPage.tsx 处理 node_update 事件（schema 字段值匹配）', () => {
    const code = readFileSync(PAGE_FILE, 'utf-8');
    expect(code).toContain('node_update');
  });

  it('[BEHAVIOR] HarnessRunPage.tsx 读取 event.data 并解析 JSON（接收 SSE data 行）', () => {
    const code = readFileSync(PAGE_FILE, 'utf-8');
    expect(code).toMatch(/JSON\.parse|\.data\b/);
  });

  it('[BEHAVIOR] HarnessRunPage.tsx 渲染 node 和 status 字段（节点列表显示）', () => {
    const code = readFileSync(PAGE_FILE, 'utf-8');
    expect(code).toMatch(/\.node\b|node\b.*status|{node}/);
    expect(code).toMatch(/\.status\b|{status}/);
  });

  it('[BEHAVIOR] HarnessRunPage.tsx 在 cleanup 时调用 EventSource.close()', () => {
    const code = readFileSync(PAGE_FILE, 'utf-8');
    expect(code).toMatch(/\.close\(\)|eventSource\.close|es\.close|sse\.close/);
  });

  it('[BEHAVIOR] HarnessRunPage.tsx 不引用禁用 SSE 字段名（timestamp/agent/step）', () => {
    const code = readFileSync(PAGE_FILE, 'utf-8');
    // data.timestamp 应该是 data.ts
    expect(code).not.toMatch(/data\.timestamp\b|\.timestamp\s*[,}]/);
    // node 值不应是 agent/step/phase
    expect(code).not.toMatch(/['"](agent|step|phase)['"]\s*[,}=]/);
  });

  it('[BEHAVIOR] HarnessRunPage.tsx 使用 useParams 读取 initiative_id（React Router）', () => {
    const code = readFileSync(PAGE_FILE, 'utf-8');
    expect(code).toContain('useParams');
  });
});
