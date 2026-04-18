/**
 * docker-executor.js — Cecelia 执行器架构第一步
 *
 * 用 Docker container 替换 cecelia-run.sh + worktree spawn。
 * 每个 task 一个隔离 container，--rm 自动销毁，cgroup 资源限制。
 *
 * 设计目标：
 * - 进程隔离：宿主无残留 claude 进程，杀 container 即清理
 * - 资源限制：--memory / --cpus 防止单 task 拖垮整机
 * - 工作目录隔离：宿主 worktree 通过 -v 挂载到 /workspace
 * - 超时强制 kill：spawn 超时 → docker kill {container_name} → --rm 自动销毁
 *
 * 启用方式：环境变量 HARNESS_DOCKER_ENABLED=true
 * 镜像：cecelia/runner:latest（由 docker/build.sh 构建）
 *
 * 与 callback_queue 兼容：
 *   container 完成后，executeInDocker 将结果直接 INSERT callback_queue，
 *   下游 callback-worker.js 自然路由到 callback-processor.js，与 bridge 路径一致。
 */

import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import path from 'path';
import os from 'os';
import pool from './db.js';

const DEFAULT_IMAGE = process.env.CECELIA_RUNNER_IMAGE || 'cecelia/runner:latest';
const DEFAULT_TIMEOUT_MS = parseInt(process.env.CECELIA_DOCKER_TIMEOUT_MS || '900000', 10); // 15 min
const DEFAULT_PROMPT_DIR = process.env.CECELIA_PROMPT_DIR || '/tmp/cecelia-prompts';
const DEFAULT_WORKTREE_BASE = process.env.WORKTREE_BASE || '/Users/administrator/perfect21/cecelia';

/**
 * task_type → 资源档位映射（与产品 PRD 一致）
 *   light  : 512 MB / 1 core   — planner / report / 短链 LLM 调用
 *   normal : 1   GB / 1 core   — propose / review / eval / fix
 *   heavy  : 1.5 GB / 2 cores  — generate / dev（写代码 + git/CI）
 */
const RESOURCE_TIERS = {
  light: { memoryMB: 512, cpuCores: 1 },
  normal: { memoryMB: 1024, cpuCores: 1 },
  heavy: { memoryMB: 1536, cpuCores: 2 },
};

const TASK_TYPE_TIER = {
  // light
  planner: 'light',
  sprint_planner: 'light',
  harness_planner: 'light',
  report: 'light',
  sprint_report: 'light',
  harness_report: 'light',
  daily_report: 'light',
  briefing: 'light',
  // heavy
  dev: 'heavy',
  codex_dev: 'heavy',
  generate: 'heavy',
  sprint_generator: 'heavy',
  harness_generator: 'heavy',
  initiative_plan: 'heavy',
  // 其他默认 normal（propose/review/eval/fix/talk/research...）
};

/**
 * 根据 task_type 解析资源档位
 * @param {string} taskType
 * @returns {{memoryMB:number, cpuCores:number, tier:string}}
 */
export function resolveResourceTier(taskType) {
  const tier = TASK_TYPE_TIER[taskType] || 'normal';
  const spec = RESOURCE_TIERS[tier];
  return { ...spec, tier };
}

/**
 * 检测 docker 二进制是否可用（缓存结果）
 */
let _dockerAvailable = null;
export function isDockerAvailable() {
  if (_dockerAvailable !== null) return _dockerAvailable;
  return new Promise((resolve) => {
    const proc = spawn('docker', ['version', '--format', '{{.Server.Version}}'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    proc.stdout.on('data', (c) => { out += c.toString(); });
    proc.on('error', () => { _dockerAvailable = false; resolve(false); });
    proc.on('exit', (code) => {
      _dockerAvailable = code === 0 && out.trim().length > 0;
      resolve(_dockerAvailable);
    });
  });
}

/**
 * 重置可用性缓存（测试用）
 */
export function _resetDockerAvailability() {
  _dockerAvailable = null;
}

/**
 * 把 prompt 写入临时文件（避免 argv 过长 / 引号转义陷阱）
 * 文件挂载到 container 的 /workspace/.cecelia-prompts/{file}.txt
 */
function writePromptFile(taskId, prompt) {
  if (!existsSync(DEFAULT_PROMPT_DIR)) {
    mkdirSync(DEFAULT_PROMPT_DIR, { recursive: true });
  }
  const file = path.join(DEFAULT_PROMPT_DIR, `${taskId}.prompt`);
  writeFileSync(file, prompt, 'utf8');
  return file;
}

/**
 * 把 env 对象转成 docker -e KEY=VALUE 参数列表
 * @param {Record<string,string>} env
 */
function envToArgs(env) {
  if (!env || typeof env !== 'object') return [];
  const args = [];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || v === null) continue;
    args.push('-e', `${k}=${String(v)}`);
  }
  return args;
}

