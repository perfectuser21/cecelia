import { describe, it, expect } from 'vitest';
import { isValidLocation } from '../packages/brain/src/task-router.js';

describe('xian_m1 路由节点：isValidLocation', () => {
  it('isValidLocation(xian_m1) 返回 true（西安M1 被路由系统认可）', () => {
    expect(isValidLocation('xian_m1')).toBe(true);
  });

  it('isValidLocation(XIAN_M1) 大小写不敏感也返回 true', () => {
    expect(isValidLocation('XIAN_M1')).toBe(true);
  });
});
