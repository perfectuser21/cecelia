import { describe, it, expect } from 'vitest';
import { applyCheapRules } from '../capture-triage.js';

describe('applyCheapRules（addendum 便宜规则表）', () => {
  it('issue P0/P1 → urgent conf 1.0', () => {
    expect(applyCheapRules({ target_type: 'issue', target_subtype: 'P0', content: '' })).toEqual({ route: 'urgent', confidence: 1.0 });
    expect(applyCheapRules({ target_type: 'issue', target_subtype: 'P1', content: '' })).toEqual({ route: 'urgent', confidence: 1.0 });
  });
  it('issue P2 → 不命中（null）', () => {
    expect(applyCheapRules({ target_type: 'issue', target_subtype: 'P2', content: '' })).toBeNull();
  });
  it('learning 含「根本原因」→ invariant conf 0.8', () => {
    expect(applyCheapRules({ target_type: 'learning', target_subtype: 'failure_pattern', content: 'xx根本原因yy' })).toEqual({ route: 'invariant', confidence: 0.8 });
  });
  it('learning 不含「根本原因」→ null', () => {
    expect(applyCheapRules({ target_type: 'learning', target_subtype: 'failure_pattern', content: '普通教训' })).toBeNull();
  });
  it('handoff FAIL → line_backlog conf 0.9', () => {
    expect(applyCheapRules({ target_type: 'handoff', target_subtype: 'FAIL', content: '' })).toEqual({ route: 'line_backlog', confidence: 0.9 });
  });
  it('handoff PASS+NEXT → line_backlog conf 0.7', () => {
    expect(applyCheapRules({ target_type: 'handoff', target_subtype: 'PASS+NEXT', content: '' })).toEqual({ route: 'line_backlog', confidence: 0.7 });
  });
  it('handoff PASS（无下一步）→ null', () => {
    expect(applyCheapRules({ target_type: 'handoff', target_subtype: 'PASS', content: '' })).toBeNull();
  });
});
