import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as watchdog from '../watchdog.js';

describe('退役 Claude 交互会话空闲守护', () => {
  it('不再暴露扫描或清理交互会话的接口，保留任务资源守护', () => {
    expect(watchdog.scanInteractiveClaude).toBeUndefined();
    expect(watchdog.checkIdleSessions).toBeUndefined();
    expect(typeof watchdog.checkRunaways).toBe('function');
    expect(typeof watchdog.resolveTaskPids).toBe('function');
  });

  it('旧回滚 tick 不再尝试终止交互会话', () => {
    const tick = readFileSync(new URL('../tick-runner.js', import.meta.url), 'utf8');
    expect(tick).not.toContain('checkIdleSessions');
    expect(tick).not.toContain('idle_session_kill');
  });
});
