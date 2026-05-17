import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readBrainResult } from '../../harness-shared.js';

describe('evaluator 节点 — .brain-result.json 协议', () => {
  it('容器写 PASS → readBrainResult 返回 verdict=PASS（evaluator 判 PASS）', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'initiative-b39-'));
    try {
      writeFileSync(join(tmpDir, '.brain-result.json'), JSON.stringify({
        verdict: 'PASS',
        failed_step: null,
        log_excerpt: null,
      }));
      const r = await readBrainResult(tmpDir, ['verdict']);
      // evaluator logic: if (resultData.verdict === 'PASS') → verdictDelta = { final_e2e_verdict: 'PASS' }
      expect(r.verdict).toBe('PASS');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('容器写 FAIL + failed_step → readBrainResult 正确返回失败信息（evaluator 判 FAIL）', async () => {
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

  it('容器未写文件 → readBrainResult 抛 missing_result_file（evaluator fallback: result_file_missing）', async () => {
    // 模拟 evaluator 节点的 try/catch 行为：
    // readBrainResult throws → evaluator catches and synthesizes FAIL verdict
    const tmpDir = mkdtempSync(join(tmpdir(), 'initiative-b39-'));
    try {
      // 不写文件 — 模拟容器 crash 或超时退出
      let resultData;
      try {
        resultData = await readBrainResult(tmpDir, ['verdict']);
      } catch (readErr) {
        // 这就是 evaluator 节点里的 catch 逻辑（harness-initiative.graph.js ~1411）
        resultData = { verdict: 'FAIL', failed_step: 'result_file_missing', log_excerpt: readErr.message };
      }
      expect(resultData.verdict).toBe('FAIL');
      expect(resultData.failed_step).toBe('result_file_missing');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
