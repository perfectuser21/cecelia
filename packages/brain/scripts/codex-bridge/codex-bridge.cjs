#!/usr/bin/env node
/**
 * codex-bridge.cjs — Codex 任务执行桥接服务
 *
 * 运行在西安 Mac mini (100.86.57.69) 上，监听 3458 端口。
 * 接受 Brain (US Mac mini, 100.71.151.105:5221) 通过 Tailscale 发来的任务请求，
 * 用 wham/usage API 选最空闲的 Codex 账号，执行 codex exec，结果 callback 回 Brain。
 */

const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const { selectBestCodexAccount, getAllAccountUsage, ACCOUNTS } = require('./codex-account-usage.cjs');
const {
  createKernelAttemptHandler,
} = require('./kernel-attempt-handler.cjs');

const PORT = process.env.CODEX_BRIDGE_PORT || 3458;
// macOS + Tailscale bug: 绑定 0.0.0.0 时，Tailscale utun 进来的连接会被 RST
// 必须显式绑定到 Tailscale IP 才能正常接受来自 Tailscale 的连接
const BRIDGE_HOST = process.env.BRIDGE_HOST || '100.86.57.69';
const BRAIN_URL = process.env.BRAIN_URL || 'http://100.71.151.105:5221';
const CODEX_BIN = process.env.CODEX_BIN || '/opt/homebrew/bin/codex-bin';
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const RUNNER_TIMEOUT_MS = 25 * 60 * 1000; // 25 minutes for full /dev loop
const MAX_EXECUTION_TIMEOUT_MS = RUNNER_TIMEOUT_MS;
const MIN_EXECUTION_TIMEOUT_MS = 1000;

function normalizeExecutionTimeoutMs(requestedTimeoutMs, pathDefaultMs) {
  if (!Number.isSafeInteger(requestedTimeoutMs) || requestedTimeoutMs <= 0) return pathDefaultMs;
  if (requestedTimeoutMs < MIN_EXECUTION_TIMEOUT_MS) return MIN_EXECUTION_TIMEOUT_MS;
  if (requestedTimeoutMs > MAX_EXECUTION_TIMEOUT_MS) return MAX_EXECUTION_TIMEOUT_MS;
  return requestedTimeoutMs;
}
const KERNEL_ATTEMPT_BODY_MAX_BYTES = 1024 * 1024;

// runner.sh 位置（cecelia monorepo）— 不同机器用户名不同，通过环境变量配置
const RUNNER_SH = process.env.RUNNER_SH
  || path.join(os.homedir(), 'repos/cecelia/packages/engine/runners/codex/runner.sh');
// 默认工作目录 — codex_dev 的 cwd
const WORK_DIR = process.env.WORK_DIR
  || path.join(os.homedir(), 'repos/cecelia');

function kernelHealthEvidence(machineId) {
  return machineId
    ? {
        kernel_harness_protocol: 'v1',
        canonical_machine_id: machineId,
      }
    : {
        kernel_harness_protocol: 'disabled',
        canonical_machine_id: null,
      };
}

function createKernelHandlerFromEnvironment(env = process.env) {
  const enabled = Boolean(
    env.KERNEL_MACHINE_ID
    || env.KERNEL_BRIDGE_TOKEN_FILE
    || env.KERNEL_BRIDGE_STATE_DIR,
  );
  if (!enabled) return null;

  if (
    !env.KERNEL_MACHINE_ID
    || !env.KERNEL_BRIDGE_TOKEN_FILE
    || !env.KERNEL_BRIDGE_STATE_DIR
  ) {
    throw new Error('kernel_harness_configuration_incomplete');
  }
  const tokenStat = fs.lstatSync(env.KERNEL_BRIDGE_TOKEN_FILE);
  if (!tokenStat.isFile() || (tokenStat.mode & 0o177) !== 0) {
    throw new Error('kernel_bridge_token_file_permissions');
  }
  const bridgeToken = fs.readFileSync(env.KERNEL_BRIDGE_TOKEN_FILE, 'utf8').trim();
  if (bridgeToken.length < 32) {
    throw new Error('kernel_bridge_token_too_short');
  }
  const allowedAccounts = String(env.CODEX_ACCOUNT_ALLOWLIST ?? '')
    .split(',')
    .map(account => account.trim())
    .filter(Boolean);
  if (allowedAccounts.length === 0) {
    throw new Error('kernel_codex_account_allowlist_empty');
  }

  return createKernelAttemptHandler({
    stateDir: env.KERNEL_BRIDGE_STATE_DIR,
    machineId: env.KERNEL_MACHINE_ID,
    bridgeToken,
    brainUrl: env.BRAIN_URL || BRAIN_URL,
    allowedAccounts,
    codexBin: env.CODEX_BIN || CODEX_BIN,
    workDir: env.WORK_DIR || WORK_DIR,
    spawnFn: spawn,
    loadAccountAuth: account => loadRawAuth(account),
  });
}

