/**
 * Fix #2 / #3 / #4 回归测试 — _waitForSubGraphCompletion 防永挂兜底。
 *
 * Fix #2: await_callback 时 state 无 containerId（spawn 阶段出错未捕获）→ 第一次
 *         liveness 周期即 resume failed，不无脑 poll 到 90min。
 * Fix #3: await_callback 独立总超时（CALLBACK_TIMEOUT_MS）：containerId 存在、容器
 *         看似活着、但 callback 永不来 → 提前 fail，不等 90min。
 * Fix #4: _checkContainerLiveness 支持远程 worker-daemon /health（西安 Codex 容器）：
 *         daemon 不可达 → 判死；可达 → 保守 null（活着）。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  _waitForSubGraphCompletion,
  _checkContainerLiveness,
  CALLBACK_TIMEOUT_MS,
} from '../harness-initiative.graph.js';

describe('_waitForSubGraphCompletion — Fix #2 containerId 缺失 fail-fast', () => {
  it('await_callback 但 state 无 containerId → 第一周期 resume failed，不等 timeout', async () => {
    const invoke = vi.fn(async () => {});
    let call = 0;
    const compiled = {
      getState: vi.fn(async () => {
        call++;
        if (call === 1) {
          // spawn 阶段出错未捕获：停在 await_callback 但无 containerId
          return { next: ['await_callback'], values: { status: 'queued' } };
        }
        return { next: [], values: { status: 'failed', error: 'spawn_missing_containerid' } };
      }),
      invoke,
    };

    const result = await _waitForSubGraphCompletion(compiled, {}, 90 * 60 * 1000, {
      pollIntervalMs: 1,
      livenessCheckEveryN: 1,
      heartbeatPool: { query: async () => ({}) },
    });

    expect(invoke).toHaveBeenCalled();
    const resumeArg = invoke.mock.calls[0][0];
    expect(resumeArg.resume.status).toBe('failed');
    expect(result.status).toBe('failed');
  });
});

describe('_waitForSubGraphCompletion — Fix #3 callback 总超时兜底', () => {
  it('containerId 存在 + 容器活着但 callback 永不来 → callback_timeout 提前 fail', async () => {
    const livenessCheck = vi.fn(async () => null); // 容器一直活着
    const invoke = vi.fn(async () => {});
    let call = 0;
    const compiled = {
      getState: vi.fn(async () => {
        call++;
        if (call === 1) {
          return {
            next: ['await_callback'],
            values: {
              containerId: 'harness-task-ws1-r0-alive',
              // spawnedAt 远超 CALLBACK_TIMEOUT_MS（11 min ago）
              spawnedAt: Date.now() - 11 * 60 * 1000,
              status: 'queued',
            },
          };
        }
        return { next: [], values: { status: 'failed', error: 'callback_timeout' } };
      }),
      invoke,
    };

    const result = await _waitForSubGraphCompletion(compiled, {}, 90 * 60 * 1000, {
      pollIntervalMs: 1,
      livenessCheckEveryN: 1,
      _checkLiveness: livenessCheck,
      _checkPrMerged: async () => false,
      heartbeatPool: { query: async () => ({}) },
    });

    expect(invoke).toHaveBeenCalled();
    const resumeArg = invoke.mock.calls[0][0];
    expect(resumeArg.resume.status).toBe('failed');
    expect(resumeArg.resume.error).toBe('callback_timeout');
    expect(result.status).toBe('failed');
  });

  it('spawnedAt 未超时 + 容器活着 → 不触发 callback_timeout，继续 poll', async () => {
    const livenessCheck = vi.fn(async () => null);
    const invoke = vi.fn(async () => {});
    let call = 0;
    const compiled = {
      getState: vi.fn(async () => {
        call++;
        if (call === 1) {
          return {
            next: ['await_callback'],
            values: {
              containerId: 'harness-task-ws1-r0-fresh',
              spawnedAt: Date.now() - 1000, // 1s ago，远未超时
              status: 'queued',
            },
          };
        }
        return { next: [], values: { status: 'merged' } };
      }),
      invoke,
    };

    const result = await _waitForSubGraphCompletion(compiled, {}, 90 * 60 * 1000, {
      pollIntervalMs: 1,
      livenessCheckEveryN: 1,
      _checkLiveness: livenessCheck,
      _checkPrMerged: async () => false,
      heartbeatPool: { query: async () => ({}) },
    });

    // 未触发 callback_timeout resume；走完正常路径
    expect(result.status).toBe('merged');
  });
});

describe('CALLBACK_TIMEOUT_MS 常量', () => {
  it('默认 10 分钟，且远小于 90min 全局超时', () => {
    expect(CALLBACK_TIMEOUT_MS).toBeGreaterThan(0);
    expect(CALLBACK_TIMEOUT_MS).toBeLessThan(90 * 60 * 1000);
  });
});

describe('_checkContainerLiveness — Fix #4 远程 worker-daemon /health', () => {
  it('executor=codex + daemonUrl + fetch reject → daemon_unreachable（判死）', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const reason = await _checkContainerLiveness('harness-task-ws1-r0-remote', {
      executor: 'codex',
      daemonUrl: 'http://100.86.57.69:3458',
      fetchImpl: fetchMock,
    });
    expect(reason).toContain('daemon_unreachable');
  });

  it('executor=codex + daemonUrl + fetch 200 → null（保守当活着）', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    const reason = await _checkContainerLiveness('harness-task-ws1-r0-remote', {
      executor: 'codex',
      daemonUrl: 'http://100.86.57.69:3458',
      fetchImpl: fetchMock,
    });
    expect(reason).toBeNull();
  });

  it('executor=codex + daemonUrl + fetch 非 200 → daemon_unreachable', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 503 }));
    const reason = await _checkContainerLiveness('harness-task-ws1-r0-remote', {
      executor: 'codex',
      daemonUrl: 'http://100.86.57.69:3458',
      fetchImpl: fetchMock,
    });
    expect(reason).toContain('daemon_unreachable');
  });

  it('executor 缺省（claude 本地）→ 仍走 docker inspect（execFile mock）', async () => {
    const execFileMock = vi.fn((cmd, args, cb) => {
      // 模拟容器 exited
      cb(null, 'exited');
    });
    const reason = await _checkContainerLiveness('harness-task-ws1-r0-local', {
      execFileImpl: execFileMock,
    });
    expect(execFileMock).toHaveBeenCalled();
    expect(reason).toContain('container_exited_without_callback');
  });

  it('executor=claude 本地 running → null', async () => {
    const execFileMock = vi.fn((cmd, args, cb) => cb(null, 'running'));
    const reason = await _checkContainerLiveness('harness-task-ws1-r0-local', {
      execFileImpl: execFileMock,
    });
    expect(reason).toBeNull();
  });
});
