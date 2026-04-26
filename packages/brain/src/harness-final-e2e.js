/**
 * Harness E2E 工具函数集（Sprint 1 后只剩纯工具）。
 *
 * 历史：原 v2 M5 含 runFinalE2E 编排函数 — Sprint 1 已迁入
 *   packages/brain/src/workflows/harness-initiative.graph.finalE2eNode。
 * 编排逻辑由 LangGraph 节点承担，本文件只保留 5 个被节点 + 测试调用的纯工具：
 *   - runScenarioCommand
 *   - normalizeAcceptance
 *   - bootstrapE2E / teardownE2E
 *   - attributeFailures
 *
 * Spec: docs/superpowers/specs/2026-04-26-harness-langgraph-full-graph-design.md
 *
 * e2e_acceptance jsonb 结构（来自 initiative_contracts.e2e_acceptance）：
 *   {
 *     scenarios: [{ name, covered_tasks: [uuid], commands: [{type, cmd}] }]
 *   }
 */

import { execSync } from 'child_process';
import path from 'path';

const DEFAULT_UP_SCRIPT = 'scripts/harness-e2e-up.sh';
const DEFAULT_DOWN_SCRIPT = 'scripts/harness-e2e-down.sh';
const DEFAULT_SCENARIO_TIMEOUT_MS = 5 * 60 * 1000;
const OUTPUT_CAP_BYTES = 4000;

/**
 * 跑一条 e2e 命令（curl / node / playwright），返回 exit code + 截尾 stdout。
 *
 * 不做 shell 校验 —— e2e_acceptance 由 Proposer 产出、Reviewer 对抗通过，
 * 信任链在合同审批阶段建立。此处只负责执行 + 收集。
 *
 * @param {{cmd: string, type?: string}} command
 * @param {{exec?: Function, cwd?: string, timeoutMs?: number}} [opts]
 * @returns {{exitCode: number, output: string}}
 */
export function runScenarioCommand(command, opts = {}) {
  const exec = opts.exec || execSync;
  const timeoutMs = Number.isFinite(opts.timeoutMs)
    ? opts.timeoutMs
    : DEFAULT_SCENARIO_TIMEOUT_MS;

  if (!command || typeof command.cmd !== 'string' || !command.cmd.trim()) {
    return { exitCode: 1, output: '(empty cmd)' };
  }

  try {
    const raw = exec(command.cmd, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: opts.cwd,
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
    });
    const str = typeof raw === 'string' ? raw : (raw ? raw.toString('utf8') : '');
    return {
      exitCode: 0,
      output: str.length > OUTPUT_CAP_BYTES ? str.slice(-OUTPUT_CAP_BYTES) : str,
    };
  } catch (err) {
    // execSync 在非 0 退出时抛错，err.status / err.stdout / err.stderr 可读
    const stdout = err.stdout ? String(err.stdout) : '';
    const stderr = err.stderr ? String(err.stderr) : '';
    const combined = `${stdout}\n${stderr}\n${err.message || ''}`.trim();
    return {
      exitCode: Number.isInteger(err.status) ? err.status : 1,
      output: combined.length > OUTPUT_CAP_BYTES
        ? combined.slice(-OUTPUT_CAP_BYTES)
        : combined,
    };
  }
}

/**
 * 校验 e2e_acceptance 结构。抛错则说明 Planner/Proposer 合同未达标。
 *
 * @param {any} acceptance
 * @returns {{scenarios: Array<object>}}
 */
export function normalizeAcceptance(acceptance) {
  if (!acceptance || typeof acceptance !== 'object') {
    throw new Error('e2e_acceptance must be an object with scenarios[]');
  }
  const scenarios = Array.isArray(acceptance.scenarios) ? acceptance.scenarios : null;
  if (!scenarios || scenarios.length === 0) {
    throw new Error('e2e_acceptance.scenarios required (non-empty array)');
  }
  scenarios.forEach((s, i) => {
    if (!s || typeof s !== 'object') {
      throw new Error(`scenarios[${i}] must be object`);
    }
    if (typeof s.name !== 'string' || !s.name.trim()) {
      throw new Error(`scenarios[${i}].name required`);
    }
    if (!Array.isArray(s.covered_tasks) || s.covered_tasks.length === 0) {
      throw new Error(`scenarios[${i}].covered_tasks required (non-empty uuid[])`);
    }
    if (!Array.isArray(s.commands) || s.commands.length === 0) {
      throw new Error(`scenarios[${i}].commands required (non-empty array)`);
    }
  });
  return { scenarios };
}

/**
 * 启动真实 staging 环境（postgres 55432 / Brain 5222 / Frontend 5174）。
 *
 * 调用 scripts/harness-e2e-up.sh 启动；健康探测在脚本里轮询。
 * 返回 up 脚本的 exit code —— 0 表示全部就绪。
 *
 * @param {object} [opts]
 * @param {Function} [opts.exec]       execSync 替换
 * @param {string}   [opts.cwd]        脚本工作目录
 * @param {string}   [opts.upScript]   覆盖默认 scripts/harness-e2e-up.sh
 * @returns {{exitCode: number, output: string}}
 */
export function bootstrapE2E(opts = {}) {
  const script = opts.upScript || DEFAULT_UP_SCRIPT;
  const cmd = `bash ${path.posix.normalize(script)}`;
  return runScenarioCommand({ cmd, type: 'bash' }, {
    exec: opts.exec,
    cwd: opts.cwd,
    timeoutMs: 5 * 60 * 1000,
  });
}

