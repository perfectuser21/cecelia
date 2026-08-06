/**
 * GP2/T2 golden_path_proposal 四表登记（architecture: 2026-07-12-golden-path-mode）。
 * 防 strategist_decision 式漏登：四表任一缺失，任务创建/派发即被拒或降级。
 */
import { describe, it, expect } from 'vitest';
import {
  VALID_TASK_TYPES,
  SKILL_WHITELIST,
  LOCATION_MAP,
  TASK_REQUIREMENTS,
  routeTaskCreate,
} from '../task-router.js';

describe('task-router: golden_path_proposal registration', () => {
  it('is a valid task type', () => {
    expect(VALID_TASK_TYPES).toContain('golden_path_proposal');
  });

  it('routes to /capability-controller skill', () => {
    expect(SKILL_WHITELIST['golden_path_proposal']).toBe('/capability-controller');
  });

  it('is located at us', () => {
    expect(LOCATION_MAP['golden_path_proposal']).toBe('us');
  });

  it('requires has_git', () => {
    expect(TASK_REQUIREMENTS['golden_path_proposal']).toEqual(['has_git']);
  });

  it('routeTaskCreate resolves full routing for golden_path_proposal', () => {
    const result = routeTaskCreate({ title: 'GP 提案', task_type: 'golden_path_proposal' });
    expect(result.location).toBe('us');
    expect(result.skill).toBe('/capability-controller');
  });
});
