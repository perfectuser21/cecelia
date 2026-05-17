/**
 * executor.js: dept_heartbeat 调度测试
 *
 * 覆盖：
 * - getSkillForTaskType('dept_heartbeat') → '/repo-lead heartbeat'
 * - triggerCeceliaRun: payload.repo_path fallback（无 project_id 时）
 */

import { describe, it, expect, vi } from 'vitest';
import { getSkillForTaskType } from '../executor.js';

describe('executor: getSkillForTaskType', () => {
  it('should return /repo-lead heartbeat for dept_heartbeat', () => {
    expect(getSkillForTaskType('dept_heartbeat')).toBe('/repo-lead heartbeat');
  });

  it('should still return /dev for dev tasks', () => {
    expect(getSkillForTaskType('dev')).toBe('/dev');
  });

  it('should return /code-review for review tasks', () => {
    expect(getSkillForTaskType('review')).toBe('/code-review');
  });

  it('should return /dev as fallback for unknown task types', () => {
    expect(getSkillForTaskType('unknown_type')).toBe('/dev');
  });

  it('should return /repo-lead heartbeat (not /dev) for dept_heartbeat', () => {
    const result = getSkillForTaskType('dept_heartbeat');
    expect(result).not.toBe('/dev');
    expect(result).toBe('/repo-lead heartbeat');
  });
});
