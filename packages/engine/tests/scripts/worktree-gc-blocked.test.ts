import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const GC_SCRIPT_PATH = resolve(__dirname, '../../skills/dev/scripts/worktree-gc.sh');

describe('worktree-gc.sh blocked task protection', () => {
  const script = readFileSync(GC_SCRIPT_PATH, 'utf8');

  it('should contain BRAIN_URL variable for Brain API access', () => {
    expect(script).toContain('BRAIN_URL');
  });

  it('should query Brain API for blocked tasks before deletion', () => {
    expect(script).toContain('blocked');
    expect(script).toContain('/api/brain/tasks');
  });

  it('should have curl timeout for Brain API graceful degradation', () => {
    expect(script).toContain('max-time');
  });

  it('should skip worktree when blocked tasks exist', () => {
    expect(script).toContain('BLOCKED_COUNT');
    expect(script).toContain('保护 worktree');
  });

  it('should default BLOCKED_COUNT to 0 when Brain is unavailable', () => {
    // curl failure should fallback to "0" (not block GC)
    expect(script).toContain('|| echo "0"');
  });
});
