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

const PORT = process.env.CODEX_BRIDGE_PORT || 3458;
// macOS + Tailscale bug: 绑定 0.0.0.0 时，Tailscale utun 进来的连接会被 RST
// 必须显式绑定到 Tailscale IP 才能正常接受来自 Tailscale 的连接
const BRIDGE_HOST = process.env.BRIDGE_HOST || '100.86.57.69';
const BRAIN_URL = process.env.BRAIN_URL || 'http://100.71.151.105:5221';
const CODEX_BIN = process.env.CODEX_BIN || '/opt/homebrew/bin/codex-bin';
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const RUNNER_TIMEOUT_MS = 25 * 60 * 1000; // 25 minutes for full /dev loop

// runner.sh 位置（cecelia monorepo）— 不同机器用户名不同，通过环境变量配置
const RUNNER_SH = process.env.RUNNER_SH
  || path.join(os.homedir(), 'repos/cecelia/packages/engine/runners/codex/runner.sh');
// 默认工作目录 — codex_dev 的 cwd
const WORK_DIR = process.env.WORK_DIR
  || path.join(os.homedir(), 'repos/cecelia');

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
 * 解析 HTTP 请求 body
 */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error(`JSON 解析失败: ${err.message}`));
      }
    });
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
  const { timeoutMs = RUNNER_TIMEOUT_MS, codexHomes } = options;

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
  const { workDir, sandbox = 'read-only', timeoutMs = DEFAULT_TIMEOUT_MS } = options;

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
  const { workDir, baseBranch = 'main', timeoutMs = DEFAULT_TIMEOUT_MS } = options;

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

const server = http.createServer(async (req, res) => {
  try {
    // POST /run — 通用执行端点（Brain executor 路由入口）
    if (req.method === 'POST' && req.url === '/run') {
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
        // 降级模式：本地选账号
        const account = await selectBestCodexAccount({ taskType: task_type || 'general' });
        if (!account) {
          sendJSON(res, 503, { ok: false, error: 'No available Codex accounts' });
          return;
        }
        primaryHome = account.codexHome;
        codexHomes = ACCOUNTS.map(id => path.join(os.homedir(), `.codex-${id}`)).join(':');
        console.log(`[codex-bridge] 本地账号模式: ${account.accountId}`);
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
        const account = await selectBestCodexAccount({ taskType: 'general' });
        if (!account) {
          sendJSON(res, 503, { ok: false, error: 'No available Codex accounts' });
          return;
        }
        execHome = account.codexHome;
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

      sendJSON(res, 202, { ok: true, task_id, account: account.accountId, status: 'dispatched' });

      const startTime = Date.now();
      try {
        const result = await executeCodexReview(account.codexHome, {
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
      }

    // GET /health — 健康检查
    } else if (req.method === 'GET' && req.url === '/health') {
      const { existsSync } = require('fs');
      const codexExists = existsSync(CODEX_BIN);

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
        accounts: accountSummary,
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
    sendJSON(res, 500, { ok: false, error: err.message });
  }
});

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