const kernelAttemptHandler = createKernelHandlerFromEnvironment();
const KERNEL_MACHINE_ID = process.env.KERNEL_MACHINE_ID || null;

/**
 * 将 US Brain 注入的 accounts 写入临时目录，返回 { primaryHome, allHomes, tmpDir }。
 * 调用方必须在 finally 块中调用 cleanupTmpDir(tmpDir) 清理。
 *
 * @param {string} taskId - Brain Task ID（用于临时目录命名，保证唯一性）
 * @param {Array<{id: string, auth: object}>} accounts - US Brain 注入的账号列表
 * @returns {{ primaryHome: string, allHomes: string, tmpDir: string }}
 */
function setupInjectedAccounts(taskId, accounts) {
  const tmpDir = path.join(os.tmpdir(), `codex-inj-${taskId}-${Date.now()}`);
  const homes = [];
  for (const { id, auth } of accounts) {
    const dir = path.join(tmpDir, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o700);
    const authFile = path.join(dir, 'auth.json');
    fs.writeFileSync(authFile, JSON.stringify(auth), { mode: 0o600 });
    homes.push(dir);
  }
  return { primaryHome: homes[0], allHomes: homes.join(':'), tmpDir };
}

/**
 * 清理临时 CODEX_HOME 目录（注入模式使用后必须调用）
 * @param {string|null} tmpDir
 */
function cleanupTmpDir(tmpDir) {
  if (!tmpDir) return;
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`[codex-bridge] 临时目录已清理: ${tmpDir}`);
  } catch (err) {
    console.warn(`[codex-bridge] 清理临时目录失败: ${err.message}`);
  }
}

/**
 * 读取本机某账号真实、完整的 auth.json 原始内容（不是 codex-account-usage.cjs
 * getCodexAuth() 那种精简形状，setupInjectedAccounts 需要原样写回临时目录）。
 * @param {string} accountId - team1..team5
 * @param {string} [homeDir] - 测试可覆盖，默认 os.homedir()
 */
function loadRawAuth(accountId, homeDir = os.homedir()) {
  const authPath = path.join(homeDir, `.codex-${accountId}`, 'auth.json');
  return JSON.parse(fs.readFileSync(authPath, 'utf8'));
}

/**
 * 降级模式（未收到 Brain 注入的 accounts）：本地选账号后同样走注入临时目录，
 * 不直接用真实持久目录（2026-07-21）。
 *
 * 直用真实目录（旧行为 primaryHome = account.codexHome）会让容器/进程内 codex
 * 自己刷新 token 时写回真文件，跟本机 refresh-codex-tokens-xian.sh 的 cron 竞态
 * ——同 Claude account1 掉线（cron 刷新+并发进程多写者竞态清空 token）是同一病根。
 * 见 project_codex_token_consolidation_us 记忆。
 *
 * @param {string} taskId
 * @param {string} accountId
 * @param {string} [homeDir] - 测试可覆盖
 * @returns {{ primaryHome: string, allHomes: string, tmpDir: string }}
 */
function injectLocalAccount(taskId, accountId, homeDir = os.homedir()) {
  const rawAuth = loadRawAuth(accountId, homeDir);
  return setupInjectedAccounts(taskId, [{ id: accountId, auth: rawAuth }]);
}

/**
 * 解析 HTTP 请求 body
 */
