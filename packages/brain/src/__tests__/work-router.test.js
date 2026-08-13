import { describe, expect, it } from 'vitest';
import { CHANGE_KINDS, normalizeWorkRequest, routeWork, selectPipeline } from '../work-router.js';

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

  it('returns a deterministic complete decision and never infers a repo', () => {
    const request = {
      source: 'api', source_id: 'request-1', title: 'fix', mutation_intent: 'write',
      declared_change_kind: 'bugfix', repo_hint: 'https://github.com/perfectuser21/cecelia.git',
      execution_profile_override_request: 'new-capability-v1',
      branch: 'cp-fix', base_sha: 'a'.repeat(40),
      decided_at: '2026-08-13T00:00:00.000Z',
    };
    const first = routeWork(request, [{ repo: 'perfectuser21/cecelia', path: '/workspace' }]);
    const second = routeWork(request, [{ repo: 'perfectuser21/cecelia', path: '/workspace' }]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      repo: 'perfectuser21/cecelia',
      execution_profile_override: 'new-capability-v1',
      evidence: { branch: 'cp-fix', base_sha: 'a'.repeat(40) },
    });
    expect(first.decided_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
