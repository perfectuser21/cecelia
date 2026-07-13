import { describe, it, expect } from 'vitest';
import {
  VALID_TASK_TYPES,
  SKILL_WHITELIST,
  LOCATION_MAP,
  TASK_REQUIREMENTS,
  routeTaskCreate,
} from '../task-router.js';
import * as executor from '../executor.js';
import { JOBS } from '../scheduler-jobs.js';

describe('task-router: ci_patrol registration', () => {
  it('is a valid task type', () => {
    expect(VALID_TASK_TYPES).toContain('ci_patrol');
  });

  it('routes to /ci-patrol skill', () => {
    expect(SKILL_WHITELIST['ci_patrol']).toBe('/ci-patrol');
  });

  it('is located at us', () => {
    expect(LOCATION_MAP['ci_patrol']).toBe('us');
  });

  it('requires has_git', () => {
    expect(TASK_REQUIREMENTS['ci_patrol']).toEqual(['has_git']);
  });

  it('routeTaskCreate resolves full routing for ci_patrol', () => {
    const result = routeTaskCreate({ title: 'CI 巡检', task_type: 'ci_patrol' });
    expect(result.location).toBe('us');
    expect(result.skill).toBe('/ci-patrol');
  });
});

describe('executor: ci_patrol skill 映射（防 strategist_decision 式降级 /dev）', () => {
  it('getSkillForTaskType 返回 /ci-patrol', () => {
    expect(executor.getSkillForTaskType('ci_patrol', {})).toBe('/ci-patrol');
  });
});

describe('scheduler-jobs: ci-patrol 已注册', () => {
  it('JOBS 含 ci-patrol 且 needsPool', () => {
    const job = JOBS.find((j) => j.name === 'ci-patrol');
    expect(job).toBeDefined();
    expect(job.needsPool).toBe(true);
  });
});
