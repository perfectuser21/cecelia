import { describe, expect, it } from 'vitest';

import { reconcileRequiredCommandEvidence } from '../required-command-evidence.js';

describe('reconcileRequiredCommandEvidence', () => {
  it('只接受逐字匹配、成功退出且带真实日志的命令证据', () => {
    const result = reconcileRequiredCommandEvidence(
      ['npm test', 'bash scripts/smoke.sh'],
      [
        { command: 'npm test', exit_code: 0, log_tail: '133 tests passed' },
        { command: 'bash scripts/smoke.sh', exit_code: 0, log_tail: 'smoke passed' },
      ],
    );

    expect(result).toEqual({
      provided: true,
      valid: true,
      complete: true,
      missing: [],
    });
  });

  it.each([
    {
      name: '命令不完全一致',
      evidence: { command: 'npm test -- --run', exit_code: 0, log_tail: 'passed' },
    },
    {
      name: '退出码失败',
      evidence: { command: 'npm test', exit_code: 1, log_tail: 'failed' },
    },
    {
      name: '日志为空',
      evidence: { command: 'npm test', exit_code: 0, log_tail: '' },
    },
  ])('$name 时保持 fail-closed', ({ evidence }) => {
    const result = reconcileRequiredCommandEvidence(['npm test'], [evidence]);

    expect(result.complete).toBe(false);
    expect(result.missing).toEqual(['npm test']);
  });

  it.each([
    { required: [] },
    { required: ['npm test', '   '] },
  ])('拒绝空或含空命令的声明：$required', ({ required }) => {
    const result = reconcileRequiredCommandEvidence(required, []);

    expect(result.provided).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.complete).toBe(false);
    expect(result.invalidReason).toMatch(/required_command_evidence/);
  });
});