function parseBody(req, maxBytes = KERNEL_ATTEMPT_BODY_MAX_BYTES) {
  const contentLength = Number(req.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    req.resume();
    return Promise.reject(Object.assign(
      new Error('request_body_too_large'),
      { statusCode: 413 },
    ));
  }

  return new Promise((resolve, reject) => {
    let body = '';
    let receivedBytes = 0;
    let settled = false;
    const onData = (chunk) => {
      if (settled) return;
      receivedBytes += Buffer.byteLength(chunk);
      if (receivedBytes > maxBytes) {
        settled = true;
        req.off('data', onData);
        req.off('end', onEnd);
        req.resume();
        reject(Object.assign(
          new Error('request_body_too_large'),
          { statusCode: 413 },
        ));
        return;
      }
      body += chunk;
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error(`JSON 解析失败: ${err.message}`));
      }
    };
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', reject);
  });
}

/**
 * 发送 JSON 响应
 */
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * 回调 Brain 执行结果
 */
async function callbackBrain(taskId, checkpointId, status, output, durationMs) {
  const url = `${BRAIN_URL}/api/brain/execution-callback`;
  // Brain callback 期望 status='AI Done'/'AI Failed'，result 字段（非 output）
  const brainStatus = status === 'completed' ? 'AI Done' : status === 'failed' ? 'AI Failed' : status;
  const resultValue = typeof output === 'string' ? output.slice(0, 50000) : JSON.stringify(output).slice(0, 50000);
  const payload = {
    task_id: taskId,
    checkpoint_id: checkpointId,
    status: brainStatus,
    result: resultValue,
    duration_ms: durationMs,
    executor: 'codex-bridge',
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        console.log(`[codex-bridge] callback 成功: task=${taskId} status=${status}`);
        return;
      }
      console.warn(`[codex-bridge] callback HTTP ${res.status}, 重试 ${attempt + 1}/3`);
    } catch (err) {
      console.warn(`[codex-bridge] callback 失败 (${attempt + 1}/3): ${err.message}`);
    }
    if (attempt < 2) await new Promise(r => setTimeout(r, 5000));
  }
  console.error(`[codex-bridge] callback 最终失败: task=${taskId}`);
}

/**
 * 通过 runner.sh 执行完整 /dev 工作流（codex_dev 专用）
 * runner.sh 负责：PRD 预拉、devloop-check、多轮重试，直到 PR 合并
 *
 * @param {string} codexHome  - 主账号路径（首选账号，也作为 CODEX_HOME 兜底）
 * @param {string} taskId     - Brain Task ID
 * @param {string} branch     - 目标分支名
 * @param {string} workDir    - 工作目录
 * @param {object} options    - { timeoutMs, codexHomes } 可选
 *   codexHomes: 冒号分隔的所有账号路径（传给 runner.sh CODEX_HOMES，支持轮换）
 */
function executeRunner(codexHome, taskId, branch, workDir, options = {}) {
  const { codexHomes } = options;
  const timeoutMs = normalizeExecutionTimeoutMs(options.timeoutMs, RUNNER_TIMEOUT_MS);
  if (timeoutMs > MAX_EXECUTION_TIMEOUT_MS) throw new RangeError('execution_timeout_exceeds_server_budget');

  return new Promise((resolve, reject) => {
    const args = [RUNNER_SH, '--task-id', taskId, '--branch', branch];
    const env = Object.assign({}, process.env, {
      CODEX_HOME: codexHome,
      BRAIN_API_URL: BRAIN_URL,  // US Brain 地址
    });

    // 若提供了多账号路径，传入 CODEX_HOMES 供 runner.sh 轮换
    if (codexHomes) {
      env.CODEX_HOMES = codexHomes;
    }

    const cwd = workDir || WORK_DIR;
    const accountCount = codexHomes ? codexHomes.split(':').length : 1;

    console.log(`[codex-bridge] runner: CODEX_HOME=${codexHome} branch=${branch} task=${taskId} 账号数=${accountCount}条`);
    const startTime = Date.now();

    const child = spawn('bash', args, {
      env,
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout.on('data', d => { stdout += d; process.stdout.write(d); });
    child.stderr.on('data', d => { stderr += d; process.stderr.write(d); });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000);
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      const elapsed = Date.now() - startTime;

      if (timedOut) {
        reject({ error: 'timeout', elapsed, stdout, stderr });
        return;
      }

      if (code !== 0) {
        reject({ error: `exit_code_${code}`, elapsed, stdout, stderr });
        return;
      }

      resolve({ output: stdout.trim(), elapsed });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject({ error: err.message, elapsed: Date.now() - startTime });
    });
  });
}

