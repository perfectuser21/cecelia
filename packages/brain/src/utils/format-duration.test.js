import { describe, it, expect } from 'vitest';
import { formatDuration } from './format-duration.js';

describe('formatDuration', () => {
  it('毫秒级', () => expect(formatDuration(500)).toBe('500ms'));
  it('秒级', () => expect(formatDuration(2500)).toBe('2.5s'));
  it('分钟级（有秒）', () => expect(formatDuration(90000)).toBe('1m30s'));
  it('分钟级（整分）', () => expect(formatDuration(120000)).toBe('2m'));
});
