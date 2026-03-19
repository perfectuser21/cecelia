/**
 * task-router-content-pipeline.test.js
 * Validates content-* task_type registration in Brain routing
 */

import { describe, it, expect } from 'vitest';
import {
  VALID_TASK_TYPES,
  SKILL_WHITELIST,
  LOCATION_MAP,
  isValidTaskType,
  getTaskLocation
} from '../task-router.js';

const CONTENT_TASK_TYPES = [
  'content-pipeline',
  'content-research',
  'content-generate',
  'content-review',
  'content-export'
];

describe('content-* task_type registration', () => {
  it('VALID_TASK_TYPES includes all 5 content-* types', () => {
    for (const taskType of CONTENT_TASK_TYPES) {
      expect(VALID_TASK_TYPES).toContain(taskType);
    }
  });

  it('isValidTaskType returns true for all 5 content-* types', () => {
    for (const taskType of CONTENT_TASK_TYPES) {
      expect(isValidTaskType(taskType)).toBe(true);
    }
  });

  it('SKILL_WHITELIST maps content-pipeline to /content-creator', () => {
    expect(SKILL_WHITELIST['content-pipeline']).toBe('/content-creator');
  });

  it('SKILL_WHITELIST maps content-research to /notebooklm', () => {
    expect(SKILL_WHITELIST['content-research']).toBe('/notebooklm');
  });

  it('SKILL_WHITELIST maps content-generate to /content-creator', () => {
    expect(SKILL_WHITELIST['content-generate']).toBe('/content-creator');
  });

  it('SKILL_WHITELIST maps content-review to /content-creator', () => {
    expect(SKILL_WHITELIST['content-review']).toBe('/content-creator');
  });

  it('SKILL_WHITELIST maps content-export to /content-creator', () => {
    expect(SKILL_WHITELIST['content-export']).toBe('/content-creator');
  });

  it('isValidTaskType rejects unknown content types', () => {
    expect(isValidTaskType('content-unknown')).toBe(false);
    expect(isValidTaskType('content-')).toBe(false);
  });
});

describe('content-* LOCATION_MAP routing', () => {
  it('LOCATION_MAP contains all 4 sub-task types mapped to us', () => {
    const subTypes = ['content-research', 'content-generate', 'content-review', 'content-export'];
    for (const taskType of subTypes) {
      expect(LOCATION_MAP[taskType]).toBe('us');
    }
  });

  it('getTaskLocation returns us for all 4 sub-task types', () => {
    const subTypes = ['content-research', 'content-generate', 'content-review', 'content-export'];
    for (const taskType of subTypes) {
      expect(getTaskLocation(taskType)).toBe('us');
    }
  });

  it('LOCATION_MAP contains content-pipeline mapped to us', () => {
    expect(LOCATION_MAP['content-pipeline']).toBe('us');
  });
});
