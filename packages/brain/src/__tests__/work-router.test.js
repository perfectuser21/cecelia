import { describe, expect, it } from 'vitest';
import { CHANGE_KINDS, normalizeWorkRequest, selectPipeline } from '../work-router.js';

describe('unified work router', () => {
  it('maps all four change kinds forward', () => {
    expect(CHANGE_KINDS).toEqual(['new_capability', 'capability_change', 'bugfix', 'parameter_only']);
    for (const change_kind of CHANGE_KINDS) {
      expect(selectPipeline({ work_kind: 'coding_mutation', change_kind })).toMatchObject({
        pipeline: 'harness', canonical_task_type: 'harness_initiative', change_kind,
      });
    }
  });
  it('requires change_kind and strict normalized enums', () => {
    expect(() => selectPipeline({ work_kind: 'coding_mutation', gear: 'hotfix' })).toThrow('change_kind_required');
    expect(() => normalizeWorkRequest({ source: 'evil', source_id: '1', title: 'x', mutation_intent: 'write' })).toThrow('invalid_source');
  });
});
