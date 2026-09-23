import { describe, expect, it } from 'vitest';
import { classifyDispatchReasonCode } from '../dispatch-reason-code.js';

describe('classifyDispatchReasonCode', () => {
  it('优先取显式 reason_code', () => {
    expect(classifyDispatchReasonCode({ reason_code: 'needs_rebase', error: 'x' })).toBe('needs_rebase');
  });
  it('从 error 文本识别 map_* / impact_* / credential_* 前缀', () => {
    expect(classifyDispatchReasonCode({ error: 'map_revision_mismatch' })).toBe('map_revision_mismatch');
    expect(classifyDispatchReasonCode({ error: 'impact_assertion_missing' })).toBe('impact_assertion_missing');
    expect(classifyDispatchReasonCode({ error: 'kernel_process_fatal:credential_payload_invalid' })).toBe('credential_payload_invalid');
  });
  it('识别 needs_rebase / map_thrash 单词', () => {
    expect(classifyDispatchReasonCode({ reason: 'needs_rebase' })).toBe('needs_rebase');
    expect(classifyDispatchReasonCode({ error: 'map_thrash' })).toBe('map_thrash');
  });
  it('复合文本里精确码优先，不吞成复合串', () => {
    expect(classifyDispatchReasonCode({ error: 'map_revision_mismatch_needs_rebase' })).toBe('needs_rebase');
  });
  it('token 含数字时取整段，不截断', () => {
    expect(classifyDispatchReasonCode({ error: 'map_scope_v2_mismatch' })).toBe('map_scope_v2_mismatch');
  });
  it('reanchor 调用契约违约码保留原码，不归 executor_failed', () => {
    expect(classifyDispatchReasonCode({ error: 'task_metadata_missing' })).toBe('task_metadata_missing');
    expect(classifyDispatchReasonCode({ error: 'kernel_process_fatal:receipt_task_mismatch' })).toBe('receipt_task_mismatch');
    expect(classifyDispatchReasonCode({ error: 'receipt_superseded' })).toBe('receipt_superseded');
  });
  it('未知归 executor_failed', () => {
    expect(classifyDispatchReasonCode({ error: 'payload missing callback_url' })).toBe('executor_failed');
    expect(classifyDispatchReasonCode()).toBe('executor_failed');
  });
});
