/**
 * Brain → primary worker 的 orchestrator 启动桥（决策 2e756506 方案B）。
 * 不复用 remote-bridge-transport（那是 attempt 形状：租约/回执/凭据信封耦合），
 * orchestrator 只需 prepare/start/inspect 三个薄调用。
 */
import { resolvePrimaryWorkerId, workerBridgeUrlFor } from './machine-registry.js';

const DEFAULT_PREPARE_TIMEOUT_MS = 180_000; // 首次要 clone + npm install
const DEFAULT_START_TIMEOUT_MS = 30_000;

export function createOrchestratorBridge({
  env = process.env,
  fetchFn = globalThis.fetch,
  prepareTimeoutMs = DEFAULT_PREPARE_TIMEOUT_MS,
  startTimeoutMs = DEFAULT_START_TIMEOUT_MS,
} = {}) {
  const targetMachineId = resolvePrimaryWorkerId();
  const baseUrl = workerBridgeUrlFor(targetMachineId, env);
  const token = env.KERNEL_FLEET_BRIDGE_TOKEN;
  if (!baseUrl) throw new Error('orchestrator_bridge_url_missing');
  if (!token) throw new Error('orchestrator_bridge_token_missing');

  async function post(pathname, body, op, timeoutMs) {
    let response;
    try {
      response = await fetchFn(`${baseUrl}${pathname}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new Error(`orchestrator_bridge_${op}_request_failed:${error?.message ?? 'unknown'}`);
    }
    let payload = null;
    try { payload = await response.json(); } catch { /* 保持 null */ }
    if (!response.ok) {
      const detail = payload?.error ? `:${payload.error}` : '';
      throw new Error(`orchestrator_bridge_${op}_http_${response.status}${detail}`);
    }
    return payload;
  }

  return Object.freeze({
    targetMachineId,
    prepare: (input) => post('/harness/orchestrators/prepare', input, 'prepare', prepareTimeoutMs),
    start: ({ run_id, ...rest }) => post(`/harness/orchestrators/${run_id}/start`, rest, 'start', startTimeoutMs),
    inspect: ({ run_id }) => post(`/harness/orchestrators/${run_id}/inspect`, {}, 'inspect', startTimeoutMs),
  });
}
