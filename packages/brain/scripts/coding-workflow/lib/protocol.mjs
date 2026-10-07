import fs from 'node:fs';
import path from 'node:path';

const OUTPUT_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const STATUSES = new Set(['completed', 'partial', 'failed']);
const FAILURE_CLASSES = new Set(['retryable', 'needs_human', 'fatal']);

/** 日志一律走 stderr，stdout 只留给结果 JSON。 */
export function log(...args) {
  console.error(...args);
}

/**
 * 把 sprintDir 解析到 worktree 下的绝对路径。
 * sprintDir 为绝对路径或含 `..` 段时抛 Error('sprint_dir_invalid')。
 */
export function resolveSprintDir(worktree, sprintDir) {
  if (typeof sprintDir !== 'string' || sprintDir === '' || path.isAbsolute(sprintDir)) {
    throw new Error('sprint_dir_invalid');
  }
  if (sprintDir.split(/[\\/]+/).includes('..')) {
    throw new Error('sprint_dir_invalid');
  }
  return path.join(worktree, sprintDir);
}

function readStdin() {
  return fs.readFileSync(0, 'utf8');
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function degrade(result, reasonCode) {
  return {
    ...result,
    status: 'failed',
    failure_class: 'fatal',
    outputs: {},
    metrics: {},
    evidence: [],
    reason_code: reasonCode,
  };
}

/**
 * 把 handler 返回值规整成协议结果。纯函数。
 * outputs/metrics 必须是 plain object，evidence 必须是数组，否则降级 failed/fatal。
 */
export function buildResult(input, res) {
  const status = STATUSES.has(res?.status) ? res.status : 'failed';
  let failureClass = null;
  if (status !== 'completed') {
    failureClass = FAILURE_CLASSES.has(res?.failure_class) ? res.failure_class : 'fatal';
  }
  const result = {
    schema_version: 1,
    run_tag: input?.run_tag ?? null,
    status,
    failure_class: failureClass,
    outputs: res?.outputs === undefined ? {} : res.outputs,
    metrics: res?.metrics === undefined ? {} : res.metrics,
    evidence: res?.evidence === undefined ? [] : res.evidence,
  };
  if (res?.reason_code) result.reason_code = res.reason_code;

  if (!isPlainObject(result.outputs) || !isPlainObject(result.metrics) || !Array.isArray(result.evidence)) {
    return degrade(result, 'result_payload_invalid');
  }
  const badKey = Object.keys(result.outputs).find((k) => !OUTPUT_KEY_RE.test(k));
  if (badKey !== undefined) {
    return degrade(result, `outputs_key_invalid:${badKey}`);
  }
  return result;
}

/**
 * json-stdio-v1 活动入口：读 stdin JSON → 调 handler → stdout 写一次结果 JSON。
 * completed 退出码 0，其余 2；handler 抛错 → failed/fatal，reason_code=error.message。
 */
export async function runActivity(handler) {
  // stdout 只留给结果 JSON：依赖或 handler 里的 console.log 一律改道 stderr
  console.log = log;
  console.info = log;
  console.debug = log;

  let input = null;
  let result;
  try {
    input = JSON.parse(readStdin());
    result = buildResult(input, await handler(input));
  } catch (error) {
    log(error?.stack || String(error));
    result = buildResult(input, {
      status: 'failed',
      failure_class: 'fatal',
      reason_code: error?.message || 'handler_error',
    });
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.status === 'completed' ? 0 : 2;
}
