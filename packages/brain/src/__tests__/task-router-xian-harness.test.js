/**
 * [RED] task-router xian harness 动态 location 覆盖测试
 * BEHAVIOR-1：getTaskLocation 支持对象入参，task.location 优先于静态 LOCATION_MAP
 * TASK_ID: 7750cd32-d73b-4a53-91cf-8fd171bf358b
 */
import { describe, it, expect } from 'vitest';
import { getTaskLocation } from '../task-router.js';

describe('getTaskLocation xian harness override', () => {
  it('task.location=xian + task_type=harness_initiative → returns xian', () => {
    // BEHAVIOR-1: 对象入参，location 非 null → 优先返回 task.location
    const task = { task_type: 'harness_initiative', location: 'xian' };
    expect(getTaskLocation(task)).toBe('xian');  // 当前 failing：返回 'us'
  });

  it('task.location=null → 回退静态映射 → us', () => {
    // BEHAVIOR-1 向后兼容：location 为 null 时走静态 LOCATION_MAP
    const task = { task_type: 'harness_initiative', location: null };
    expect(getTaskLocation(task)).toBe('us');
  });

  it('string 签名零回归 → harness_initiative 仍返回 us', () => {
    // BEHAVIOR-1 向后兼容：字符串调用签名不变
    expect(getTaskLocation('harness_initiative')).toBe('us');
  });
});