/**
 * 生成 container 名（短 ID，便于 docker kill）
 */
function containerName(taskId) {
  const short = String(taskId).replace(/-/g, '').slice(0, 12);
  return `cecelia-task-${short}`;
}

/**
 * 在 Docker container 中执行 task
 *
 * @param {Object} opts
 * @param {Object} opts.task         — 必填，含 id / task_type
 * @param {string} opts.prompt       — 必填，prompt 文本
 * @param {Record<string,string>} [opts.env]  — 注入容器的环境变量
 * @param {string} [opts.worktreePath] — 宿主工作目录，挂到 /workspace
 * @param {number} [opts.memoryMB]   — 覆盖默认资源档位
 * @param {number} [opts.cpuCores]
 * @param {number} [opts.timeoutMs]  — 默认 15 min
 * @param {string} [opts.image]      — 默认 cecelia/runner:latest
 * @returns {Promise<{exit_code:number, stdout:string, stderr:string, duration_ms:number, container:string, timed_out:boolean, started_at:string, ended_at:string}>}
 */
export async function executeInDocker(opts) {
  if (!opts || !opts.task || !opts.task.id) {
    throw new Error('executeInDocker: opts.task.id is required');
  }
  if (typeof opts.prompt !== 'string' || opts.prompt.length === 0) {
    throw new Error('executeInDocker: opts.prompt is required');
  }

  const taskId = opts.task.id;
  const taskType = opts.task.task_type || 'dev';
  const tier = resolveResourceTier(taskType);
  const memoryMB = opts.memoryMB || tier.memoryMB;
  const cpuCores = opts.cpuCores || tier.cpuCores;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const image = opts.image || DEFAULT_IMAGE;
  const worktreePath = opts.worktreePath || DEFAULT_WORKTREE_BASE;
  const name = containerName(taskId);

  const promptFile = writePromptFile(taskId, opts.prompt);

  // -v 挂载：宿主 worktree → /workspace；prompt 目录 → /tmp/cecelia-prompts
  // -e 注入 env，包括 task_id / webhook
  const envFinal = {
    CECELIA_TASK_ID: taskId,
    CECELIA_TASK_TYPE: taskType,
    CECELIA_HEADLESS: 'true',
    CECELIA_DOCKER_SANDBOX: 'true',
    ...(opts.env || {}),
  };

  // 解析 CECELIA_CREDENTIALS → 注入 ANTHROPIC_API_KEY（容器内无宿主凭据文件）
  const credName = envFinal.CECELIA_CREDENTIALS;
  if (credName && !envFinal.ANTHROPIC_API_KEY) {
    // account1 使用 CLAUDE_CONFIG_DIR，其他 account 从 credentials JSON 读 API key
    if (credName === 'account1') {
      const configDir = path.join(os.homedir(), `.claude-account1`);
      if (existsSync(configDir)) {
        envFinal.CLAUDE_CONFIG_DIR = configDir;
      }
    } else {
      const credFile = path.join(os.homedir(), '.credentials', `${credName}.json`);
      try {
        const cred = JSON.parse(readFileSync(credFile, 'utf8'));
        if (cred.api_key) envFinal.ANTHROPIC_API_KEY = cred.api_key;
      } catch (e) {
        console.warn(`[docker-executor] credentials file not found: ${credFile}`);
      }
    }
  }

  // 额外的 volume 挂载列表
  const extraVolumes = [];
  // CLAUDE_CONFIG_DIR 需要挂载到容器内（只读）
  if (envFinal.CLAUDE_CONFIG_DIR) {
    extraVolumes.push('-v', `${envFinal.CLAUDE_CONFIG_DIR}:${envFinal.CLAUDE_CONFIG_DIR}:ro`);
  }

  const args = [
    'run',
    '--rm',
    '--name', name,
    `--memory=${memoryMB}m`,
    `--cpus=${cpuCores}`,
    '-v', `${worktreePath}:/workspace`,
    '-v', `${DEFAULT_PROMPT_DIR}:/tmp/cecelia-prompts:ro`,
    ...extraVolumes,
    ...envToArgs(envFinal),
    image,
    // ENTRYPOINT = ["claude", "-p", "--dangerously-skip-permissions", "--output-format", "json"]
    // 末尾参数作为 prompt 传入。读 file 内容并以 stdin 注入更稳，但
    // 为了与 ENTRYPOINT 兼容这里直接传 prompt 文本。
    opts.prompt,
  ];

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  console.log(
    `[docker-executor] spawn task=${taskId} type=${taskType} tier=${tier.tier} mem=${memoryMB}m cpus=${cpuCores} image=${image} container=${name}`
  );

  return await new Promise((resolve) => {
    const proc = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    const killTimer = setTimeout(() => {
      timedOut = true;
      console.warn(
        `[docker-executor] timeout task=${taskId} after ${timeoutMs}ms — docker kill ${name}`
      );
      // --rm 模式下 kill 后容器自动销毁，不必手动 rm
      spawn('docker', ['kill', name], { stdio: 'ignore' });
    }, timeoutMs);

    proc.on('error', (err) => {
      clearTimeout(killTimer);
      console.error(`[docker-executor] spawn error task=${taskId}: ${err.message}`);
      const endedAt = new Date().toISOString();
      resolve({
        exit_code: -1,
        stdout,
        stderr: stderr + `\n[docker-executor] spawn error: ${err.message}`,
        duration_ms: Date.now() - startedAtMs,
        container: name,
        timed_out: false,
        started_at: startedAt,
        ended_at: endedAt,
      });
    });

    proc.on('exit', (code, signal) => {
      clearTimeout(killTimer);
      const duration = Date.now() - startedAtMs;
      const endedAt = new Date().toISOString();
      console.log(
        `[docker-executor] exit task=${taskId} code=${code} signal=${signal} duration=${duration}ms timed_out=${timedOut}`
      );
      resolve({
        exit_code: code == null ? -1 : code,
        stdout,
        stderr,
        duration_ms: duration,
        container: name,
        timed_out: timedOut,
        started_at: startedAt,
        ended_at: endedAt,
      });
    });
  });
}

