/**
 * pollForReply 轮询逻辑纯函数单测
 *
 * [BEHAVIOR] B-D2-05 — fetchMessages 返回含 assistant 消息时，轮询停止，timedOut=false
 * [BEHAVIOR] B-D2-06 — 超过 maxAttempts 时，轮询停止，timedOut=true
 *
 * 被测函数位于：apps/dashboard/src/pages/warroom/WarRoomLineCommandPage.tsx
 * （需导出 pollForReply）
 *
 * 函数签名预期：
 *   pollForReply(
 *     fetchMessages: () => Promise<ConvMessage[]>,
 *     initialCount: number,
 *     maxAttempts?: number,
 *     intervalMs?: number
 *   ): Promise<{ stopped: boolean; timedOut: boolean }>
 */

import { describe, it, expect, vi } from 'vitest';
import { pollForReply } from '../../../apps/dashboard/src/pages/warroom/WarRoomLineCommandPage';

vi.useFakeTimers();

describe('pollForReply', () => {
  it('[B-D2-05] 检测到新 assistant 消息时返回 { stopped: true, timedOut: false }', async () => {
    let callCount = 0;
    const fetchMessages = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount >= 2) {
        return [
          { id: '1', role: 'user', content: 'hello', turn_marker: null, created_at: '' },
          { id: '2', role: 'assistant', content: '好的', turn_marker: null, created_at: '' },
        ];
      }
      return [
        { id: '1', role: 'user', content: 'hello', turn_marker: null, created_at: '' },
      ];
    });

    const promise = pollForReply(fetchMessages, 1, 20, 1500);
    // 推进定时器两次
    await vi.advanceTimersByTimeAsync(3000);
    const result = await promise;

    expect(result.stopped).toBe(true);
    expect(result.timedOut).toBe(false);
  });

  it('[B-D2-06] 超过 maxAttempts 时返回 { stopped: true, timedOut: true }', async () => {
    const fetchMessages = vi.fn().mockResolvedValue([
      { id: '1', role: 'user', content: 'hello', turn_marker: null, created_at: '' },
    ]);

    const promise = pollForReply(fetchMessages, 1, 3, 100);
    await vi.advanceTimersByTimeAsync(400);
    const result = await promise;

    expect(result.stopped).toBe(true);
    expect(result.timedOut).toBe(true);
    expect(fetchMessages).toHaveBeenCalledTimes(3);
  });

  it('[B-D2-05] 首次 fetch 就有 assistant 消息时立即停止（不等第二次）', async () => {
    const fetchMessages = vi.fn().mockResolvedValue([
      { id: '1', role: 'user', content: 'hi', turn_marker: null, created_at: '' },
      { id: '2', role: 'assistant', content: '好', turn_marker: null, created_at: '' },
    ]);

    // initialCount=1，已有 1 条消息；新 assistant 消息数量 > 0 → 即停
    const promise = pollForReply(fetchMessages, 1, 20, 1500);
    await vi.advanceTimersByTimeAsync(1500);
    const result = await promise;

    expect(result.timedOut).toBe(false);
    expect(fetchMessages).toHaveBeenCalledTimes(1);
  });
});
