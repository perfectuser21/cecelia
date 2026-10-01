import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { closePgPool } from './close-pg-pool.js';

describe('关闭 PG 测试连接池', () => {
  it('end 已返回但 socket 尚在退出时，等待全部 remove 后才允许清库', async () => {
    const pool = new EventEmitter();
    pool.totalCount = 2;
    let closed = 0;
    pool.end = async () => {
      setTimeout(() => { closed++; pool.emit('remove', {}); }, 5);
      setTimeout(() => { closed++; pool.emit('remove', {}); }, 15);
    };
    await closePgPool(pool);
    expect(closed).toBe(2);
    expect(pool.listenerCount('remove')).toBe(0);
  });

  it('空连接池直接关闭', async () => {
    const pool = new EventEmitter();
    pool.totalCount = 0;
    let ended = false;
    pool.end = async () => { ended = true; };
    await closePgPool(pool);
    expect(ended).toBe(true);
    expect(pool.listenerCount('remove')).toBe(0);
  });
});