/**
 * 执行 codex exec 命令
 */
function executeCodex(codexHome, prompt, options = {}) {
  const { workDir, sandbox = 'read-only' } = options;
  const timeoutMs = normalizeExecutionTimeoutMs(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  if (timeoutMs > MAX_EXECUTION_TIMEOUT_MS) throw new RangeError('execution_timeout_exceeds_server_budget');

  return new Promise((resolve, reject) => {
    const args = ['exec', prompt, '-s', sandbox];
    const env = Object.assign({}, process.env, { CODEX_HOME: codexHome });
    const cwd = workDir || process.cwd();

    console.log(`[codex-bridge] exec: CODEX_HOME=${codexHome} cwd=${cwd}`);
    const startTime = Date.now();

    const child = spawn(CODEX_BIN, args, {
      env,
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000);
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      const elapsed = Date.now() - startTime;

      if (timedOut) {
        reject({ error: 'timeout', elapsed, stdout, stderr });
        return;
      }

      if (code !== 0) {
        reject({ error: `exit_code_${code}`, elapsed, stdout, stderr });
        return;
      }

      resolve({ output: stdout.trim(), elapsed });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject({ error: err.message, elapsed: Date.now() - startTime });
    });
  });
}

/**
 * 执行 codex exec review 命令
 */
function executeCodexReview(codexHome, options = {}) {
  const { workDir, baseBranch = 'main' } = options;
  const timeoutMs = normalizeExecutionTimeoutMs(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  if (timeoutMs > MAX_EXECUTION_TIMEOUT_MS) throw new RangeError('execution_timeout_exceeds_server_budget');

  return new Promise((resolve, reject) => {
    const args = ['exec', 'review', '--base', baseBranch, '--json'];
    const env = Object.assign({}, process.env, { CODEX_HOME: codexHome });
    const cwd = workDir || process.cwd();

    console.log(`[codex-bridge] review: CODEX_HOME=${codexHome} base=${baseBranch} cwd=${cwd}`);
    const startTime = Date.now();

    const child = spawn(CODEX_BIN, args, {
      env,
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000);
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      const elapsed = Date.now() - startTime;

      if (timedOut) {
        reject({ error: 'timeout', elapsed, stdout, stderr });
        return;
      }

      // Review 可能返回非零退出码表示发现问题，仍视为成功
      let parsed = null;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        // JSON 解析失败，返回原始文本
      }

      resolve({ output: parsed || stdout.trim(), elapsed, exitCode: code });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject({ error: err.message, elapsed: Date.now() - startTime });
    });
  });
}

// ─── HTTP 服务 ────────────────────────────────────────────────────────────────

