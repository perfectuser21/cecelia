import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readBrainResult } from '../../harness-shared.js';

describe('evaluator 节点 — 读 .brain-result.json', () => {
  it('容器写 PASS → readBrainResult 返回 verdict=PASS', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'initiative-b39-'));
    try {
      writeFileSync(join(tmpDir, '.brain-result.json'), JSON.stringify({
        verdict: 'PASS',
        failed_step: null,
        log_excerpt: null,
      }));
      const r = await readBrainResult(tmpDir, ['verdict']);
      expect(r.verdict).toBe('PASS');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('容器写 FAIL + failed_step → readBrainResult 正确返回失败信息', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'initiative-b39-'));
    try {
      writeFileSync(join(tmpDir, '.brain-result.json'), JSON.stringify({
        verdict: 'FAIL',
        failed_step: 'Step 3: curl /api/sum',
        log_excerpt: 'curl: (7) Failed to connect to localhost port 5221',
      }));
      const r = await readBrainResult(tmpDir, ['verdict', 'failed_step']);
      expect(r.verdict).toBe('FAIL');
      expect(r.failed_step).toBe('Step 3: curl /api/sum');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
