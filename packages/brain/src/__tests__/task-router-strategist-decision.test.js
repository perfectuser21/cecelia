import { describe, it, expect } from 'vitest';
import {
  VALID_TASK_TYPES,
  SKILL_WHITELIST,
  LOCATION_MAP,
  TASK_REQUIREMENTS,
  routeTaskCreate,
} from '../task-router.js';

describe('task-router: strategist_decision registration', () => {
  it('is a valid task type', () => {
    expect(VALID_TASK_TYPES).toContain('strategist_decision');
  });

  it('routes to /line-strategist skill', () => {
    expect(SKILL_WHITELIST['strategist_decision']).toBe('/line-strategist');
  });

  it('is located at us', () => {
    expect(LOCATION_MAP['strategist_decision']).toBe('us');
  });

  it('requires has_git', () => {
    expect(TASK_REQUIREMENTS['strategist_decision']).toEqual(['has_git']);
  });

  it('routeTaskCreate resolves full routing for strategist_decision', () => {
    const result = routeTaskCreate({ title: 'line decision', task_type: 'strategist_decision' });
    expect(result.location).toBe('us');
    expect(result.skill).toBe('/line-strategist');
  });
});
