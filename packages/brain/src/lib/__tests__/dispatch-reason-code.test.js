import { describe, expect, it } from 'vitest';
import { classifyDispatchReasonCode, dispatchFailureFromError, KNOWN_REASON_CODES } from '../dispatch-reason-code.js';

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

// err.code 是个拥挤的命名空间：pg 错误码（23505）、node 网络错误码（ECONNREFUSED）都住在里面，
// 只有白名单内的码才是派发失败语义码，其余一律退回文本分类，避免把 DB/网络故障伪装成契约违约。
describe('dispatchFailureFromError', () => {
  it('白名单内的 err.code 直接采用，detail 原样透传', () => {
    const detail = { old_base_sha: 'a'.repeat(40), new_base_sha: 'b'.repeat(40), branch: 'cp-route-api-1' };
    expect(dispatchFailureFromError({ code: 'needs_rebase', message: 'branch has work', detail })).toEqual({
      reason: 'needs_rebase',
      reason_code: 'needs_rebase',
      detail,
    });
    expect(dispatchFailureFromError({ code: 'receipt_superseded', message: 'stale receipt' })).toEqual({
      reason: 'kernel_authority_not_created',
      reason_code: 'receipt_superseded',
      detail: null,
    });
  });

  it('pg 错误码 23505 不进 reason_code，退回文本分类', () => {
    expect(dispatchFailureFromError({ code: '23505', message: 'duplicate key value violates unique constraint' })).toEqual({
      reason: 'kernel_authority_not_created',
      reason_code: 'executor_failed',
      detail: null,
    });
  });

  it('node 网络错误码 ECONNREFUSED 不进 reason_code，退回文本分类', () => {
    expect(dispatchFailureFromError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:3457' })).toEqual({
      reason: 'kernel_authority_not_created',
      reason_code: 'executor_failed',
      detail: null,
    });
  });

  it('无 code 时按 message 分类，needs_rebase 文本仍判停车', () => {
    expect(dispatchFailureFromError({ message: 'map_revision_mismatch' }).reason_code).toBe('map_revision_mismatch');
    expect(dispatchFailureFromError({ message: 'needs_rebase' })).toMatchObject({
      reason: 'needs_rebase',
      reason_code: 'needs_rebase',
    });
    expect(dispatchFailureFromError()).toEqual({
      reason: 'kernel_authority_not_created',
      reason_code: 'executor_failed',
      detail: null,
    });
  });

  it('KNOWN_REASON_CODES 是只读白名单，含全部精确码', () => {
    expect(KNOWN_REASON_CODES.has('needs_rebase')).toBe(true);
    expect(KNOWN_REASON_CODES.has('map_thrash')).toBe(true);
    expect(KNOWN_REASON_CODES.has('task_metadata_missing')).toBe(true);
    expect(KNOWN_REASON_CODES.has('receipt_task_mismatch')).toBe(true);
    expect(KNOWN_REASON_CODES.has('receipt_superseded')).toBe(true);
    expect(KNOWN_REASON_CODES.has('23505')).toBe(false);
    expect(Object.isFrozen(KNOWN_REASON_CODES)).toBe(true);
  });
});