/**
 * 把 docker 执行结果写入 callback_queue（与 bridge 路径完全兼容）
 * 下游 callback-worker.js 会自动 pickup → callback-processor.js
 *
 * @param {Object} task
 * @param {string} runId
 * @param {string|null} checkpointId
 * @param {Object} result — executeInDocker 返回值
 */
export async function writeDockerCallback(task, runId, checkpointId, result) {
  const status = result.timed_out
    ? 'timeout'
    : (result.exit_code === 0 ? 'success' : 'failed');

  // result_json 兼容 callback-worker 的 buildDataFromRow：_meta 存附加字段
  const resultJson = {
    docker: true,
    container: result.container,
    started_at: result.started_at,
    ended_at: result.ended_at,
    timed_out: result.timed_out,
    // claude --output-format json 输出的最后一段就是结构化结果，原样保留
    raw_stdout_tail: result.stdout ? result.stdout.slice(-4000) : '',
    _meta: {
      executor: 'docker',
      tier: resolveResourceTier(task.task_type || 'dev').tier,
    },
  };

  const stderrTail = result.stderr ? result.stderr.slice(-2000) : null;
  const failureClass = result.timed_out
    ? 'docker_timeout'
    : (result.exit_code !== 0 ? 'docker_nonzero_exit' : null);

  await pool.query(
    `INSERT INTO callback_queue
       (task_id, checkpoint_id, run_id, status, result_json, stderr_tail,
        duration_ms, attempt, exit_code, failure_class)
     VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)`,
    [
      task.id,
      checkpointId || null,
      runId || null,
      status,
      JSON.stringify(resultJson),
      stderrTail,
      result.duration_ms,
      1,
      result.exit_code,
      failureClass,
    ]
  );

  console.log(
    `[docker-executor] callback_queue inserted task=${task.id} status=${status} exit=${result.exit_code}`
  );
}

export const __test__ = {
  RESOURCE_TIERS,
  TASK_TYPE_TIER,
  containerName,
  envToArgs,
  writePromptFile,
};
