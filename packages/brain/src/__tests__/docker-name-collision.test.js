/**
 * 回归：容器名按 taskId 固定，GAN 同 task 多轮复用同名 + --rm 异步删除 →
 * 下一轮 spawn 撞 "container name already in use"（exit 125）→ proposer 没启动没 push。
 * 修复：跑前 removeStaleContainer 强制 docker rm -f {name} 清残留。
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { removeStaleContainer } from '../docker-executor.js';

function fakeProc(emitErr = false) {
  const ee = new EventEmitter();
  setImmediate(() => emitErr ? ee.emit('error', new Error('spawn fail')) : ee.emit('close', 0));
  return ee;
}

describe('removeStaleContainer — 容器名冲突清理', () => {
  it('用 docker rm -f {name} 清同名残留容器', async () => {
    const calls = [];
    const spawnFn = vi.fn((bin, args) => { calls.push([bin, ...args]); return fakeProc(); });
    await removeStaleContainer('cecelia-task-abc123', spawnFn);
    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(calls[0]).toEqual(['docker', 'rm', '-f', 'cecelia-task-abc123']);
  });

  it('容器不存在/rm 失败也 resolve（幂等不抛错，不阻塞 spawn）', async () => {
    const spawnFn = vi.fn(() => fakeProc(true)); // emit 'error'
    await expect(removeStaleContainer('x', spawnFn)).resolves.toBeUndefined();
  });

  it('spawn 直接 throw 也兜住（最坏退回原冲突，由 #3229 中止兜底）', async () => {
    const spawnFn = vi.fn(() => { throw new Error('boom'); });
    await expect(removeStaleContainer('x', spawnFn)).resolves.toBeUndefined();
  });
});
