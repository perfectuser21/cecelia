import { describe, it, expect } from 'vitest';
import { buildGoalSettings } from '../executor.js';

describe('buildGoalSettings', () => {
  it('returns null for null condition', () => {
    expect(buildGoalSettings(null)).toBeNull();
  });

  it('returns null for empty string condition', () => {
    expect(buildGoalSettings('')).toBeNull();
  });

  it('returns JSON string with correct Stop hook structure', () => {
    const result = buildGoalSettings('PR has been merged');
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result);
    expect(parsed).toMatchObject({
      hooks: {
        Stop: [{
          hooks: [{
            type: 'prompt',
            prompt: expect.stringContaining('PR has been merged'),
            model: 'claude-haiku-4-5-20251001'
          }]
        }]
      }
    });
  });

  it('embeds goal condition verbatim in prompt field', () => {
    const condition = 'All tests pass and PR is merged to main';
    const result = buildGoalSettings(condition);
    const parsed = JSON.parse(result);
    expect(parsed.hooks.Stop[0].hooks[0].prompt).toContain(condition);
  });
});
