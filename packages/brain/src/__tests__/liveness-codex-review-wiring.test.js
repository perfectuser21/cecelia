import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { VALID_EXECUTOR_KINDS, EXECUTOR_CONTRACTS } from '../executor-contracts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const executorSrc = readFileSync(path.join(__dirname, '..', 'executor.js'), 'utf8');
const requeuerSrc = readFileSync(path.join(__dirname, '..', 'paused-requeuer.js'), 'utf8');

// liveness 误判 codex-review 修复接线（决策 9befa9c3，issue f1d6840f）
describe('codex-review-local 合同注册', () => {
  it('VALID_EXECUTOR_KINDS 含 codex-review-local', () => {
    expect(VALID_EXECUTOR_KINDS).toContain('codex-review-local');
  });

  it('合同存在且 onStale=requeue、staleMinutes=90', () => {
    const c = EXECUTOR_CONTRACTS['codex-review-local'];
    expect(c).toBeDefined();
    expect(c.onStale).toBe('requeue');
    expect(c.staleMinutes).toBe(90);
    expect(typeof c.probe).toBe('function');
  });
});

describe('executor.js 接线', () => {
  it('triggerCodexReview 打标 codex-review-local', () => {
    expect(executorSrc).toMatch(/setExecutorKind\(task\.id, 'codex-review-local'\)/);
  });

  it('probeTaskLiveness 对 REVIEW 类任务用 lock 探测（不再 ps 扫描恒判死）', () => {
    expect(executorSrc).toMatch(/REVIEW_TASK_TYPES\.includes\(task\.task_type\)[\s\S]{0,300}probeCodexReviewLock/);
  });
});

describe('paused-requeuer 清 claim', () => {
  it('requeue UPDATE 同时清 claimed_by/claimed_at（防回队后无主卡死）', () => {
    expect(requeuerSrc).toMatch(/status = 'queued',[\s\S]{0,200}claimed_by = NULL,[\s\S]{0,80}claimed_at = NULL/);
  });
});
