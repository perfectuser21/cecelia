import { describe, it, expect, vi } from 'vitest';
import { createOrchestratorBridge } from '../orchestrator-remote-bridge.js';

const ENV = { KERNEL_FLEET_BRIDGE_TOKEN: 't0k3n', FLEET_WORKER_US_MAC_M4_URL: 'http://worker:5231' };
const RUN_ID = '33333333-3333-4333-8333-333333333333';

function fetchOk(body) {
  return vi.fn(async () => ({ ok: true, status: 202, json: async () => body }));
}

describe('orchestrator-remote-bridge', () => {
  it('prepare 打 primary 的 /harness/orchestrators/prepare，带 Bearer', async () => {
    const fetchFn = fetchOk({ orchestrator_id: RUN_ID, status: 'prepared', worktree_path: '/ws/x' });
    const bridge = createOrchestratorBridge({ env: ENV, fetchFn });
    const r = await bridge.prepare({ run_id: RUN_ID, task_id: RUN_ID, repo: 'perfectuser21/cecelia' });
    expect(r.worktree_path).toBe('/ws/x');
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('http://worker:5231/harness/orchestrators/prepare');
    expect(init.headers.Authorization).toBe('Bearer t0k3n');
  });

  it('非 2xx → orchestrator_bridge_prepare_http_<code>（禁静默）', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({ error: 'orchestrator_slots_exhausted' }) }));
    const bridge = createOrchestratorBridge({ env: ENV, fetchFn });
    await expect(bridge.prepare({ run_id: RUN_ID, task_id: RUN_ID }))
      .rejects.toThrow('orchestrator_bridge_prepare_http_429:orchestrator_slots_exhausted');
  });

  it('2xx 但 response.json() 解析失败 → 不静默 null，抛 invalid_json', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 202,
      json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
    }));
    const bridge = createOrchestratorBridge({ env: ENV, fetchFn });
    await expect(bridge.prepare({ run_id: RUN_ID, task_id: RUN_ID }))
      .rejects.toThrow('orchestrator_bridge_prepare_invalid_json');
  });

  // 2026-09-24 实证（任务 f61fc0c6）：MMV 建工作区（git clone --bare --no-hardlinks 整库拷贝 + npm ci，
  // 两条 run 并发）实测 7 分钟，编排桥 prepare 超时 180s 硬编码无 env 覆盖 → Brain 放弃后作业
  // prepared 占槽 10 分钟，期间所有派发 429 空转。prepare 预算必须可配且默认覆盖真实耗时。
  describe('prepare 超时预算', () => {
    it('默认 prepare 超时 600s（覆盖 MMV 实测 7 分钟建工作区）', () => {
      const bridge = createOrchestratorBridge({ env: ENV, fetchFn: fetchOk({}) });
      expect(bridge.prepareTimeoutMs).toBe(600_000);
    });

    it('KERNEL_FLEET_ORCHESTRATOR_PREPARE_TIMEOUT_MS 可覆盖默认值', () => {
      const bridge = createOrchestratorBridge({
        env: { ...ENV, KERNEL_FLEET_ORCHESTRATOR_PREPARE_TIMEOUT_MS: '900000' },
        fetchFn: fetchOk({}),
      });
      expect(bridge.prepareTimeoutMs).toBe(900_000);
    });

    it('显式 prepareTimeoutMs 选项优先于 env', () => {
      const bridge = createOrchestratorBridge({
        env: { ...ENV, KERNEL_FLEET_ORCHESTRATOR_PREPARE_TIMEOUT_MS: '900000' },
        fetchFn: fetchOk({}),
        prepareTimeoutMs: 42_000,
      });
      expect(bridge.prepareTimeoutMs).toBe(42_000);
    });

    it('env 非法（非数字/≤0）→ 回落默认 600s，不把桥配坏', () => {
      for (const bad of ['abc', '0', '-5', '']) {
        const bridge = createOrchestratorBridge({
          env: { ...ENV, KERNEL_FLEET_ORCHESTRATOR_PREPARE_TIMEOUT_MS: bad },
          fetchFn: fetchOk({}),
        });
        expect(bridge.prepareTimeoutMs, `env=${JSON.stringify(bad)}`).toBe(600_000);
      }
    });
  });

  it('token 缺失 fail-closed', () => {
    expect(() => createOrchestratorBridge({ env: { FLEET_WORKER_US_MAC_M4_URL: 'http://w' } }))
      .toThrow('orchestrator_bridge_token_missing');
  });

  it('targetMachineId = primary（角色解析，禁字面量）', () => {
    const bridge = createOrchestratorBridge({ env: ENV, fetchFn: fetchOk({}) });
    expect(bridge.targetMachineId).toBe('us-mac-m4'); // 今天的取值；Mac Studio 后随清单变
  });
});