/**
 * 清理 staging 环境（compose down + pkill）。
 *
 * 永远不抛错 —— 清理失败也不能影响 verdict；只记录 exitCode 供日志。
 *
 * @param {object} [opts]
 * @param {Function} [opts.exec]
 * @param {string}   [opts.cwd]
 * @param {string}   [opts.downScript]
 * @returns {{exitCode: number, output: string}}
 */
export function teardownE2E(opts = {}) {
  const script = opts.downScript || DEFAULT_DOWN_SCRIPT;
  const cmd = `bash ${path.posix.normalize(script)}`;
  return runScenarioCommand({ cmd, type: 'bash' }, {
    exec: opts.exec,
    cwd: opts.cwd,
    timeoutMs: 2 * 60 * 1000,
  });
}

/**
 * @deprecated Sprint 1: 编排函数已迁入 harness-initiative.graph.finalE2eNode。
 * 保留 1 周作 HARNESS_USE_FULL_GRAPH=false 兜底；下一个 PR 删。
 */
export async function runFinalE2E(initiativeId, contract, opts = {}) {
  if (!initiativeId || typeof initiativeId !== 'string') {
    throw new Error('runFinalE2E: initiativeId required');
  }
  if (!contract || typeof contract !== 'object') {
    throw new Error('runFinalE2E: contract required');
  }

  const { scenarios } = normalizeAcceptance(contract.e2e_acceptance);

  const runScenario = opts.runScenario || runScenarioCommand;
  const bootstrap = opts.bootstrap || bootstrapE2E;
  const teardown = opts.teardown || teardownE2E;

  let bootstrapResult = null;
  if (!opts.skipBootstrap) {
    bootstrapResult = bootstrap();
    if (bootstrapResult.exitCode !== 0) {
      // 起环境都失败，整体 FAIL —— 归因到所有场景的 covered_tasks 聚合，
      // 避免归因空集导致无 Task 回 Generator
      const first = scenarios[0];
      return {
        verdict: 'FAIL',
        failedScenarios: [{
          name: `bootstrap failure: ${first.name}`,
          covered_tasks: collectAllCoveredTasks(scenarios),
          output: bootstrapResult.output,
          exitCode: bootstrapResult.exitCode,
          failedCommand: 'bash scripts/harness-e2e-up.sh',
        }],
        passedScenarios: [],
        bootstrap: bootstrapResult,
        initiativeId,
      };
    }
  }

  const failedScenarios = [];
  const passedScenarios = [];

  for (const scenario of scenarios) {
    let failedInScenario = null;
    for (const cmd of scenario.commands) {
      const r = await runScenario(cmd, {
        scenarioName: scenario.name,
        coveredTasks: scenario.covered_tasks,
      });
      if (r.exitCode !== 0) {
        failedInScenario = {
          name: scenario.name,
          covered_tasks: [...scenario.covered_tasks],
          output: r.output,
          exitCode: r.exitCode,
          failedCommand: cmd.cmd,
        };
        break; // scenario 内一条失败即算整体失败（fail-fast）
      }
    }
    if (failedInScenario) {
      failedScenarios.push(failedInScenario);
    } else {
      passedScenarios.push({
        name: scenario.name,
        covered_tasks: [...scenario.covered_tasks],
      });
    }
  }

  let teardownResult = null;
  if (!opts.skipBootstrap) {
    try {
      teardownResult = teardown();
    } catch (err) {
      teardownResult = { exitCode: 1, output: `teardown threw: ${err.message}` };
    }
  }

  return {
    verdict: failedScenarios.length === 0 ? 'PASS' : 'FAIL',
    failedScenarios,
    passedScenarios,
    bootstrap: bootstrapResult,
    teardown: teardownResult,
    initiativeId,
  };
}

/**
 * 按 covered_tasks 聚合失败场景，返回每个 Task 的失败证据。
 *
 * 归因规则（PRD §6.3）：
 *   - scenario 失败 → 所有 covered_tasks 同时被怀疑
 *   - 同一 Task 被多 scenario 击中 → failureCount 累加
 *   - 返回 Map 以保留插入顺序，便于 runner 按 Task 回 Generator 的顺序稳定
 *
 * @param {Array<{name:string, covered_tasks:string[], output?:string, exitCode?:number}>} failedScenarios
 * @returns {Map<string, {scenarios: Array<{name:string, exitCode:number, output:string}>, failureCount:number}>}
 */
export function attributeFailures(failedScenarios) {
  const map = new Map();
  if (!Array.isArray(failedScenarios) || failedScenarios.length === 0) {
    return map;
  }
  for (const s of failedScenarios) {
    if (!s || !Array.isArray(s.covered_tasks)) continue;
    for (const taskId of s.covered_tasks) {
      if (typeof taskId !== 'string' || !taskId.trim()) continue;
      if (!map.has(taskId)) {
        map.set(taskId, { scenarios: [], failureCount: 0 });
      }
      const entry = map.get(taskId);
      entry.scenarios.push({
        name: s.name,
        exitCode: s.exitCode ?? 1,
        output: s.output || '',
      });
      entry.failureCount += 1;
    }
  }
  return map;
}

// ─── 内部辅助 ─────────────────────────────────────────────────────────────

function collectAllCoveredTasks(scenarios) {
  const set = new Set();
  for (const s of scenarios) {
    for (const t of s.covered_tasks || []) {
      if (typeof t === 'string' && t.trim()) set.add(t);
    }
  }
  return [...set];
}
