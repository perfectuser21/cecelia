/** 旧provider relay的拒绝与零副作用矩阵统一保留在 harness-skill-relay-routing.test.js。 */
import {describe,it,expect} from 'vitest';
import {detectQuotaWall} from '../../../packages/brain/src/harness-skill-relay.js';
describe('[BEHAVIOR-5] detectQuotaWall — 全 6 个 pattern 覆盖', () => {
  it('detectQuotaWall 是导出的函数', () => {
    expect(typeof detectQuotaWall).toBe('function');
  });

  it('"out of credits" → true', () => {
    expect(detectQuotaWall('Error: out of credits')).toBe(true);
  });

  it('"rate limit" → true', () => {
    expect(detectQuotaWall('rate limit exceeded')).toBe(true);
  });

  it('"429" → true', () => {
    expect(detectQuotaWall('HTTP 429 Too Many Requests')).toBe(true);
  });

  it('"quota exceeded" → true', () => {
    expect(detectQuotaWall('quota exceeded for account')).toBe(true);
  });

  it('"quota reached" → true', () => {
    expect(detectQuotaWall('Your quota reached the limit')).toBe(true);
  });

  it('"usage limit" → true', () => {
    expect(detectQuotaWall('usage limit reached')).toBe(true);
  });

  it('正常输出 → false', () => {
    expect(detectQuotaWall('task completed successfully')).toBe(false);
    expect(detectQuotaWall('')).toBe(false);
    expect(detectQuotaWall('some normal error')).toBe(false);
  });

  it('大小写不敏感', () => {
    expect(detectQuotaWall('OUT OF CREDITS')).toBe(true);
    expect(detectQuotaWall('Rate Limit Exceeded')).toBe(true);
  });
});