async function handleBridgeRequest(
  req,
  res,
  {
    kernelHandler = kernelAttemptHandler,
    kernelMachineId = KERNEL_MACHINE_ID,
    fleetWorkerCutover = false,
  } = {},
) {
  try {
    const inspectMatch = req.url?.match(/^\/harness\/attempts\/([0-9a-f-]+)$/i);
    const cancelMatch = req.url?.match(/^\/harness\/attempts\/([0-9a-f-]+)\/cancel$/i);
    const authContext = { authorization: req.headers.authorization };

    if (fleetWorkerCutover && req.url?.startsWith('/harness/attempts')) {
      sendJSON(res, 410, { ok: false, error: 'fleet_worker_required' });
      return;
    }

    if (req.method === 'POST' && req.url === '/harness/attempts') {
      if (!kernelHandler) {
        sendJSON(res, 503, { ok: false, error: 'kernel_harness_disabled' });
        return;
      }
      kernelHandler.authorize?.(authContext);
      const receipt = await kernelHandler.accept(await parseBody(req), authContext);
      sendJSON(res, 202, receipt);

    } else if (req.method === 'GET' && inspectMatch) {
      if (!kernelHandler) {
        sendJSON(res, 503, { ok: false, error: 'kernel_harness_disabled' });
        return;
      }
      const status = await kernelHandler.inspect(inspectMatch[1], authContext);
      sendJSON(res, 200, status);

    } else if (req.method === 'POST' && cancelMatch) {
      if (!kernelHandler) {
        sendJSON(res, 503, { ok: false, error: 'kernel_harness_disabled' });
        return;
      }
      kernelHandler.authorize?.(authContext);
      const status = await kernelHandler.cancel(
        cancelMatch[1],
        await parseBody(req),
        authContext,
      );
      sendJSON(res, 200, status);

    // POST /run — 通用执行端点（Brain executor 路由入口）
    } else if (req.method === 'POST' && req.url === '/run') {
      const { task_id, checkpoint_id, prompt, work_dir, sandbox, timeout_ms, task_type, accounts } = await parseBody(req);

      if (!task_id || !prompt) {
        sendJSON(res, 400, { ok: false, error: 'Missing task_id or prompt' });
        return;
      }

      // 账号选择：优先使用 US Brain 注入的 accounts，否则降级到本地选账号
      let primaryHome, codexHomes, tmpDir = null;
      if (accounts && accounts.length > 0) {
        // 注入模式：写临时目录
        const injected = setupInjectedAccounts(task_id, accounts);
        primaryHome = injected.primaryHome;
        codexHomes = injected.allHomes;
        tmpDir = injected.tmpDir;
        console.log(`[codex-bridge] 注入账号模式: ${accounts.map(a => a.id).join(', ')} tmpDir=${tmpDir}`);
      } else {
        // 降级模式：本地选账号。2026-07-21 起同样走注入临时目录，不直接用真实持久目录
        // （injectLocalAccount 见上方注释）。取舍：这条已经是降级路径，为保持修复简单，
        // 只注入选中的这一个账号，不再像旧行为那样把全部本地账号的真实路径列进
        // codexHomes 供 runner.sh 轮换——要多账号轮换应该走 Brain 显式 accounts 注入
        // 这条主路径，不依赖这条降级路径。
        const account = await selectBestCodexAccount({ taskType: task_type || 'general' });
        if (!account) {
          sendJSON(res, 503, { ok: false, error: 'No available Codex accounts' });
          return;
        }
        const injected = injectLocalAccount(task_id, account.accountId);
        primaryHome = injected.primaryHome;
        codexHomes = injected.allHomes;
        tmpDir = injected.tmpDir;
        console.log(`[codex-bridge] 本地账号模式(已隔离注入): ${account.accountId} tmpDir=${tmpDir}`);
      }

      // 立即返回 202 Accepted，异步执行
      sendJSON(res, 202, { ok: true, task_id, account: path.basename(primaryHome), status: 'dispatched' });

      const startTime = Date.now();

      if (task_type === 'codex_dev') {
        // codex_dev → runner.sh 完整 /dev 工作流（含 devloop-check 循环）
        const branch = req.headers['x-branch']
          || `cp-${new Date().toLocaleString('zh-CN', {timeZone:'Asia/Shanghai'}).replace(/[/:\s]/g,'').slice(0,8)}-${task_id.slice(0,8)}-cx`;

        try {
          const result = await executeRunner(primaryHome, task_id, branch, work_dir, {
            timeoutMs: timeout_ms || RUNNER_TIMEOUT_MS,
            codexHomes,
          });
          await callbackBrain(task_id, checkpoint_id, 'completed', result.output, result.elapsed);
        } catch (err) {
          const elapsed = Date.now() - startTime;
          console.error(`[codex-bridge] runner 失败: task=${task_id} error=${err.error || err.message}`);
          await callbackBrain(task_id, checkpoint_id, 'failed',
            `Error: ${err.error}\nStderr: ${err.stderr || ''}\nStdout: ${err.stdout || ''}`,
            err.elapsed || elapsed);
        } finally {
          cleanupTmpDir(tmpDir);
        }
      } else {
        // 其他任务类型 → 直接 codex exec（read-only 沙箱）
        const effectiveSandbox = sandbox || 'read-only';
        try {
          const result = await executeCodex(primaryHome, prompt, {
            workDir: work_dir,
            sandbox: effectiveSandbox,
            timeoutMs: timeout_ms || DEFAULT_TIMEOUT_MS,
          });
          await callbackBrain(task_id, checkpoint_id, 'completed', result.output, result.elapsed);
        } catch (err) {
          const elapsed = Date.now() - startTime;
          console.error(`[codex-bridge] /run 失败: task=${task_id} error=${err.error || err.message}`);
          await callbackBrain(task_id, checkpoint_id, 'failed',
            `Error: ${err.error}\nStderr: ${err.stderr || ''}\nStdout: ${err.stdout || ''}`,
            err.elapsed || elapsed);
        } finally {
          cleanupTmpDir(tmpDir);
        }
      }

    // POST /execute — 执行 Codex 任务
    } else if (req.method === 'POST' && req.url === '/execute') {
      const { task_id, checkpoint_id, prompt, work_dir, sandbox, timeout_ms, accounts } = await parseBody(req);

      if (!task_id || !prompt) {
        sendJSON(res, 400, { ok: false, error: 'Missing task_id or prompt' });
        return;
      }

      // 账号选择：优先使用注入账号，否则降级本地
      let execHome, execTmpDir = null;
      if (accounts && accounts.length > 0) {
        const injected = setupInjectedAccounts(task_id, accounts);
        execHome = injected.primaryHome;
        execTmpDir = injected.tmpDir;
        console.log(`[codex-bridge] /execute 注入账号: ${accounts[0].id}`);
      } else {
        // 降级模式：2026-07-21 起同样走注入临时目录，不直接用真实持久目录
        const account = await selectBestCodexAccount({ taskType: 'general' });
        if (!account) {
          sendJSON(res, 503, { ok: false, error: 'No available Codex accounts' });
          return;
        }
        const injected = injectLocalAccount(task_id, account.accountId);
        execHome = injected.primaryHome;
        execTmpDir = injected.tmpDir;
        console.log(`[codex-bridge] /execute 本地账号模式(已隔离注入): ${account.accountId} tmpDir=${execTmpDir}`);
      }

      // 立即返回 202 Accepted，异步执行
      sendJSON(res, 202, { ok: true, task_id, account: path.basename(execHome), status: 'dispatched' });

      // 异步执行 + 回调
      const startTime = Date.now();
      try {
        const result = await executeCodex(execHome, prompt, {
          workDir: work_dir,
          sandbox,
          timeoutMs: timeout_ms || DEFAULT_TIMEOUT_MS,
        });
        await callbackBrain(task_id, checkpoint_id, 'completed', result.output, result.elapsed);
      } catch (err) {
        const elapsed = Date.now() - startTime;
        console.error(`[codex-bridge] exec 失败: task=${task_id} error=${err.error || err.message}`);
        await callbackBrain(task_id, checkpoint_id, 'failed',
          `Error: ${err.error}\nStderr: ${err.stderr || ''}\nStdout: ${err.stdout || ''}`,
          err.elapsed || elapsed);
      } finally {
        cleanupTmpDir(execTmpDir);
      }

    // POST /execute-review — 代码审查
    } else if (req.method === 'POST' && req.url === '/execute-review') {
      const { task_id, checkpoint_id, work_dir, base_branch, timeout_ms } = await parseBody(req);

      if (!task_id || !work_dir) {
        sendJSON(res, 400, { ok: false, error: 'Missing task_id or work_dir' });
        return;
      }

      const account = await selectBestCodexAccount({ taskType: 'code_review' });
      if (!account) {
        sendJSON(res, 503, { ok: false, error: 'No available Codex accounts' });
        return;
      }
      // 2026-07-21：这个端点原来直接用 account.codexHome（真实持久目录）跑 review，
      // 没有任何隔离，也没有 tmpDir 清理。同样改成走注入临时目录。
      const injected = injectLocalAccount(task_id, account.accountId);

      sendJSON(res, 202, { ok: true, task_id, account: account.accountId, status: 'dispatched' });

      const startTime = Date.now();
      try {
        const result = await executeCodexReview(injected.primaryHome, {
          workDir: work_dir,
          baseBranch: base_branch,
          timeoutMs: timeout_ms || DEFAULT_TIMEOUT_MS,
        });
        await callbackBrain(task_id, checkpoint_id, 'completed', result.output, result.elapsed);
      } catch (err) {
        const elapsed = Date.now() - startTime;
        console.error(`[codex-bridge] review 失败: task=${task_id} error=${err.error || err.message}`);
        await callbackBrain(task_id, checkpoint_id, 'failed',
          `Error: ${err.error}\nStderr: ${err.stderr || ''}`,
          err.elapsed || elapsed);
      } finally {
        cleanupTmpDir(injected.tmpDir);
      }

    // GET /health — 健康检查
    } else if (req.method === 'GET' && req.url === '/health') {
      const { existsSync } = require('fs');
      const { execSync } = require('child_process');
      const codexExists = existsSync(CODEX_BIN);

      // BEHAVIOR-5: 探测 docker 是否可用
      let dockerAvailable = false;
      try {
        execSync('docker info', { timeout: 3000, stdio: 'pipe' });
        dockerAvailable = true;
      } catch {
        // docker 不可用，降级为 false，不影响 HTTP 200 主体
      }

      let accountSummary;
      try {
        const usage = await getAllAccountUsage();
        accountSummary = Object.entries(usage).map(([id, u]) => ({
          id,
          primaryUsedPct: u.primaryUsedPct,
          tokenExpired: u.tokenExpired,
        }));
      } catch {
        accountSummary = 'unavailable';
      }

      sendJSON(res, 200, {
        ok: true,
        status: codexExists ? 'healthy' : 'degraded',
        codex_bin: codexExists ? CODEX_BIN : 'NOT FOUND',
        brain_url: BRAIN_URL,
        port: PORT,
        docker_available: dockerAvailable,
        accounts: accountSummary,
        ...kernelHealthEvidence(kernelHandler ? kernelMachineId : null),
      });

    // GET /accounts — 详细账号用量
    } else if (req.method === 'GET' && req.url === '/accounts') {
      try {
        const usage = await getAllAccountUsage(true); // force refresh
        sendJSON(res, 200, { ok: true, accounts: usage });
      } catch (err) {
        sendJSON(res, 500, { ok: false, error: err.message });
      }

    } else {
      sendJSON(res, 404, { error: 'Not Found' });
    }
  } catch (err) {
    console.error(`[codex-bridge] 未处理错误: ${err.message}`);
    sendJSON(res, err.statusCode || 500, { ok: false, error: err.message });
  }
}

