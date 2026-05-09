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
import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync, readdirSync, statSync } from 'fs';
import path from 'path';
import os from 'os';
import pool from './db.js';
import { runDocker } from './spawn/middleware/docker-run.js';
import { resolveAccount } from './spawn/middleware/account-rotation.js';
import { resolveCascade } from './spawn/middleware/cascade.js';
// v2 P2.5 外层 middleware 接线
import { checkCostCap } from './spawn/middleware/cost-cap.js';
import { checkCap } from './spawn/middleware/cap-marking.js';
import { recordBilling } from './spawn/middleware/billing.js';
import { createSpawnLogger } from './spawn/middleware/logging.js';
import { raise } from './alerting.js';

// exit_code=137 = SIGKILL（128 + 9）。常见来源：
//   - cgroup memory limit 触发（OOM killer）
//   - docker kill --signal=KILL（手动 / watchdog）
//   - --memory=N 限制下 container 突破上限
// 持续 137 表示资源配置不足或任务 Memory 超标，应该触发 alert 而非静默失败。
const EXIT_SIGKILL = 137;

const DEFAULT_IMAGE = process.env.CECELIA_RUNNER_IMAGE || 'cecelia/runner:latest';
// Harness v6 P1-E：默认 90min（旧值 15min 让 Generator 大改动 SIGKILL）。
// per-tier timeoutMs (resource-tier.js) 比此 fallback 优先；env override 仍生效。
const DEFAULT_TIMEOUT_MS = parseInt(process.env.CECELIA_DOCKER_TIMEOUT_MS || '5400000', 10); // 90 min
const DEFAULT_PROMPT_DIR = process.env.CECELIA_PROMPT_DIR || '/tmp/cecelia-prompts';
// HOST_PROMPT_DIR：Brain 在容器里运行时，prompt 文件是写到 Brain 容器内 DEFAULT_PROMPT_DIR
// （通常 tmpfs），但 docker-executor 给子容器构造 mount 源路径由**宿主 docker daemon 解析**，
// 必须是宿主路径。compose 里把宿主某目录 bind-mount 到 Brain 容器 /tmp/cecelia-prompts，
// 并 export HOST_PROMPT_DIR=<宿主路径>。没设 HOST_PROMPT_DIR 时 fallback 到 DEFAULT_PROMPT_DIR
// （Brain 跑在宿主上的老路径，两边路径一致）。同 HOST_HOME 语义。
const HOST_PROMPT_DIR = process.env.HOST_PROMPT_DIR || DEFAULT_PROMPT_DIR;
const DEFAULT_WORKTREE_BASE = process.env.WORKTREE_BASE || '/Users/administrator/perfect21/cecelia';

// resource-tier 配置已迁到 spawn/middleware/resource-tier.js（v2 P2 PR7）
// 本地 import 供 docker-executor.js 内部使用 + re-export 供外部 caller 继续用旧路径
import { resolveResourceTier, RESOURCE_TIERS, TASK_TYPE_TIER } from './spawn/middleware/resource-tier.js';
export { resolveResourceTier, RESOURCE_TIERS, TASK_TYPE_TIER };

// Harness v6 Phase B：从 Docker stdout 提取 pr_url / verdict 写入 _meta。
// parseDockerOutput 抓 claude --output-format json 末尾 result 段；
// extractField 兼容 `pr_url: <URL>` 字面量 / JSON `"pr_url":"..."`，过滤 null/FAILED 等假值。
import { parseDockerOutput, extractField } from './harness-shared.js';

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
 * 生成 cidfile 路径（docker 启动后把 container ID 写入此文件）
 * 我们用它拿容器 ID 前 12 位，便于观察性/forensic。
 */
function cidFilePath(taskId) {
  return path.join(DEFAULT_PROMPT_DIR, `${taskId}.cid`);
}

/**
 * 读取 cidfile 并返回前 12 位 container_id（失败返回 null）
 */
