/**
 * Brain → primary worker 的 orchestrator 启动桥（决策 2e756506 方案B）。
 * 不复用 remote-bridge-transport（那是 attempt 形状：租约/回执/凭据信封耦合），
 * orchestrator 只需 prepare/start/inspect 三个薄调用。
 */
import { resolvePrimaryWorkerId, workerBridgeUrlFor } from './machine-registry.js';

// 2026-09-24 实证（任务 f61fc0c6）：MMV 建工作区 = git clone --bare --no-hardlinks 整库拷贝 + npm ci，
// 两条 run 并发时实测 7 分钟；原 180s 硬编码让 Brain 先放弃、跑场机继续 prepare → 作业停在
// prepared 占槽到 TTL，期间所有派发 429 空转。默认提到 600s，并允许 env 覆盖。
const DEFAULT_PREPARE_TIMEOUT_MS = 600_000;
const DEFAULT_START_TIMEOUT_MS = 30_000;
const PREPARE_TIMEOUT_ENV = 'KERNEL_FLEET_ORCHESTRATOR_PREPARE_TIMEOUT_MS';

function resolvePrepareTimeoutMs(env, explicit) {
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const raw = env?.[PREPARE_TIMEOUT_ENV];
  if (raw == null || String(raw).trim() === '') return DEFAULT_PREPARE_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PREPARE_TIMEOUT_MS;
  return parsed;
}

export function createOrchestratorBridge({
  env = process.env,
  fetchFn = globalThis.fetch,
  prepareTimeoutMs: prepareTimeoutOption,
  startTimeoutMs = DEFAULT_START_TIMEOUT_MS,
} = {}) {
  const prepareTimeoutMs = resolvePrepareTimeoutMs(env, prepareTimeoutOption);
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
    if (!response.ok) {
      let payload = null;
      try { payload = await response.json(); } catch { /* 错误体未必是 json，保持 null */ }
      const detail = payload?.error ? `:${payload.error}` : '';
      throw new Error(`orchestrator_bridge_${op}_http_${response.status}${detail}`);
    }
    // 终审 I2：2xx 但 body 不是合法 json 不能静默吞成 null——上游会把 null.worktree_path
    // 之类当成"成功但字段全空"处理，比显式报错更难查。
    try {
      return await response.json();
    } catch (error) {
      throw new Error(`orchestrator_bridge_${op}_invalid_json:${error?.message ?? 'unknown'}`);
    }
  }

  return Object.freeze({
    targetMachineId,
    prepareTimeoutMs,
    prepare: (input) => post('/harness/orchestrators/prepare', input, 'prepare', prepareTimeoutMs),
    start: ({ run_id, ...rest }) => post(`/harness/orchestrators/${run_id}/start`, rest, 'start', startTimeoutMs),
    inspect: ({ run_id }) => post(`/harness/orchestrators/${run_id}/inspect`, {}, 'inspect', startTimeoutMs),
  });
}
