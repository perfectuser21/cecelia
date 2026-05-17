/**
 * format-bytes.js 单元测试
 *
 * 覆盖 formatBytes() 所有分支：
 *   - 零字节
 *   - 各量级（B / KB / MB / GB / TB）
 *   - 小数位数参数
 *   - 负数抛异常
 */

import { describe, it, expect } from 'vitest';
import { formatBytes } from '../format-bytes.js';

describe('formatBytes', () => {
  // FB-1: 零字节
  it('FB-1: 0 字节返回 "0 B"', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  // FB-2: 字节级（< 1024）
  it('FB-2: 512 字节返回 "512 B"', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  // FB-3: KB 级
  it('FB-3: 1024 字节返回 "1 KB"', () => {
    expect(formatBytes(1024)).toBe('1 KB');
  });

  it('FB-4: 1536 字节返回 "1.5 KB"', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  // FB-5: MB 级
  it('FB-5: 1048576 字节返回 "1 MB"', () => {
    expect(formatBytes(1048576)).toBe('1 MB');
  });

  // FB-6: GB 级
  it('FB-6: 1073741824 字节返回 "1 GB"', () => {
    expect(formatBytes(1073741824)).toBe('1 GB');
  });

  // FB-7: TB 级（上限）
  it('FB-7: 1099511627776 字节返回 "1 TB"', () => {
    expect(formatBytes(1099511627776)).toBe('1 TB');
  });

  // FB-8: 自定义小数位数
  it('FB-8: 小数位数为 2', () => {
    expect(formatBytes(1536, 2)).toBe('1.5 KB');
    expect(formatBytes(1600, 2)).toBe('1.56 KB');
  });

  // FB-9: 小数位数为 0
  it('FB-9: 小数位数为 0 时四舍五入', () => {
    expect(formatBytes(1536, 0)).toBe('2 KB');
  });

  // FB-10: 负数抛出 RangeError
  it('FB-10: 负数抛出 RangeError', () => {
    expect(() => formatBytes(-1)).toThrow(RangeError);
    expect(() => formatBytes(-1)).toThrow('bytes must be non-negative');
  });
});
