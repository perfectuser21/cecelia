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

/** Best-effort cleanup before a reclaimed attempt starts a new container generation. */
export function removeDockerContainer(containerId) {
  return new Promise((resolve) => {
    const proc = nodeSpawn('docker', ['rm', '-f', containerId], { stdio: ['ignore', 'ignore', 'ignore'] });
    proc.on('error', () => resolve(false));
    proc.on('exit', (code) => resolve(code === 0));
  });
}

// 注意：本文件**不再**自带本地 prompt 落盘函数 / 本地 prompt 目录常量。
// prompt 文件落盘路径必须由 buildDockerArgs 返回的 forensics.promptFile 决定——它与注入容器的
// CECELIA_PROMPT_FILE env 共享同一 runInstance（HOST_PROMPT_DIR 解析也同源）。若在此另写一份
// `${taskId}.prompt`（无 instance），容器按 env 找新名文件、磁盘上却只有旧名 → entrypoint
// `[[ -f $PROMPT_FILE ]]` 为假 → claude 报 "Input must be provided either through stdin or as a
// prompt argument" → exit 1，detached spawn（planner/generator/evaluator）全瘫（PR #3345 协议断裂根因）。

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

  // 先 buildDockerArgs 拿挂载 + env + forensics.promptFile（runInstance SSOT），
  // 再把 prompt 写到与容器 CECELIA_PROMPT_FILE env basename 完全一致的宿主路径。
  const built = buildDockerArgs(opts);

  // 持久化 prompt（容器按 env 读它）——路径 == forensics.promptFile，绝不自拼旧名。
  const promptFile = built.forensics.promptFile;
  const promptDir = path.dirname(promptFile);
  if (!existsSync(promptDir)) mkdirSync(promptDir, { recursive: true });
  writeFileSync(promptFile, opts.prompt, 'utf8');

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

  // Fix #5: spawn 可观测性 — 永挂 debug 实证 grep detached/containerId 全空，无法判断
  // docker run -d 到底有没有跑。打 containerId（before）+ dockerId（success）+ stderr（fail）。
  console.log(`[spawn-detached] docker run -d --name ${opts.containerId}`);

  return new Promise((resolve, reject) => {
    const proc = nodeSpawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => { stdout += c.toString(); });
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('error', (err) => {
      console.error(`[spawn-detached] docker run -d FAILED (spawn error) name=${opts.containerId}: ${err.message}`);
      reject(new Error(`docker spawn (detached) error: ${err.message}`));
    });
    proc.on('exit', (code) => {
      if (code === 0) {
        console.log(`[spawn-detached] spawned containerId=${opts.containerId} dockerId=${stdout.trim().slice(0, 12)}`);
        resolve({ containerId: opts.containerId, dockerStdout: stdout.trim() });
      } else {
        console.error(`[spawn-detached] docker run -d FAILED exit=${code} name=${opts.containerId} ${stderr.slice(0, 200)}`);
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

// 测试 hook（writePromptFile 已删除 —— prompt 落盘统一走 buildDockerArgs.forensics.promptFile）
export const __test__ = { buildDockerArgs };
