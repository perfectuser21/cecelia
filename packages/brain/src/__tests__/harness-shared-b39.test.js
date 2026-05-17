import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readBrainResult } from '../harness-shared.js';

let tmpDir;
beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'brain-result-')); });
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

describe('readBrainResult', () => {
  it('文件存在且 schema 合法 → 返回 parsed object', async () => {
    writeFileSync(join(tmpDir, '.brain-result.json'), JSON.stringify({
      propose_branch: 'cp-harness-propose-r1-f5a1db9c',
      workstream_count: 2,
      task_plan_path: 'sprints/w50/task-plan.json',
    }));
    const result = await readBrainResult(tmpDir, ['propose_branch']);
    expect(result.propose_branch).toBe('cp-harness-propose-r1-f5a1db9c');
    expect(result.workstream_count).toBe(2);
  });

  it('文件不存在 → 抛 ContractViolation missing_result_file', async () => {
    await expect(readBrainResult(tmpDir, ['verdict'])).rejects.toThrow('missing_result_file');
  });

  it('必填字段缺失 → 抛 ContractViolation invalid_result_file 含字段名', async () => {
    writeFileSync(join(tmpDir, '.brain-result.json'), JSON.stringify({ verdict: 'PASS' }));
    await expect(readBrainResult(tmpDir, ['verdict', 'rubric_scores'])).rejects.toThrow('rubric_scores');
  });

  it('null 值字段 → 视为缺失，抛 ContractViolation', async () => {
    writeFileSync(join(tmpDir, '.brain-result.json'), JSON.stringify({ verdict: null }));
    await expect(readBrainResult(tmpDir, ['verdict'])).rejects.toThrow('verdict');
  });
});
