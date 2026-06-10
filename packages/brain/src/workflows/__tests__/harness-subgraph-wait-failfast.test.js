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
  CALLBACK_HARD_CEILING_MS,
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

describe('_waitForSubGraphCompletion — Fix #3 callback 总超时兜底（根因1: liveness 感知）', () => {
  it('超 CALLBACK_TIMEOUT 但容器确认 running 且未到 hard ceiling → 不 fail-fast，继续等', async () => {
    // 根因 1：旧逻辑在 spawnedAt 超 CALLBACK_TIMEOUT_MS 时无视容器活性直接 fail-fast，
    // 误杀确认还在跑的健康 generator。新逻辑：容器 running → 继续等到 hard ceiling。
    const livenessCheck = vi.fn(async () => null); // 容器一直 running
    const invoke = vi.fn(async () => {});
    const killFn = vi.fn(async () => {});
    let call = 0;
    const compiled = {
      getState: vi.fn(async () => {
        call++;
        if (call <= 2) {
          return {
            next: ['await_callback'],
            values: {
              containerId: 'harness-task-ws1-r0-alive',
              // spawnedAt 超 CALLBACK_TIMEOUT_MS（101 min ago > 默认 100min）但 < hard ceiling
              spawnedAt: Date.now() - 101 * 60 * 1000,
              status: 'queued',
            },
          };
        }
        // 容器后来正常跑完 callback 到达 → graph 走到 END
        return { next: [], values: { status: 'merged' } };
      }),
      invoke,
    };

    const result = await _waitForSubGraphCompletion(compiled, {}, 90 * 60 * 1000, {
      pollIntervalMs: 1,
      livenessCheckEveryN: 1,
      _checkLiveness: livenessCheck,
      _checkPrMerged: async () => false,
      _killContainer: killFn,
      heartbeatPool: { query: async () => ({}) },
    });

    // 不误杀：没 resume failed、没 docker kill，等到 graph 自然完成
    expect(invoke).not.toHaveBeenCalled();
    expect(killFn).not.toHaveBeenCalled();
    expect(livenessCheck).toHaveBeenCalled();
    expect(result.status).toBe('merged');
  });

  it('超 CALLBACK_TIMEOUT 且容器已死 → 仍 fail-fast（callback_timeout）', async () => {
    const livenessCheck = vi.fn(async () => 'container_exited_without_callback');
    const invoke = vi.fn(async () => {});
    const killFn = vi.fn(async () => {});
    let call = 0;
    const compiled = {
      getState: vi.fn(async () => {
        call++;
        if (call === 1) {
          return {
            next: ['await_callback'],
            values: {
              containerId: 'harness-task-ws1-r0-dead',
              spawnedAt: Date.now() - 101 * 60 * 1000,
              status: 'queued',
            },
          };
        }
        return { next: [], values: { status: 'failed' } };
      }),
      invoke,
    };

    const result = await _waitForSubGraphCompletion(compiled, {}, 90 * 60 * 1000, {
      pollIntervalMs: 1,
      livenessCheckEveryN: 1,
      _checkLiveness: livenessCheck,
      _checkPrMerged: async () => false,
      _killContainer: killFn,
      heartbeatPool: { query: async () => ({}) },
    });

    expect(invoke).toHaveBeenCalled();
    const resumeArg = invoke.mock.calls[0][0];
    expect(resumeArg.resume.status).toBe('failed');
    expect(resumeArg.resume.error).toContain('callback_timeout');
    // 容器已死，无需 kill
    expect(killFn).not.toHaveBeenCalled();
    expect(result.status).toBe('failed');
  });

  it('超 CALLBACK_HARD_CEILING 容器仍 running → docker kill + resume failed callback_hard_ceiling', async () => {
    const livenessCheck = vi.fn(async () => null); // 容器一直 running（僵尸）
    const invoke = vi.fn(async () => {});
    const killFn = vi.fn(async () => {});
    let call = 0;
    const compiled = {
      getState: vi.fn(async () => {
        call++;
        if (call === 1) {
          return {
            next: ['await_callback'],
            values: {
              containerId: 'harness-task-ws1-r0-zombie',
              spawnedAt: Date.now() - (CALLBACK_HARD_CEILING_MS + 60 * 1000),
              status: 'queued',
            },
          };
        }
        return { next: [], values: { status: 'failed', error: 'callback_hard_ceiling' } };
      }),
      invoke,
    };

    const result = await _waitForSubGraphCompletion(compiled, {}, 90 * 60 * 1000, {
      pollIntervalMs: 1,
      livenessCheckEveryN: 1,
      _checkLiveness: livenessCheck,
      _checkPrMerged: async () => false,
      _killContainer: killFn,
      heartbeatPool: { query: async () => ({}) },
    });

    // 放弃前 docker kill，防僵尸容器迟到 callback 污染后续状态
    expect(killFn).toHaveBeenCalledWith('harness-task-ws1-r0-zombie', expect.anything());
    expect(invoke).toHaveBeenCalled();
    const resumeArg = invoke.mock.calls[0][0];
    expect(resumeArg.resume.status).toBe('failed');
    expect(resumeArg.resume.error).toBe('callback_hard_ceiling');
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

describe('_waitForSubGraphCompletion — 外层 deadline liveness 感知（queued 透传修复）', () => {
  // 实证（06-08 b249b808）：外层 90min deadline 到期直接返回 status channel 默认值
  // 'queued' → Serial gate 报 "did not merge (status=queued)"。且 deadline < soft
  // timeout（100min from spawnedAt），#3330 的内层 liveness 感知在首轮驱动中根本
  // 轮不到——活 generator 仍被外层 90min 砍头、不 kill、留孤儿容器。

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

    // timeoutMs=1 → 外层 deadline 立即到期；旧逻辑直接返回 status='queued'
    const result = await _waitForSubGraphCompletion(compiled, {}, 1, {
      pollIntervalMs: 1,
      livenessCheckEveryN: 1000, // 关掉周期 liveness 干扰，只测 deadline 路径
      _checkLiveness: vi.fn(async () => null),
      _checkPrMerged: async () => false,
      _killContainer: vi.fn(async () => {}),
      heartbeatPool: { query: async () => ({}) },
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(result.status).toBe('merged');
  });

  it('deadline 到期 + 容器已死 → 返回 failed（不透传 status channel 默认值 queued）', async () => {
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

  it('deadline 到期 + 容器活着但超 hard ceiling → kill + resume failed(callback_hard_ceiling)', async () => {
    const killContainer = vi.fn(async () => {});
    let resumed = false;
    const invoke = vi.fn(async () => { resumed = true; });
    const compiled = {
      getState: vi.fn(async () => {
        if (!resumed) {
          return {
            next: ['await_callback'],
            values: {
              containerId: 'harness-task-ws1-r0-deadline-overhard',
              spawnedAt: Date.now() - CALLBACK_HARD_CEILING_MS - 60 * 1000,
              status: 'queued',
            },
          };
        }
        return { next: [], values: { status: 'failed', error: 'callback_hard_ceiling' } };
      }),
      invoke,
    };

    const result = await _waitForSubGraphCompletion(compiled, {}, 1, {
      pollIntervalMs: 1,
      livenessCheckEveryN: 1000,
      _checkLiveness: vi.fn(async () => null),
      _checkPrMerged: async () => false,
      _killContainer: killContainer,
      heartbeatPool: { query: async () => ({}) },
    });

    expect(killContainer).toHaveBeenCalled();
    expect(killContainer.mock.calls[0][0]).toBe('harness-task-ws1-r0-deadline-overhard');
    const resumeArg = invoke.mock.calls[0][0];
    expect(resumeArg.resume.status).toBe('failed');
    expect(resumeArg.resume.error).toBe('callback_hard_ceiling');
    expect(result.status).toBe('failed');
  });
});

describe('CALLBACK_TIMEOUT_MS / CALLBACK_HARD_CEILING_MS 常量', () => {
  it('默认 > worker-daemon 90min job 预算（不误杀健康 generator）', () => {
    expect(CALLBACK_TIMEOUT_MS).toBeGreaterThan(0);
    // callback 只在 job 跑完才 POST，正常 agentic generator 合法跑 11–89min；
    // 默认必须 > 90min（worker-daemon WORKER_TIMEOUT_MS）否则误杀健康 generator。
    expect(CALLBACK_TIMEOUT_MS).toBeGreaterThan(90 * 60 * 1000);
  });

  it('hard ceiling 必须显著大于 soft timeout（liveness 感知等待有意义的空间）', () => {
    expect(CALLBACK_HARD_CEILING_MS).toBeGreaterThan(CALLBACK_TIMEOUT_MS);
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