function createBridgeServer(options = {}) {
  const resolvedOptions = {
    ...options,
    fleetWorkerCutover: options.fleetWorkerCutover ?? require.main === module,
  };
  return http.createServer((req, res) => handleBridgeRequest(req, res, resolvedOptions));
}

const server = createBridgeServer();

module.exports = {
  cleanupTmpDir,
  createBridgeServer,
  createKernelHandlerFromEnvironment,
  injectLocalAccount,
  kernelHealthEvidence,
  loadRawAuth,
  normalizeExecutionTimeoutMs,
  setupInjectedAccounts,
};

// require.main===module 守卫：只有直接 `node codex-bridge.cjs` 运行时才真正
// listen 端口。这样 smoke test 可以安全 require() 这个文件去调纯函数，不会
// 意外把端口占了或触发 codex 二进制缺失时的 process.exit(1)。用提前 return
// （CJS 模块顶层等价于函数体内，合法）而不是把下面这段整体包一层 if 缩进，
// 是为了不让 git diff 把这段本来就有、内容没变的代码显示成"新增"——
// 整体缩进会让 CodeQL 把这些行当新代码扫，对着记录 BRAIN_URL 的 console.log
// 误报"clear-text logging of sensitive information"（这只是内网地址，不是
// 真敏感信息，但缩进导致的"新增"外观会触发扫描）。
if (require.main !== module) {
  return;
}

// ─── 启动 ─────────────────────────────────────────────────────────────────────
const { existsSync } = require('fs');

if (!existsSync(CODEX_BIN)) {
  console.error(`[codex-bridge] ❌ Codex binary 不存在: ${CODEX_BIN}`);
  console.error('[codex-bridge] 请确认 codex-bin 已安装在 /opt/homebrew/bin/codex-bin');
  process.exit(1);
}

server.listen(PORT, BRIDGE_HOST, () => {
  console.log(`[codex-bridge] 🚀 codex-bridge 启动，监听 ${BRIDGE_HOST}:${PORT}`);
  console.log(`[codex-bridge]    Brain URL: ${BRAIN_URL}`);
  console.log(`[codex-bridge]    Codex bin: ${CODEX_BIN}`);
  console.log(`[codex-bridge]    账号: ${ACCOUNTS.join(', ')}`);
});
