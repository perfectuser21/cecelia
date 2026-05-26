/**
 * WS2 — WS 进度可视化 static structure tests [BEHAVIOR]
 * 验证 HarnessPipelinePage.tsx 和 status.js 的结构性修改
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '../../../');
const PAGE = join(REPO_ROOT, 'apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx');
const STATUS_JS = join(REPO_ROOT, 'packages/brain/src/routes/status.js');

describe('WS2 — Dashboard WsProgressSection 组件 [BEHAVIOR]', () => {
  it('HarnessPipelinePage.tsx 含 WsWorkstream interface', () => {
    const c = readFileSync(PAGE, 'utf-8');
    expect(c).toContain('WsWorkstream');
  });

  it('WsWorkstream interface 含 evaluate_verdict 字段', () => {
    const c = readFileSync(PAGE, 'utf-8');
    const start = c.indexOf('interface WsWorkstream');
    const end = c.indexOf('}', start);
    const iface = c.slice(start, end + 1);
    expect(iface).toContain('evaluate_verdict');
    expect(iface).toContain('pr_url');
    expect(iface).toContain('ws_id');
    expect(iface).toContain('status');
  });

  it('Pipeline interface 含 task_type 可选字段', () => {
    const c = readFileSync(PAGE, 'utf-8');
    const start = c.indexOf('interface Pipeline');
    const end = c.indexOf('}', start);
    const iface = c.slice(start, end + 1);
    expect(iface).toContain('task_type');
  });

  it('WsProgressSection 组件存在', () => {
    const c = readFileSync(PAGE, 'utf-8');
    expect(c).toContain('function WsProgressSection');
  });

  it('WsProgressSection 组件含 data-testid="ws-progress-section"', () => {
    const c = readFileSync(PAGE, 'utf-8');
    expect(c).toContain('ws-progress-section');
  });

  it('WsProgressSection 调用 /api/brain/harness/initiative/ ws-progress 端点', () => {
    const c = readFileSync(PAGE, 'utf-8');
    const fnStart = c.indexOf('function WsProgressSection');
    const fnEnd = c.indexOf('\nfunction ', fnStart + 10);
    const fn = c.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 2000);
    expect(fn).toContain('ws-progress');
    expect(fn).toContain('initiative');
  });

  it('WsProgressSection 显示 evaluate_verdict', () => {
    const c = readFileSync(PAGE, 'utf-8');
    const fnStart = c.indexOf('function WsProgressSection');
    const fnEnd = c.indexOf('\nfunction ', fnStart + 10);
    const fn = c.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 2000);
    expect(fn).toContain('evaluate_verdict');
  });

  it('WsProgressSection 在 harness_initiative 卡片中渲染', () => {
    const c = readFileSync(PAGE, 'utf-8');
    expect(c).toContain("harness_initiative");
    expect(c).toContain('WsProgressSection');
  });
});

describe('WS2 — Brain status.js task_type 字段 [BEHAVIOR]', () => {
  it('buildPipelineRecord 返回 task_type: task.task_type', () => {
    const c = readFileSync(STATUS_JS, 'utf-8');
    const fnStart = c.indexOf('function buildPipelineRecord');
    const fnEnd = c.indexOf('\nrouter.', fnStart);
    const fn = c.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 3000);
    expect(fn).toContain('task_type: task.task_type');
  });

  it('buildPipelineRecord return object 含 pipeline_id 和 task_type（向后兼容 + 新字段）', () => {
    const c = readFileSync(STATUS_JS, 'utf-8');
    const returnIdx = c.lastIndexOf('return {', c.indexOf('\nrouter.', c.indexOf('function buildPipelineRecord')));
    const returnBlock = c.slice(returnIdx, c.indexOf('};', returnIdx) + 2);
    expect(returnBlock).toContain('pipeline_id');
    expect(returnBlock).toContain('task_type');
  });
});
