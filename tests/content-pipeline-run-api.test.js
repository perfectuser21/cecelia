import { describe, it, expect } from 'vitest';
import { LOCATION_MAP } from '../packages/brain/src/task-router.js';

describe('content-pipeline 路由到 xian', () => {
  it('content-pipeline 路由到 xian', () => {
    expect(LOCATION_MAP['content-pipeline']).toBe('xian');
  });
  it('content-research 路由到 xian', () => {
    expect(LOCATION_MAP['content-research']).toBe('xian');
  });
  it('content-export 路由到 xian', () => {
    expect(LOCATION_MAP['content-export']).toBe('xian');
  });
});
