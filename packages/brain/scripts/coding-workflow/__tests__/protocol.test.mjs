import { describe, it, expect } from 'vitest';
import { resolveSprintDir } from '../lib/protocol.mjs';

describe('resolveSprintDir', () => {
  it('相对路径拼到 worktree 下', () => {
    expect(resolveSprintDir('/w', 'sprints/a')).toBe('/w/sprints/a');
  });

  it.each(['../x', '/abs', 'a/../../b'])('非法 sprintDir %s 抛 sprint_dir_invalid', (bad) => {
    expect(() => resolveSprintDir('/w', bad)).toThrow('sprint_dir_invalid');
  });
});
