import { describe, it, expect } from 'vitest';
import { executeOnHost } from '../host-executor.js';

// 原 task.id/prompt 参数校验用例已随 Claude 通道退役删除（任务 76a160b3）：executeOnHost 唯一用途是拉起 claude，现一律拒绝。
describe('host-executor', () => {
  it('exports executeOnHost function', () => {
    expect(typeof executeOnHost).toBe('function');
  });

  it('任何入参一律抛 claude_channel_retired（含缺 task.id / prompt 非字符串）', async () => {
    await expect(executeOnHost({ task: {}, prompt: 'test' })).rejects.toMatchObject({ code: 'claude_channel_retired' });
    await expect(executeOnHost({ task: { id: 'tid' }, prompt: null })).rejects.toMatchObject({ code: 'claude_channel_retired' });
    await expect(executeOnHost({ task: { id: 'tid' }, prompt: 'p', env: { CECELIA_EXECUTOR: 'codex' } })).rejects.toMatchObject({ code: 'claude_channel_retired' });
  });
});
