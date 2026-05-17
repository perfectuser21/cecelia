/**
 * task-router-content-pipeline.test.js
 * Validates content-* task_type registration in Brain routing (6-stage pipeline + content_publish)
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
  'content-copywriting',
  'content-copy-review',
  'content-generate',
  'content-image-review',
  'content-export'
];

describe('content-* task_type registration', () => {
  it('VALID_TASK_TYPES includes all 7 content-* types', () => {
    for (const taskType of CONTENT_TASK_TYPES) {
      expect(VALID_TASK_TYPES).toContain(taskType);
    }
  });

  it('isValidTaskType returns true for all 7 content-* types', () => {
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

  it('SKILL_WHITELIST maps content-copywriting to /content-creator', () => {
    expect(SKILL_WHITELIST['content-copywriting']).toBe('/content-creator');
  });

  it('SKILL_WHITELIST maps content-copy-review to /content-creator', () => {
    expect(SKILL_WHITELIST['content-copy-review']).toBe('/content-creator');
  });

  it('SKILL_WHITELIST maps content-generate to /content-creator', () => {
    expect(SKILL_WHITELIST['content-generate']).toBe('/content-creator');
  });

  it('SKILL_WHITELIST maps content-image-review to /content-creator', () => {
    expect(SKILL_WHITELIST['content-image-review']).toBe('/content-creator');
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
  it('LOCATION_MAP contains all 6 sub-task types mapped to xian', () => {
    const subTypes = ['content-research', 'content-copywriting', 'content-copy-review', 'content-generate', 'content-image-review', 'content-export'];
    for (const taskType of subTypes) {
      expect(LOCATION_MAP[taskType]).toBe('xian');
    }
  });

  it('getTaskLocation returns xian for all 6 sub-task types', () => {
    const subTypes = ['content-research', 'content-copywriting', 'content-copy-review', 'content-generate', 'content-image-review', 'content-export'];
    for (const taskType of subTypes) {
      expect(getTaskLocation(taskType)).toBe('xian');
    }
  });

  it('LOCATION_MAP contains content-pipeline mapped to xian', () => {
    expect(LOCATION_MAP['content-pipeline']).toBe('xian');
  });
});

describe('content_publish task_type registration', () => {
  it('VALID_TASK_TYPES includes content_publish', () => {
    expect(VALID_TASK_TYPES).toContain('content_publish');
  });

  it('isValidTaskType returns true for content_publish', () => {
    expect(isValidTaskType('content_publish')).toBe(true);
  });

  it('LOCATION_MAP routes content_publish to us (publisher skills need browser on US Mac)', () => {
    expect(LOCATION_MAP['content_publish']).toBe('us');
  });

  it('getTaskLocation returns us for content_publish', () => {
    expect(getTaskLocation('content_publish')).toBe('us');
  });
});
