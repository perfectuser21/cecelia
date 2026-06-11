/**
 * harness-report.mjs 单测（TDD Red 阶段）
 *
 * 此文件在 packages/brain/scripts/harness-report.mjs 不存在时产生 3+ failures（Red 证据）。
 * generator 实现脚本后这些测试应全部 PASS（Green）。
 *
 * DoD 映射：
 * - SC-001: 模块导出 generateReportFiles / patchTaskCompleted / patchFeatureDone / upsertRegistries
 * - SC-002: patchFeatureDone 的请求体不含 thickness 字段（stale fix 验证）
 * - SC-003: generateReportFiles 在 sprintDir 下创建 harness-report.md / learning.md / index.html
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 这行 import 在 harness-report.mjs 不存在时直接 FAIL（Red 证据）
import {
  generateReportFiles,
  patchTaskCompleted,
  patchFeatureDone,
  upsertRegistries,
} from '../../../scripts/harness-report.mjs';

describe('harness-report.mjs exports [BEHAVIOR: SC-001]', () => {
  it('exports generateReportFiles function', () => {
    expect(typeof generateReportFiles).toBe('function');
  });

  it('exports patchTaskCompleted function', () => {
    expect(typeof patchTaskCompleted).toBe('function');
  });

  it('exports patchFeatureDone function', () => {
    expect(typeof patchFeatureDone).toBe('function');
  });

  it('exports upsertRegistries function', () => {
    expect(typeof upsertRegistries).toBe('function');
  });
});

describe('patchFeatureDone stale fix [BEHAVIOR: SC-002]', () => {
  it('does not include thickness field in PATCH body', async () => {
    const calls = [];
    const fakeFetch = async (url, opts) => {
      calls.push({ url, body: opts?.body ? JSON.parse(opts.body) : null });
      return { ok: true, json: async () => ({ id: 'fake-id', status: 'done' }) };
    };

    await patchFeatureDone('test-feature-id', { fetch: fakeFetch, brainUrl: 'http://localhost:5221' });

    expect(calls.length).toBeGreaterThan(0);
    const patchCall = calls.find(c => c.url.includes('journey_features'));
    expect(patchCall).toBeDefined();
    // 核心：PATCH body 不含 thickness 字段（stale fix）
    expect(patchCall.body).not.toHaveProperty('thickness');
    // 只发 status:done
    expect(patchCall.body).toHaveProperty('status', 'done');
  });
});

describe('generateReportFiles [BEHAVIOR: SC-003]', () => {
  it('generates harness-report.md with sprint header', async () => {
    const written = {};
    const fakeFs = {
      writeFileSync: (path, content) => { written[path] = content; },
      existsSync: () => true,
      readFileSync: (path) => {
        if (path.includes('sprint-prd.md')) return '# Sprint Test\n## journey_type: autonomous';
        if (path.includes('contract-draft.md')) return '# Contract Draft\n';
        return '';
      },
    };

    await generateReportFiles('/tmp/test-sprint', {
      taskId: 'fake-task-id',
      prUrl: 'https://github.com/test/repo/pull/1',
      fs: fakeFs,
    });

    const reportPath = Object.keys(written).find(p => p.includes('harness-report.md'));
    expect(reportPath).toBeDefined();
    expect(written[reportPath]).toMatch(/Sprint|PR #|━━/);

    const learningPath = Object.keys(written).find(p => p.includes('learning.md'));
    expect(learningPath).toBeDefined();

    const indexPath = Object.keys(written).find(p => p.includes('index.html'));
    expect(indexPath).toBeDefined();
  });
});
