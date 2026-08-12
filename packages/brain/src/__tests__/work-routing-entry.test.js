import { describe, expect, it } from 'vitest';
import { routeWork } from '../work-router.js';

describe('routing entry', () => {
  it('fails closed when a coding repository cannot be resolved', () => {
    expect(() => routeWork({ source: 'api', source_id: '1', title: 'fix', mutation_intent: 'write', declared_change_kind: 'bugfix' }, [])).toThrow('repo_unknown');
  });
});
