/**
 * scheduler-jobs-ws3.contract.test.js
 *
 * WS3 合同测试 — 调度注册（FR-3）
 * 验证 scheduler-jobs.js JOBS 数组中包含 WS3 新增的两个 job
 *
 * 不运行真实 handler，只验证 JOBS 表结构。
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SCHEDULER_PATH = resolve('/workspace/packages/brain/src/scheduler-jobs.js');

describe('scheduler-jobs.js — WS3 FR-3 调度注册合同测试', () => {
  it('[FR-3] JOBS 数组中包含 notion-product-push job', () => {
    const source = readFileSync(SCHEDULER_PATH, 'utf8');
    expect(source).toContain('notion-product-push');
    expect(source).toMatch(/notion-product-push.*needsPool.*true|needsPool.*true.*notion-product-push/s);
  });

  it('[FR-3] JOBS 数组中包含 notion-verdict-ingest job', () => {
    const source = readFileSync(SCHEDULER_PATH, 'utf8');
    expect(source).toContain('notion-verdict-ingest');
    expect(source).toMatch(/notion-verdict-ingest.*needsPool.*true|needsPool.*true.*notion-verdict-ingest/s);
  });

  it('[FR-3] scheduler-jobs.js 导入 runNotionProductPush 或 pushProductToNotionInbox', () => {
    const source = readFileSync(SCHEDULER_PATH, 'utf8');
    const hasImport =
      source.includes('runNotionProductPush') ||
      source.includes('pushProductToNotionInbox') ||
      source.includes('notion-inbox-push');
    expect(hasImport).toBe(true);
  });

  it('[FR-3] scheduler-jobs.js 导入 runNotionVerdictIngest 或 consumeVerdictFromNotion', () => {
    const source = readFileSync(SCHEDULER_PATH, 'utf8');
    const hasImport =
      source.includes('runNotionVerdictIngest') ||
      source.includes('consumeVerdictFromNotion') ||
      source.includes('notion-verdict-ingest');
    expect(hasImport).toBe(true);
  });

  it('[FR-3] notion-product-push job description 含 F5 或 呈报 关键词', () => {
    const source = readFileSync(SCHEDULER_PATH, 'utf8');
    // 找到 notion-product-push 段落，检查 description
    const match = source.match(/notion-product-push[\s\S]{0,300}/);
    expect(match).toBeTruthy();
    const segment = match[0];
    const hasKeyword = segment.includes('F5') || segment.includes('呈报') || segment.includes('成品');
    expect(hasKeyword).toBe(true);
  });
});