export function readContainerIdFromCidfile(cidPath) {
  try {
    if (!existsSync(cidPath)) return null;
    const raw = readFileSync(cidPath, 'utf8').trim();
    if (!raw) return null;
    return raw.slice(0, 12);
  } catch {
    return null;
  }
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
 * @returns {Promise<{exit_code:number, stdout:string, stderr:string, duration_ms:number, container:string, container_id:string|null, command:string, timed_out:boolean, started_at:string, ended_at:string}>}
 *
 * 说明（WF-3 观察性）：
 *   - container_id：容器 ID 前 12 位（从 --cidfile 读），失败返回 null
 *   - command：实际 docker run 完整命令字符串（forensic / 前端元数据用）
/**
 * 构造 docker run 参数（抽出以便单测）。
 *
 * @param {Object} opts  含 task / prompt / env / worktreePath / memoryMB / cpuCores / image
 * @param {Object} [ctx]
 * @param {string} [ctx.homedir]   覆盖 os.homedir()（测试用）
 * @param {(p:string)=>boolean} [ctx.existsSyncFn]  覆盖 fs.existsSync（测试用）
 * @param {(p:string,e:any)=>string} [ctx.readFileSyncFn]  覆盖 fs.readFileSync
 * @returns {{args:string[], envFinal:Record<string,string>, name:string, memoryMB:number, cpuCores:number, image:string, worktreePath:string, hostClaudeConfigDir:string|null}}
 */
export function buildDockerArgs(opts, ctx = {}) {
  const taskId = opts.task.id;
  const taskType = opts.task.task_type || 'dev';
  const tier = resolveResourceTier(taskType);
  const memoryMB = opts.memoryMB || tier.memoryMB;
  const cpuCores = opts.cpuCores || tier.cpuCores;
  const image = opts.image || DEFAULT_IMAGE;
  const worktreePath = opts.worktreePath || DEFAULT_WORKTREE_BASE;
  const name = containerName(taskId);
  // Brain docker 化后 os.homedir() 返回容器内 $HOME（/home/cecelia 或 /root），
  // 不是宿主 /Users/administrator。docker-executor 给 pipeline container 挂载
  // 凭据路径（.claude-accountN）用 homedir 拼出，错了会让 Claude CLI 秒退
  // "Not logged in"。HOST_HOME env（compose 里显式设）兜底拿宿主 homedir。
  const homedir = ctx.homedir || process.env.HOST_HOME || os.homedir();
  const existsFn = ctx.existsSyncFn || existsSync;
  const readFn = ctx.readFileSyncFn || readFileSync;

  const envFinal = {
    CECELIA_TASK_ID: taskId,
    CECELIA_TASK_TYPE: taskType,
    CECELIA_HEADLESS: 'true',
    CECELIA_DOCKER_SANDBOX: 'true',
    ...(opts.env || {}),
  };

  // P0-3：opts.model 可指定 claude CLI --model（alias 'haiku'/'sonnet'/'opus'
  // 或完整模型名）。通过 env CLAUDE_MODEL_OVERRIDE 传入容器，entrypoint.sh 读取
  // 并注入 `--model <value>`。空/未传时 entrypoint 走默认模型（账号 tier）。
  // 用途：content pipeline 的 copy_review 节点用 haiku 降成本。
  // opts.env.CLAUDE_MODEL_OVERRIDE 优先级高于 opts.model（方便调用方 override）。
  if (opts.model && !envFinal.CLAUDE_MODEL_OVERRIDE) {
    envFinal.CLAUDE_MODEL_OVERRIDE = String(opts.model);
  }

  // 解析 CECELIA_CREDENTIALS → 注入 Anthropic 凭据（容器内无宿主凭据文件）
  //
  // 容器内 claude 统一使用 /home/cecelia/.claude（可写副本），由 entrypoint.sh
  // 从 /host-claude-config（:ro 挂载）复制而来。
  //   - 宿主 CLAUDE_CONFIG_DIR：docker -v {hostDir}:/host-claude-config:ro
  //   - 容器内 env：CLAUDE_CONFIG_DIR=/home/cecelia/.claude
  // 这样 claude 能写 session-env，不再报 ENOENT: mkdir '/host-claude-config/session-env/...'
  const credName = envFinal.CECELIA_CREDENTIALS;
  let hostClaudeConfigDir = null;
  if (credName && !envFinal.ANTHROPIC_API_KEY) {
    const accountMatch = String(credName).match(/^account(\d+)$/);
    if (accountMatch) {
      const configDir = path.join(homedir, `.claude-${credName}`);
      if (existsFn(configDir)) {
        hostClaudeConfigDir = configDir;
      }
    } else {
      const credFile = path.join(homedir, '.credentials', `${credName}.json`);
      try {
        const cred = JSON.parse(readFn(credFile, 'utf8'));
        if (cred.api_key) envFinal.ANTHROPIC_API_KEY = cred.api_key;
      } catch {
        console.warn(`[docker-executor] credentials file not found: ${credFile}`);
      }
    }
  }

  // 容器内 claude 永远用 /home/cecelia/.claude（entrypoint.sh 复制可写副本）
  if (hostClaudeConfigDir) {
    envFinal.CLAUDE_CONFIG_DIR = '/home/cecelia/.claude';
  } else if (envFinal.CLAUDE_CONFIG_DIR) {
    hostClaudeConfigDir = envFinal.CLAUDE_CONFIG_DIR;
    envFinal.CLAUDE_CONFIG_DIR = '/home/cecelia/.claude';
  }

  // git author/committer 默认值（Cecelia Bot），让 Generator 容器能 git commit/push
  const defaultGitEnv = {
    GIT_AUTHOR_NAME: 'Cecelia Bot',
    GIT_AUTHOR_EMAIL: 'cecelia-bot@noreply.github.com',
    GIT_COMMITTER_NAME: 'Cecelia Bot',
    GIT_COMMITTER_EMAIL: 'cecelia-bot@noreply.github.com',
  };
  for (const [k, v] of Object.entries(defaultGitEnv)) {
    if (envFinal[k] === undefined || envFinal[k] === null) {
      envFinal[k] = v;
    }
  }

  const extraVolumes = [];
  if (hostClaudeConfigDir) {
    extraVolumes.push('-v', `${hostClaudeConfigDir}:/host-claude-config:ro`);
    // Symlink target mounts：宿主 .claude-accountN/skills → ~/.claude/skills → packages/workflows/skills
    // 两级 symlink，容器里必须能解析到最终 target，否则 cp -aL 拷不到 SKILL.md，harness skills 不可见
    const sharedClaudeDir = path.join(homedir, '.claude');
    if (existsFn(sharedClaudeDir)) {
      extraVolumes.push('-v', `${sharedClaudeDir}:${sharedClaudeDir}:ro`);
    }
    const workflowsDir = '/Users/administrator/perfect21/cecelia/packages/workflows';
    if (existsFn(workflowsDir)) {
      extraVolumes.push('-v', `${workflowsDir}:${workflowsDir}:ro`);
    }
  }
  const hostGitConfig = path.join(homedir, '.gitconfig');
  if (existsFn(hostGitConfig)) {
    extraVolumes.push('-v', `${hostGitConfig}:/home/cecelia/.gitconfig:ro`);
  }
  const hostGhDir = path.join(homedir, '.config', 'gh');
  if (existsFn(hostGhDir)) {
    extraVolumes.push('-v', `${hostGhDir}:/home/cecelia/.config/gh:ro`);
  }
  // 挂载 content pipeline 产物目录（双向 rw），让节点间共享文件产物。
  // 没挂载时 research 节点写到容器内 /home/cecelia/content-output/... 会随 --rm 丢失，
  // 下一个节点（copywrite/copy_review）读不到 findings.json / copy.md 一路 REVISION。
  // Harness 节点产物是 PR URL 走 state 传递，不需要此挂载；content pipeline 必须。
  const hostContentOutput = path.join(homedir, 'content-output');
  if (existsFn(hostContentOutput)) {
    extraVolumes.push('-v', `${hostContentOutput}:/home/cecelia/content-output:rw`);
  }
  // 挂载 ~/claude-output 让 V6 图生成脚本（gen-v6-person.mjs）及其他卡片生成脚本可用。
  // @resvg/resvg-js 本身已由 Dockerfile 全局装 linux 版；此挂载提供脚本源码 + 卡片 HTML 模板。
  const hostClaudeOutput = path.join(homedir, 'claude-output');
  if (existsFn(hostClaudeOutput)) {
    extraVolumes.push('-v', `${hostClaudeOutput}:/home/cecelia/claude-output:rw`);
  }
  // 挂载 ~/.ssh（只读）让 pipeline-export.sh 能 ssh "$NAS_SSH_ALIAS" 上传 tar。
  // 没挂载时 ssh 容器里找不到 id_rsa / ~/.ssh/config 里的 "Host nas" 定义 → exit=255，nas_url=null。
  // :ro 防容器写坏宿主 ssh 目录。macOS Docker Desktop osxfs 绕过 UID enforcement，
  // 容器内 cecelia 用户可读宿主 0600 文件。
  const hostSshDir = path.join(homedir, '.ssh');
  if (existsFn(hostSshDir)) {
    extraVolumes.push('-v', `${hostSshDir}:/home/cecelia/.ssh:ro`);
  }

  const cidfile = cidFilePath(taskId);
  const args = [
    'run',
    '--rm',
    '--name', name,
    '--cidfile', cidfile,
    `--memory=${memoryMB}m`,
    `--cpus=${cpuCores}`,
    '-v', `${worktreePath}:/workspace`,
    // mount 源路径用 HOST_PROMPT_DIR（宿主解析），目标路径固定 /tmp/cecelia-prompts（容器内）
    // H12: rw 让 H7 entrypoint tee STDOUT_FILE 写到此 mount 真生效（v13 暴露 :ro 让 tee silent fail）
    '-v', `${HOST_PROMPT_DIR}:/tmp/cecelia-prompts:rw`,
    ...extraVolumes,
    ...envToArgs(envFinal),
    image,
    // Prompt 不再作为 argv 传入 — entrypoint.sh 从 /tmp/cecelia-prompts/${CECELIA_TASK_ID}.prompt
    // 读并通过 stdin 喂给 claude。这样长 prompt（GAN Round N Reviewer 含完整合同历史）
    // 不会撞 OS argv 长度限制触发 spawn E2BIG。writePromptFile 已在上面写好文件。
  ];

  return { args, envFinal, name, memoryMB, cpuCores, image, worktreePath, hostClaudeConfigDir, cidfile };
}

// account-rotation 已迁到 spawn/middleware/account-rotation.js（v2 P2 PR3）
// 保留 re-export 供外部 caller（含测试）继续用旧名字
export { resolveAccount as resolveAccountForOpts } from './spawn/middleware/account-rotation.js';

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
  // Harness v6 P1-E：timeoutMs 优先级 opts.timeoutMs > tier.timeoutMs > DEFAULT_TIMEOUT_MS。
  // tier.timeoutMs 让 light 任务 30min 够、heavy 任务 2h 够、pipeline-heavy 跑 3h 不被秒杀。
  const timeoutMs = opts.timeoutMs || tier.timeoutMs || DEFAULT_TIMEOUT_MS;

  // v2 P2.5 外层 middleware 接线：logging 入口 + cost-cap 预算守卫。
  // cost-cap 若 throw CostCapExceededError 则拒绝 spawn（caller 应上层 catch）。
  const logger = createSpawnLogger(opts);
  logger.logStart();
  await checkCostCap(opts);

  // 写 prompt 文件（宿主侧持久化，用于 debug / audit）
  writePromptFile(taskId, opts.prompt);

  // 账号轮换 middleware — 所有 spawn 自动享有"cap/auth fail fallback"。
  opts.env = opts.env || {};
  await resolveCascade(opts);
  await resolveAccount(opts, { taskId });

  const { args, _envFinal, name, memoryMB, cpuCores, image, cidfile } = buildDockerArgs(opts);

  // --cidfile 要求文件不存在；之前残留的 cidfile 会让 docker run 立即失败
  if (cidfile && existsSync(cidfile)) {
    try { unlinkSync(cidfile); } catch { /* ignore */ }
  }

  // 记录 docker 命令（方便 forensic / 前端元数据展示）
  const command = `docker ${args.join(' ')}`;

  console.log(
    `[docker-executor] spawn task=${taskId} type=${taskType} tier=${tier.tier} mem=${memoryMB}m cpus=${cpuCores} timeout=${timeoutMs}ms image=${image} container=${name}`
  );
  // DEBUG: harness_* 任务 spawn 时 dump full docker args（forensic 定位 skill 加载失败）
  if (String(taskType).startsWith('harness_')) {
    console.log('[docker-executor] FULL_ARGS:', JSON.stringify(args));
  }

  const result = await runDocker(args, {
    taskId,
    taskType,
    timeoutMs,
    name,
    cidfile,
    command,
  });

  // v2 P2.5 外层 middleware 接线（后置）：cap-marking 检测 + billing 归账 + logging 出口。
  // 每个都容错，不阻塞 return。
  try { await checkCap(result, opts); } catch (e) { console.warn(`[docker-executor] checkCap failed: ${e.message}`); }
  try { await recordBilling(result, opts); } catch (e) { console.warn(`[docker-executor] recordBilling failed: ${e.message}`); }
  logger.logEnd(result);

  return result;
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
  // env_broken 探测：claude 找不到 dispatch 用的 skill 时输出
  // "Unknown skill: dev. Did you mean new?" + end_turn (exit_code=0)。
  // 不识别 → 当成 success → task 留在 queued + watchdog 反复 requeue
  // → 同一故障循环到 quarantine（4-25 串成 325 个 liveness_dead）。
  // 在入库时把它降级为 failed，由下游 dev-failure-classifier ENV_BROKEN
  // 标 retryable=false，配合 needs_human_review 把任务摘出循环。
  const stdoutForCheck = result.stdout || '';
  // 捕获组用 [\w\-]+ 避免吞掉后面的标点 / 引号 / 转义。skill 名只含字母数字下划线连字符。
  const skillMissingMatch = stdoutForCheck.match(/Unknown\s+skill\s*:\s*([\w-]+)/i);
  const isEnvBroken = !!skillMissingMatch;

  const status = result.timed_out
    ? 'timeout'
    : (isEnvBroken ? 'failed' : (result.exit_code === 0 ? 'success' : 'failed'));

  // Harness v6 Phase B: 从 stdout 解析 pr_url / verdict 塞进 _meta，让 callback-worker
  // 下游 (routePrUrlToTasks) 能从 result_json._meta.pr_url 回填 tasks.pr_url，
  // shepherd/harness_ci_watch 才拿得到 URL。
  const parsedStdout = parseDockerOutput(result.stdout || '');
  const prUrl = extractField(parsedStdout, 'pr_url');
  const verdict = extractField(parsedStdout, 'verdict');

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
      pr_url: prUrl || null,
      verdict: verdict || null,
    },
  };

  if (isEnvBroken) {
    resultJson._meta.skill_missing = skillMissingMatch[1];
    resultJson._meta.env_broken_reason = 'unknown_skill';
  }

  const stderrTail = result.stderr ? result.stderr.slice(-2000) : null;
  const isOomKilled = result.exit_code === EXIT_SIGKILL && !result.timed_out;
  const failureClass = result.timed_out
    ? 'docker_timeout'
    : (isEnvBroken
        ? 'env_skill_missing'
        : (isOomKilled
            ? 'docker_oom_killed'
            : (result.exit_code !== 0 ? 'docker_nonzero_exit' : null)));

  // exit=137 Alert：cgroup OOM 杀容器（不是手动 timeout）→ 资源不够或任务超标。
  // P1 级别：单次失败不阻塞，但累积应该被关注。fire-and-forget 不阻塞 callback 写入。
  if (isOomKilled) {
    raise(
      'P1',
      `docker_oom_killed_${task.id.slice(0, 8)}`,
      `🛑 Docker container exit=137 (SIGKILL) task=${task.id} type=${task.task_type}：可能 cgroup OOM 或被强制 kill，建议提高 task tier memory 或拆分任务`
    ).catch(err => console.error(`[docker-executor] silent alert error: ${err.message}`));
  }

  const _insertArgs = [
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
  ];
  const _retryDelays = [100, 500, 2000];
  let _lastInsertErr;
  for (let _i = 0; _i <= _retryDelays.length; _i++) {
    if (_i > 0) await new Promise(r => setTimeout(r, _retryDelays[_i - 1]));
    try {
      await pool.query(
        `INSERT INTO callback_queue
           (task_id, checkpoint_id, run_id, status, result_json, stderr_tail,
            duration_ms, attempt, exit_code, failure_class)
         VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)`,
        _insertArgs
      );
      _lastInsertErr = null;
      break;
    } catch (err) {
      _lastInsertErr = err;
      console.warn(`[docker-executor] callback_queue INSERT attempt ${_i + 1} failed task=${task.id}: ${err.message}`);
    }
  }

  if (_lastInsertErr) {
    const _dlqDir = process.env.CECELIA_CALLBACK_DLQ_DIR || '/tmp/cecelia-callback-dlq';
    try {
      mkdirSync(_dlqDir, { recursive: true });
      writeFileSync(
        path.join(_dlqDir, `${task.id}.json`),
        JSON.stringify({
          task_id: task.id,
          stdout: result.stdout || '',
          exit_code: result.exit_code,
          timestamp: new Date().toISOString(),
          error: _lastInsertErr.message,
        }),
        'utf8'
      );
      console.error(`[docker-executor] DLQ written: ${_dlqDir}/${task.id}.json`);
    } catch (dlqErr) {
      console.error(`[docker-executor] DLQ write failed: ${dlqErr.message}`);
    }
    throw _lastInsertErr;
  }

  console.log(
    `[docker-executor] callback_queue inserted task=${task.id} status=${status} exit=${result.exit_code}`
  );
}

const _DLQ_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function cleanDlq(dlqDir) {
  const dir = dlqDir || process.env.CECELIA_CALLBACK_DLQ_DIR || '/tmp/cecelia-callback-dlq';
  if (!existsSync(dir)) return { deleted: 0 };
  const cutoff = Date.now() - _DLQ_RETENTION_MS;
  let deleted = 0;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const fp = path.join(dir, file);
    try {
      if (statSync(fp).mtimeMs < cutoff) {
        unlinkSync(fp);
        deleted++;
      }
    } catch {
      // file already gone or inaccessible — skip
    }
  }
  return { deleted };
}

export const __test__ = {
  RESOURCE_TIERS,
  TASK_TYPE_TIER,
  containerName,
  cidFilePath,
  readContainerIdFromCidfile,
  envToArgs,
  writePromptFile,
  buildDockerArgs,
};
