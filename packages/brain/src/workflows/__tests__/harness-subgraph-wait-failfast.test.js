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
  CALLBACK_HARD_TIMEOUT_MS,
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
  it('spawnedAt 超 CALLBACK_TIMEOUT 但容器仍 running → 不误杀，继续等到正常完成', async () => {
    const livenessCheck = vi.fn(async () => null); // docker inspect: running
    const invoke = vi.fn(async () => {});
    let call = 0;
    const compiled = {
      getState: vi.fn(async () => {
        call++;
        if (call === 1) {
          return {
            next: ['await_callback'],
            values: {
              containerId: 'harness-task-ws1-r1-alive-working',
              // 超 CALLBACK_TIMEOUT(100min) 但远未到 hard ceiling(240min)
              spawnedAt: Date.now() - 101 * 60 * 1000,
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
      _killContainer: vi.fn(async () => {}),
      heartbeatPool: { query: async () => ({}) },
    });

    // Line 07 r1 实证：容器活着有 5 个 commit 在干活，旧逻辑 100min 判死。
    // 新逻辑：liveness 确认 running → 不 resume failed，继续 poll 到正常完成。
    expect(invoke).not.toHaveBeenCalled();
    expect(result.status).toBe('merged');
  });

  it('spawnedAt 超 hard ceiling（240min）→ kill 容器 + resume failed(callback_hard_timeout)', async () => {
    const livenessCheck = vi.fn(async () => null); // 容器活着（可能 hang 死循环）
    const killContainer = vi.fn(async () => {});
    const invoke = vi.fn(async () => {});
    let call = 0;
    const compiled = {
      getState: vi.fn(async () => {
        call++;
        if (call === 1) {
          return {
            next: ['await_callback'],
            values: {
              containerId: 'harness-task-ws1-r1-hung',
              spawnedAt: Date.now() - 241 * 60 * 1000, // 超 hard ceiling
              status: 'queued',
            },
          };
        }
        return { next: [], values: { status: 'failed', error: 'callback_hard_timeout' } };
      }),
      invoke,
    };

    const result = await _waitForSubGraphCompletion(compiled, {}, 90 * 60 * 1000, {
      pollIntervalMs: 1,
      livenessCheckEveryN: 1,
      _checkLiveness: livenessCheck,
      _checkPrMerged: async () => false,
      _killContainer: killContainer,
      heartbeatPool: { query: async () => ({}) },
    });

    expect(killContainer).toHaveBeenCalledWith('harness-task-ws1-r1-hung');
    const resumeArg = invoke.mock.calls[0][0];
    expect(resumeArg.resume.status).toBe('failed');
    expect(resumeArg.resume.error).toBe('callback_hard_timeout');
    expect(result.status).toBe('failed');
  });

  it('executor=codex 超 hard ceiling → fail 但不 kill（远程容器本地杀不到）', async () => {
    const killContainer = vi.fn(async () => {});
    const invoke = vi.fn(async () => {});
    let call = 0;
    const compiled = {
      getState: vi.fn(async () => {
        call++;
        if (call === 1) {
          return {
            next: ['await_callback'],
            values: {
              containerId: 'harness-task-ws1-r0-remote',
              spawnedAt: Date.now() - 241 * 60 * 1000,
              executor: 'codex',
              daemonUrl: 'http://100.86.57.69:3458',
              status: 'queued',
            },
          };
        }
        return { next: [], values: { status: 'failed', error: 'callback_hard_timeout' } };
      }),
      invoke,
    };

    const result = await _waitForSubGraphCompletion(compiled, {}, 90 * 60 * 1000, {
      pollIntervalMs: 1,
      livenessCheckEveryN: 1,
      _checkLiveness: vi.fn(async () => null),
      _checkPrMerged: async () => false,
      _killContainer: killContainer,
      heartbeatPool: { query: async () => ({}) },
    });

    expect(killContainer).not.toHaveBeenCalled();
    expect(result.status).toBe('failed');
  });

  it('callback_timeout 但 PR 已 merged → 判 success（不误判 failed）', async () => {
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
              containerId: 'harness-task-ws1-r0-timeout-merged',
              spawnedAt: Date.now() - 101 * 60 * 1000, // 超时
              pr_url: 'https://github.com/perfectuser21/infrastructure/pull/99',
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
      _checkPrMerged: async () => true, // PR 实际已 merged
      heartbeatPool: { query: async () => ({}) },
    });

    // 超时但 PR 已 merged → 不 resume failed，直接判 merged
    expect(invoke).not.toHaveBeenCalled();
    expect(result.status).toBe('merged');
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
  it('默认 > worker-daemon 90min job 预算（不误杀健康 generator）', () => {
    expect(CALLBACK_TIMEOUT_MS).toBeGreaterThan(0);
    // callback 只在 job 跑完才 POST，正常 agentic generator 合法跑 11–89min；
    // 默认必须 > 90min（worker-daemon WORKER_TIMEOUT_MS）否则误杀健康 generator。
    expect(CALLBACK_TIMEOUT_MS).toBeGreaterThan(90 * 60 * 1000);
  });

  it('hard ceiling 默认 240min 且 > CALLBACK_TIMEOUT_MS', () => {
    expect(CALLBACK_HARD_TIMEOUT_MS).toBe(240 * 60 * 1000);
    expect(CALLBACK_HARD_TIMEOUT_MS).toBeGreaterThan(CALLBACK_TIMEOUT_MS);
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

describe('_waitForSubGraphCompletion — 外层 deadline 与 queued 透传', () => {
  it('deadline 到期 + 容器活着且未到 hard ceiling → 延长等待，不返回 queued', async () => {
    const invoke = vi.fn(async () => {});
    let call = 0;
    const compiled = {
      getState: vi.fn(async () => {
        call++;
        if (call <= 2) {
          return {
            next: ['await_callback'],
            values: {
              containerId: 'harness-task-ws1-r0-deadline-alive',
              spawnedAt: Date.now() - 1000, // 刚 spawn，远未到 hard ceiling
              status: 'queued',
            },
          };
        }
        return { next: [], values: { status: 'merged' } };
      }),
      invoke,
    };

    // timeoutMs=1 → 外层 deadline 立即到期；旧逻辑直接返回 status='queued'（Serial gate
    // 报 "did not merge (status=queued)" — 06-08 b249b808 实证）。新逻辑：容器活着 → 延长等待。
    const result = await _waitForSubGraphCompletion(compiled, {}, 1, {
      pollIntervalMs: 1,
      livenessCheckEveryN: 1000, // 关掉周期 liveness 干扰，只测 deadline 路径
      _checkLiveness: vi.fn(async () => null),
      _checkPrMerged: async () => false,
      _killContainer: vi.fn(async () => {}),
      heartbeatPool: { query: async () => ({}) },
    });

    expect(result.status).toBe('merged');
  });

  it('deadline 到期 + 容器已死 → 返回 failed（不再透传 status channel 默认值 queued）', async () => {
    const compiled = {
      getState: vi.fn(async () => ({
        next: ['await_callback'],
        values: {
          containerId: 'harness-task-ws1-r0-deadline-dead',
          spawnedAt: Date.now() - 1000,
          status: 'queued',
        },
      })),
      invoke: vi.fn(async () => {}),
    };

    const result = await _waitForSubGraphCompletion(compiled, {}, 1, {
      pollIntervalMs: 1,
      livenessCheckEveryN: 1000,
      _checkLiveness: vi.fn(async () => 'container_exited_without_callback'),
      _checkPrMerged: async () => false,
      _killContainer: vi.fn(async () => {}),
      heartbeatPool: { query: async () => ({}) },
    });

    expect(result.status).toBe('failed');
  });
});
