/**
 * task-router-code-review.test.js
 * Validates code_review task type routing
 */

import { describe, it, expect } from 'vitest';
import { isValidTaskType, LOCATION_MAP, getTaskLocation } from '../task-router.js';

describe('code_review task type routing', () => {
  it('isValidTaskType 包含 code_review', () => {
    expect(isValidTaskType('code_review')).toBe(true);
  });

  it('LOCATION_MAP 中 code_review → us', () => {
    expect(LOCATION_MAP['code_review']).toBe('us');
  });

  it('getTaskLocation 路由 code_review 到 us', () => {
    const task = { task_type: 'code_review' };
    const result = getTaskLocation(task);
    expect(result).toBe('us');
  });

  it('code_review 大小写不敏感（isValidTaskType）', () => {
    expect(isValidTaskType('CODE_REVIEW')).toBe(true);
  });
});
