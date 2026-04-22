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
import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from 'fs';
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
  // pipeline 专属：content pipeline 的 research/copywrite stage 含 Claude CLI + 长 prompt
  // + tool use，实测峰值 800-1100MB，1024 tier 偶发 OOM exit 137。给 2048 留 2× 冗余。
  'pipeline-heavy': { memoryMB: 2048, cpuCores: 1 },
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
  content_export: 'light',            // 只 tar + ssh，无 LLM
  // normal
  content_copy_review: 'normal',       // 纯 bash + curl 调 Brain LLM API，容器里无 Claude CLI 用量
  content_image_review: 'normal',      // 同上，vision 禁用时更轻
  // heavy
  dev: 'heavy',
  codex_dev: 'heavy',
  generate: 'heavy',
  content_generate: 'heavy',           // SVG napi 渲染 9 PNG 峰值 ~1200MB
  sprint_generator: 'heavy',
  harness_generator: 'heavy',
  initiative_plan: 'heavy',
  // pipeline-heavy — content pipeline 里 Claude CLI 吃 context 最重的两步
  content_research: 'pipeline-heavy',  // Claude 跑长 prompt + 网查 + 生成 findings.json 7KB
  content_copywrite: 'pipeline-heavy', // Claude 生成 copy.md + article.md 共 8-9KB
  // 其他默认 normal
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
 * 生成 cidfile 路径（docker 启动后把 container ID 写入此文件）
 * 我们用它拿容器 ID 前 12 位，便于观察性/forensic。
 */
function cidFilePath(taskId) {
  return path.join(DEFAULT_PROMPT_DIR, `${taskId}.cid`);
}

/**
 * 读取 cidfile 并返回前 12 位 container_id（失败返回 null）
 */
function readContainerIdFromCidfile(cidPath) {
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
      } catch (_e) {
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
    '-v', `${DEFAULT_PROMPT_DIR}:/tmp/cecelia-prompts:ro`,
    ...extraVolumes,
    ...envToArgs(envFinal),
    image,
    opts.prompt,
  ];

  return { args, envFinal, name, memoryMB, cpuCores, image, worktreePath, hostClaudeConfigDir, cidfile };
}

/**
 * 账号轮换 middleware — 所有 executeInDocker spawn 自动接入 Brain 的账号选择。
 *
 * 规则：
 *   - opts.env.CECELIA_CREDENTIALS 未传 → selectBestAccount（动态选最佳）
 *   - 已传但 isSpendingCapped / isAuthFailed → fallback 到 selectBestAccount
 *   - 已传且可用 → 尊重显式指定（Sprint / 调试用）
 *
 * 目的：拆 harness / content-pipeline / 未来任何 sub-graph 硬编码 'account1' 的坑，
 *      让账号治理统一收口到一个地方（account-usage.js）。
 *
 * @param {object} opts — executeInDocker 入口 opts（会 mutate opts.env）
 * @param {object} [ctx]
 * @param {string} [ctx.taskId] — 用于日志
 * @param {object} [ctx.deps]   — 测试注入 { isSpendingCapped, isAuthFailed, selectBestAccount }
 */
export async function resolveAccountForOpts(opts, ctx = {}) {
  opts.env = opts.env || {};
  try {
    const deps = ctx.deps || await import('./account-usage.js');
    const { isSpendingCapped, isAuthFailed, selectBestAccount } = deps;
    const explicit = opts.env.CECELIA_CREDENTIALS;
    const capped = explicit ? isSpendingCapped(explicit) : false;
    const authFailed = explicit ? isAuthFailed(explicit) : false;
    const needsFallback = !explicit || capped || authFailed;
    if (!needsFallback) return;
    const selection = await selectBestAccount({ cascade: opts.cascade });
    if (!selection || !selection.accountId) return;
    const taskId = ctx.taskId || opts.task?.id || 'unknown';
    if (explicit && explicit !== selection.accountId) {
      const reason = capped ? 'spending-capped' : (authFailed ? 'auth-failed' : 'unset');
      console.log(`[docker-executor] account rotation: ${explicit} ${reason} → ${selection.accountId} (task=${taskId})`);
    } else if (!explicit) {
      console.log(`[docker-executor] account selected: ${selection.accountId} model=${selection.model} (task=${taskId})`);
    }
    opts.env.CECELIA_CREDENTIALS = selection.accountId;
    if (selection.modelId && !opts.env.CLAUDE_MODEL_OVERRIDE) {
      opts.env.CECELIA_MODEL = selection.modelId;
    }
  } catch (err) {
    console.warn(`[docker-executor] account rotation middleware failed (keeping caller env): ${err.message}`);
  }
}

export async function executeInDocker(opts) {
  if (!opts || !opts.task || !opts.task.id) {
    throw new Error('executeInDocker: opts.task.id is required');
  }
  if (typeof opts.prompt !== 'string' || opts.prompt.length === 0) {
    throw new Error('executeInDocker: opts.prompt is required');
  }

  const taskId = opts.task.id;
  const taskType = opts.task.task_type || 'dev';
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;

  // 写 prompt 文件（宿主侧持久化，用于 debug / audit）
  writePromptFile(taskId, opts.prompt);

  // 账号轮换 middleware — 所有 spawn 自动享有"cap/auth fail fallback"。见 resolveAccountForOpts。
  opts.env = opts.env || {};
  await resolveAccountForOpts(opts, { taskId });

  const { args, _envFinal, name, memoryMB, cpuCores, image, cidfile } = buildDockerArgs(opts);
  const tier = resolveResourceTier(taskType);

  // --cidfile 要求文件不存在；之前残留的 cidfile 会让 docker run 立即失败
  if (cidfile && existsSync(cidfile)) {
    try { unlinkSync(cidfile); } catch { /* ignore */ }
  }

  // 记录 docker 命令（方便 forensic / 前端元数据展示）
  const command = `docker ${args.join(' ')}`;

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  console.log(
    `[docker-executor] spawn task=${taskId} type=${taskType} tier=${tier.tier} mem=${memoryMB}m cpus=${cpuCores} image=${image} container=${name}`
  );
  // DEBUG: harness_* 任务 spawn 时 dump full docker args（forensic 定位 skill 加载失败）
  if (String(taskType).startsWith('harness_')) {
    console.log('[docker-executor] FULL_ARGS:', JSON.stringify(args));
  }

  const result = await new Promise((resolve) => {
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
        container_id: null,
        command,
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
      // DEBUG: harness_* 任务 exit != 0 时 dump stdout + stderr 最后 2KB
      if (String(taskType).startsWith('harness_') && code !== 0) {
        console.log('[docker-executor] HARNESS_STDOUT_TAIL:', (stdout || '').slice(-2000));
        console.log('[docker-executor] HARNESS_STDERR_TAIL:', (stderr || '').slice(-2000));
      }
      const containerId = readContainerIdFromCidfile(cidfile);
      // cidfile 读完即可清理，保持 prompt_dir 整洁
      if (cidfile && existsSync(cidfile)) {
        try { unlinkSync(cidfile); } catch { /* ignore */ }
      }
      resolve({
        exit_code: code == null ? -1 : code,
        stdout,
        stderr,
        duration_ms: duration,
        container: name,
        container_id: containerId,
        command,
        timed_out: timedOut,
        started_at: startedAt,
        ended_at: endedAt,
      });
    });
  });

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
  cidFilePath,
  readContainerIdFromCidfile,
  envToArgs,
  writePromptFile,
  buildDockerArgs,
};
