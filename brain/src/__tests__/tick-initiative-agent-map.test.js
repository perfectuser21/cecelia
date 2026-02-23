/**
 * Tick - Initiative TASK_TYPE_AGENT_MAP 测试
 *
 * DoD 覆盖: D3
 */

import { describe, it, expect } from 'vitest';
import { TASK_TYPE_AGENT_MAP } from '../tick.js';

describe('TASK_TYPE_AGENT_MAP initiative types', () => {
  it('D3: initiative_plan maps to null', () => {
    expect(TASK_TYPE_AGENT_MAP['initiative_plan']).toBeNull();
  });

  it('D3: initiative_verify maps to null', () => {
    expect(TASK_TYPE_AGENT_MAP['initiative_verify']).toBeNull();
  });

  it('existing mappings unchanged', () => {
    expect(TASK_TYPE_AGENT_MAP['dev']).toBe('/dev');
    expect(TASK_TYPE_AGENT_MAP['talk']).toBe('/talk');
    expect(TASK_TYPE_AGENT_MAP['research']).toBeNull();
  });
});
