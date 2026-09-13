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

  it('token 缺失 fail-closed', () => {
    expect(() => createOrchestratorBridge({ env: { FLEET_WORKER_US_MAC_M4_URL: 'http://w' } }))
      .toThrow('orchestrator_bridge_token_missing');
  });

  it('targetMachineId = primary（角色解析，禁字面量）', () => {
    const bridge = createOrchestratorBridge({ env: ENV, fetchFn: fetchOk({}) });
    expect(bridge.targetMachineId).toBe('us-mac-m4'); // 今天的取值；Mac Studio 后随清单变
  });
});
