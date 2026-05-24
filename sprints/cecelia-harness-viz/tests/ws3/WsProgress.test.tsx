/**
 * WS3 Red Test — Dashboard UI WsProgressSection 渲染测试
 * 验证 HarnessPipelinePage.tsx 已添加 WS 进度渲染逻辑
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, accessSync } from 'fs';

describe('Dashboard UI — WS 进度渲染 [BEHAVIOR]', () => {
  const PAGE_FILE = 'apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx';
  const TEST_FILE = 'apps/dashboard/src/pages/harness-pipeline/__tests__/WsProgress.test.tsx';

  it('HarnessPipelinePage.tsx 含 ws-progress-section data-testid', () => {
    const src = readFileSync(PAGE_FILE, 'utf8');
    expect(src).toContain('ws-progress-section');
  });

  it('HarnessPipelinePage.tsx 含 ws-progress-row data-testid', () => {
    const src = readFileSync(PAGE_FILE, 'utf8');
    expect(src).toContain('ws-progress-row');
  });

  it('UI 代码引用所有 PRD 字段（keys 完整性）', () => {
    const src = readFileSync(PAGE_FILE, 'utf8');
    const required = ['ws_id', 'title', 'status', 'evaluate_verdict', 'pr_url', 'fix_round', 'container_id'];
    const missing = required.filter(f => !src.includes(f));
    expect(missing).toHaveLength(0);
  });

  it('UI 代码不引用禁用字段（禁用字段反向检查）', () => {
    const src = readFileSync(PAGE_FILE, 'utf8');
    // 检查新增的 WS progress 相关代码段不使用禁用字段名
    expect(src).not.toContain('.ws_list');
    expect(src).not.toContain('.phases');
    // steps 可能存在于其他上下文但不应作为 ws-progress 数据字段
  });

  it('UI 代码处理 status=merged 的显示（merged 状态）', () => {
    const src = readFileSync(PAGE_FILE, 'utf8');
    expect(src).toContain('merged');
  });

  it('UI 代码处理 container_id 非空时的运行中状态（边界场景）', () => {
    const src = readFileSync(PAGE_FILE, 'utf8');
    expect(src).toContain('container_id');
  });

  it('UI 代码含标题 ≤30 字截断逻辑（PRD 要求 ws 标题≤30字）', () => {
    const src = readFileSync(PAGE_FILE, 'utf8');
    const hasTrunc = src.includes('.slice(0,30)') || src.includes('.substring(0,30)') || src.includes('.substr(0,30)');
    expect(hasTrunc).toBe(true);
  });

  it('UI 代码含 data-testid=ws-verdict-badge（PRD verdict badge UI 约束）', () => {
    const src = readFileSync(PAGE_FILE, 'utf8');
    expect(src).toContain('ws-verdict-badge');
  });

  it('WsProgress.test.tsx 渲染测试文件存在', () => {
    expect(() => accessSync(TEST_FILE)).not.toThrow();
  });

  it('WsProgress.test.tsx 含 empty workstreams 渲染测试', () => {
    const src = readFileSync(TEST_FILE, 'utf8');
    expect(src).toMatch(/empty|空|workstreams.*\[\]/i);
  });

  it('WsProgress.test.tsx 含标题长度断言（≤30 字节，PRD UI 约束验证）', () => {
    const src = readFileSync(TEST_FILE, 'utf8');
    const hasTitleLengthAssert = src.includes('toBeLessThanOrEqual(30)') || src.includes('length).toBeLessThan(31)');
    expect(hasTitleLengthAssert).toBe(true);
  });
});
