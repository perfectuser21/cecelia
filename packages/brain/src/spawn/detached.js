/**
 * detached.js — Detached docker spawn helper for Layer 3 spawn-interrupt 模式。
 *
 * 与 docker-executor.executeInDocker 区别：
 *   - executeInDocker: `docker run --rm` 阻塞，await 等容器跑完拿 stdout（旧反模式）。
 *   - spawnDockerDetached: `docker run -d` 后台跑，立即 return containerId。容器跑完
 *     自己 POST callback 给 brain（runner entrypoint 用 BRAIN_URL env），callback router
 *     反查 thread_lookup → Command(resume) 唤回 graph。这是 LangGraph 正确的 long-running
 *     async 任务模式（节点 spawn → interrupt → 等外部事件 resume）。
 *
 * 复用 buildDockerArgs 拼参数，把 `run --rm` 替换成 `run -d --name <containerId>` 即可。
 *
 * @param {Object} opts                — buildDockerArgs 兼容
 * @param {string} opts.containerId    — 必填，docker --name + cidfile lookup key
 * @returns {Promise<{containerId, dockerStdout}>}
 *   dockerStdout 是 docker run -d 输出（容器 ID 全长 64 hex）；containerId 是上层 caller 起的短名。
 *
 * 失败模式：
 *   - docker run -d 自己出错（image pull 失败 / args 非法）→ reject
 *   - 容器内进程跑挂 → 由 callback router 收到 exit_code != 0 走错误路径，不是这里的责任
 */
import { spawn as nodeSpawn } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { buildDockerArgs } from '../docker-executor.js';

const DEFAULT_PROMPT_DIR = process.env.CECELIA_PROMPT_DIR || '/tmp/cecelia-prompts';

/**
 * 写 prompt 到文件（detached spawn 不能走 stdin —— 容器后台跑无 stdio attach）。
 * 文件挂到容器 /tmp/cecelia-prompts/${TASK_ID}.prompt，entrypoint.sh 读它。
 */
function writePromptFile(taskId, prompt) {
  if (!existsSync(DEFAULT_PROMPT_DIR)) {
    mkdirSync(DEFAULT_PROMPT_DIR, { recursive: true });
  }
  const file = path.join(DEFAULT_PROMPT_DIR, `${taskId}.prompt`);
  writeFileSync(file, prompt, 'utf8');
  return file;
}

export async function spawnDockerDetached(opts) {
  if (!opts || !opts.task || !opts.task.id) {
    throw new Error('spawnDockerDetached: opts.task.id is required');
  }
  if (typeof opts.prompt !== 'string' || opts.prompt.length === 0) {
    throw new Error('spawnDockerDetached: opts.prompt is required');
  }
  if (!opts.containerId) {
    throw new Error('spawnDockerDetached: opts.containerId is required');
  }

  // 持久化 prompt（容器读它）
  writePromptFile(opts.task.id, opts.prompt);

  // 复用 buildDockerArgs 拿挂载 + env，拿到后改 --name 和移除 --rm 走后台
  const built = buildDockerArgs(opts);
  // built.args 含 ['run', '--rm', '--name', oldName, '--cidfile', cidfile, ...]
  // 我们替换为 ['run', '-d', '--name', containerId, ...]（detach 后不写 cidfile，避免名字冲突）
  const args = [];
  let i = 0;
  while (i < built.args.length) {
    const a = built.args[i];
    if (a === 'run') {
      args.push('run', '-d');
      i++;
      continue;
    }
    if (a === '--rm') {
      // detached 模式不要 --rm（callback router 之后 docker rm 主动清；--rm 容器结束就消失，
      // forensic 抓不到 docker logs）
      i++;
      continue;
    }
    if (a === '--name') {
      args.push('--name', opts.containerId);
      i += 2; // skip old name
      continue;
    }
    if (a === '--cidfile') {
      i += 2; // skip cidfile + path
      continue;
    }
    args.push(a);
    i++;
  }

  return new Promise((resolve, reject) => {
    const proc = nodeSpawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => { stdout += c.toString(); });
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('error', (err) => {
      reject(new Error(`docker spawn (detached) error: ${err.message}`));
    });
    proc.on('exit', (code) => {
      if (code === 0) {
        resolve({ containerId: opts.containerId, dockerStdout: stdout.trim() });
      } else {
        reject(new Error(`docker run -d exit_code=${code}: ${stderr.slice(0, 500)}`));
      }
    });
  });
}

/**
 * spawnCodexBridgeDetached — POST 到 xian-m4 Codex Bridge，非阻塞派发 harness 任务。
 *
 * Bridge 契约（POST bridgeUrl）：
 *   Request:  { task_id, task_type, callback_url, ...payload }
 *   Response: { status: "accepted", job_id: string }  (HTTP 200)
 *   Error:    { error: string }                        (HTTP 4xx/5xx)
 *
 * 校验：
 *   - HTTP status != 200 → throw（上层 spawnNode catch fallback 到 Docker）
 *   - response.status !== "accepted" → throw
 *   - typeof response.job_id !== "string" → throw
 *
 * @param {string} bridgeUrl     — Bridge /run endpoint（如 http://100.86.57.69:3458/run）
 * @param {Object} payload       — 必须含 task_id / task_type / callback_url
 * @param {Object} [opts]        — 可选：{ timeoutMs }
 * @returns {Promise<{status: "accepted", job_id: string}>}
 */
export async function spawnCodexBridgeDetached(bridgeUrl, payload, opts = {}) {
  const { timeoutMs = 10000 } = opts;

  const resp = await fetch(bridgeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!resp.ok) {
    let detail = '';
    try { detail = JSON.stringify(await resp.json()); } catch { /* ignore */ }
    throw new Error(`spawnCodexBridgeDetached: Bridge returned HTTP ${resp.status} — ${detail}`);
  }

  const data = await resp.json();

  if (data.status !== 'accepted') {
    throw new Error(
      `spawnCodexBridgeDetached: Bridge response missing status=accepted (got ${JSON.stringify(data.status)})`
    );
  }
  if (typeof data.job_id !== 'string') {
    throw new Error(
      `spawnCodexBridgeDetached: Bridge response job_id must be string (got ${typeof data.job_id})`
    );
  }

  return data;
}

// 测试 hook
export const __test__ = { writePromptFile };
