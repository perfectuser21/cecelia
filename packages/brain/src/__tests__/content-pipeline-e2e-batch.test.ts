/**
 * content-pipeline-e2e-batch.test.ts
 *
 * 覆盖：
 *   1. topic-selector AVAILABLE_CONTENT_TYPES 扩展到3个
 *   2. batch-e2e-trigger 端点行为（内容类型轮换逻辑）
 *   3. _handleExportComplete pre-publish-check 集成（validateAllVariants 调用路径）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..', '..');

// ─── 1. AVAILABLE_CONTENT_TYPES 包含3个类型 ──────────────────────────────────

describe('topic-selector AVAILABLE_CONTENT_TYPES', () => {
  it('应包含至少3个内容类型', () => {
    const src = readFileSync(
      join(ROOT, 'packages/brain/src/topic-selector.js'),
      'utf-8',
    );
    const match = src.match(/AVAILABLE_CONTENT_TYPES\s*=\s*\[([^\]]+)\]/);
    expect(match).not.toBeNull();
    const types = match![1]
      .split(',')
      .map((s) => s.trim().replace(/['"]/g, ''))
      .filter(Boolean);
    expect(types.length).toBeGreaterThanOrEqual(3);
  });

  it('必须包含 solo-company-case、ai-tools-review、ai-workflow-guide', () => {
    const src = readFileSync(
      join(ROOT, 'packages/brain/src/topic-selector.js'),
      'utf-8',
    );
    expect(src).toContain('solo-company-case');
    expect(src).toContain('ai-tools-review');
    expect(src).toContain('ai-workflow-guide');
  });
});

// ─── 2. batch-e2e-trigger 路由代码静态检查 ────────────────────────────────────

describe('batch-e2e-trigger 端点', () => {
  it('路由文件包含 batch-e2e-trigger 端点定义', () => {
    const src = readFileSync(
      join(ROOT, 'packages/brain/src/routes/content-pipeline.js'),
      'utf-8',
    );
    expect(src).toContain('/batch-e2e-trigger');
    expect(src).toContain('keywords');
    expect(src).toContain('CONTENT_TYPE_ROTATION');
  });

  it('内容类型轮换包含3种类型', () => {
    const src = readFileSync(
      join(ROOT, 'packages/brain/src/routes/content-pipeline.js'),
      'utf-8',
    );
    const match = src.match(/CONTENT_TYPE_ROTATION\s*=\s*\[([^\]]+)\]/);
    expect(match).not.toBeNull();
    const types = match![1]
      .split(',')
      .map((s) => s.trim().replace(/['"]/g, ''))
      .filter(Boolean);
    expect(types.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── 3. pre-publish-check 集成到 _handleExportComplete ───────────────────────

describe('_handleExportComplete pre-publish-check 集成', () => {
  it('orchestrator 已 import validateAllVariants', () => {
    const src = readFileSync(
      join(ROOT, 'packages/brain/src/content-pipeline-orchestrator.js'),
      'utf-8',
    );
    expect(src).toContain("import { validateAllVariants }");
    expect(src).toContain('content-quality-validator');
  });

  it('_handleExportComplete 包含 pre_publish_check 逻辑', () => {
    const src = readFileSync(
      join(ROOT, 'packages/brain/src/content-pipeline-orchestrator.js'),
      'utf-8',
    );
    expect(src).toContain('pre_publish_check');
    expect(src).toContain('pre_publish_failed');
    expect(src).toContain('validateAllVariants');
  });

  it('validateAllVariants 在质量检查失败时不创建 publish jobs', () => {
    // 静态检查：pre_publish_failed 分支出现在 _createPublishJobs 调用之前
    const src = readFileSync(
      join(ROOT, 'packages/brain/src/content-pipeline-orchestrator.js'),
      'utf-8',
    );
    const prePublishIdx = src.indexOf('pre_publish_failed');
    const createPublishJobsIdx = src.indexOf('_createPublishJobs');
    // pre_publish_failed 标记出现在 _createPublishJobs 函数定义之前（在 _handleExportComplete 中）
    expect(prePublishIdx).toBeGreaterThan(0);
    expect(createPublishJobsIdx).toBeGreaterThan(0);
    // 在 _handleExportComplete 函数体内，pre_publish_failed 的 return 发生在 _createPublishJobs 调用前
    const fnStart = src.indexOf('async function _handleExportComplete');
    const fnSection = src.slice(fnStart, fnStart + 3000);
    const failIdx = fnSection.indexOf('pre_publish_failed');
    const jobsIdx = fnSection.indexOf('await _createPublishJobs');
    expect(failIdx).toBeGreaterThan(0);
    expect(jobsIdx).toBeGreaterThan(failIdx);
  });
});
