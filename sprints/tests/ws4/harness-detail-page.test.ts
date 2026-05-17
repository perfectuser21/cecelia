import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';

describe('Workstream 4 — Dashboard HarnessDetailPage [BEHAVIOR]', () => {
  const PAGE_PATH = 'apps/dashboard/src/pages/harness/HarnessDetailPage.tsx';

  it('HarnessDetailPage.tsx 文件存在', () => {
    expect(existsSync(PAGE_PATH)).toBe(true);
  });

  it('HarnessDetailPage.tsx 含 EventSource 构造', () => {
    const content = readFileSync(PAGE_PATH, 'utf8');
    expect(content).toContain('EventSource');
  });

  it('EventSource URL 含 initiative_id 参数（禁用 taskId/task_id/planner_task_id/id）', () => {
    const content = readFileSync(PAGE_PATH, 'utf8');
    expect(content).toContain('initiative_id');
    expect(content).not.toContain('taskId=');
    expect(content).not.toContain('task_id=');
    expect(content).not.toContain('planner_task_id=');
  });

  it('HarnessDetailPage.tsx 含 data-testid="realtime-log"', () => {
    const content = readFileSync(PAGE_PATH, 'utf8');
    expect(content).toContain('realtime-log');
  });

  it('HarnessDetailPage.tsx 含 data-testid="log-entry"', () => {
    const content = readFileSync(PAGE_PATH, 'utf8');
    expect(content).toContain('log-entry');
  });

  it('HarnessDetailPage.tsx 监听 run_completed 事件（不是 done）', () => {
    const content = readFileSync(PAGE_PATH, 'utf8');
    expect(content).toContain('run_completed');
    expect(content).not.toMatch(/'done'|"done"/);
  });

  it('HarnessDetailPage.tsx 显示 Pipeline 已完成 / Pipeline 失败 状态文字', () => {
    const content = readFileSync(PAGE_PATH, 'utf8');
    expect(content).toMatch(/Pipeline 已完成|Pipeline 失败|已完成|失败/);
  });

  it('router 注册 /harness/:id → HarnessDetailPage', () => {
    const candidates = [
      'apps/dashboard/src/config/routes.tsx',
      'apps/dashboard/src/App.tsx',
      'apps/dashboard/src/router.tsx',
    ];
    const found = candidates.some(f => {
      try {
        const c = readFileSync(f, 'utf8');
        return c.includes('/harness/') && c.includes('HarnessDetailPage');
      } catch {
        return false;
      }
    });
    expect(found).toBe(true);
  });
});
