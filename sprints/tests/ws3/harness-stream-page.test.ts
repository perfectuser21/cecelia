/**
 * WS3 TDD Red Phase — HarnessStreamPage Dashboard 组件 + 路由注册
 * HarnessStreamPage.tsx 尚未创建，/harness/:id 路由尚未注册
 * Generator 实现后变 Green
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '../../../');
const PAGE_FILE = join(REPO_ROOT, 'apps/dashboard/src/pages/harness/HarnessStreamPage.tsx');
const ROUTE_FILE = join(REPO_ROOT, 'apps/api/features/system-hub/index.ts');

describe('WS3 — HarnessStreamPage + 路由注册 [BEHAVIOR]', () => {
  it('HarnessStreamPage.tsx 文件存在', () => {
    expect(existsSync(PAGE_FILE), `文件不存在: ${PAGE_FILE}`).toBe(true);
  });

  it('HarnessStreamPage.tsx 使用原生 EventSource API', () => {
    const content = readFileSync(PAGE_FILE, 'utf-8');
    expect(content).toMatch(/new EventSource\(/);
  });

  it('HarnessStreamPage.tsx 处理 event: node_update', () => {
    const content = readFileSync(PAGE_FILE, 'utf-8');
    expect(content).toContain('node_update');
  });

  it('HarnessStreamPage.tsx 处理 event: done 并关闭 SSE 连接', () => {
    const content = readFileSync(PAGE_FILE, 'utf-8');
    expect(content).toMatch(/\bdone\b/);
    expect(content).toMatch(/\.close\(\)/);
  });

  it('HarnessStreamPage.tsx SSE URL 使用 /api/brain/harness/pipeline/{id}/stream', () => {
    const content = readFileSync(PAGE_FILE, 'utf-8');
    expect(content).toContain('harness/pipeline');
    expect(content).toContain('/stream');
    expect(content).not.toContain('planner_task_id');
  });

  it('HarnessStreamPage.tsx 使用 useParams 读取 initiative_id', () => {
    const content = readFileSync(PAGE_FILE, 'utf-8');
    expect(content).toContain('useParams');
  });

  it('/harness/:id 路由注册在 system-hub index.ts 中', () => {
    const content = readFileSync(ROUTE_FILE, 'utf-8');
    expect(content).toContain('/harness/:id');
    expect(content).toContain('HarnessStreamPage');
  });
});
