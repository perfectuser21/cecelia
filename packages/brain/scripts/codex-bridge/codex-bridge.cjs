#!/usr/bin/env node
/**
 * codex-bridge.cjs — root receiver for Codex Slot broker receipts.
 *
 * The bridge never selects an account and never reads a company credential.
 * Broker/agent setup writes one root-owned receipt record per session under
 * CODEX_SLOT_RECEIPT_ROOT. /run accepts only a broker slot envelope and resolves
 * the already-prepared private CODEX_HOME from that record.
 */

const { createHash, randomUUID, timingSafeEqual } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execSync, spawn } = require('node:child_process');

const PORT = Number(process.env.CODEX_BRIDGE_PORT || 3458);
const BRIDGE_HOST = process.env.BRIDGE_HOST || '100.86.57.69';
const BRAIN_URL = process.env.BRAIN_URL || 'http://100.71.151.105:5221';
const CODEX_BIN = process.env.CODEX_BIN || '/opt/homebrew/bin/codex-bin';
const RUNNER_SH = process.env.RUNNER_SH
  || path.join(os.homedir(), 'repos/cecelia/packages/engine/runners/codex/runner.sh');
const WORK_DIR = process.env.WORK_DIR || path.join(os.homedir(), 'repos/cecelia');
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const RUNNER_TIMEOUT_MS = 25 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN_BODY_KEYS = new Set([
  'account_id',
  'account_ref',
  'accounts',
  'anthropic_api_key',
  'auth',
  'github_token',
  'token',
]);

function digest(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest();
}

function validBearer(req) {
  const expected = process.env.CODEX_SLOT_RECEIVER_TOKEN || '';
  const header = req.headers.authorization || '';
  const actual = header.startsWith('Bearer ') ? header.slice(7) : '';
  return expected.length > 0 && actual.length > 0
    && timingSafeEqual(digest(expected), digest(actual));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) req.destroy(new Error('request body too large'));
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function exactSlot(slot) {
  if (!slot || typeof slot !== 'object' || Array.isArray(slot)) return false;
  const keys = Object.keys(slot).sort();
  return keys.join(',') === 'agent_id,lease_id,receipt,session_id'
    && ['xian-m1', 'xian-m4'].includes(slot.agent_id)
    && UUID.test(slot.lease_id)
    && UUID.test(slot.session_id)
    && typeof slot.receipt === 'string'
    && slot.receipt.length >= 16
    && slot.receipt.length <= 512;
}

function validateRunRequest(body, req) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('request body must be an object');
  }
  for (const key of Object.keys(body)) {
    if (FORBIDDEN_BODY_KEYS.has(key)) throw new Error(`forbidden credential field: ${key}`);
  }
  if (typeof body.task_id !== 'string' || !body.task_id || typeof body.prompt !== 'string') {
    throw new Error('task_id and prompt are required');
  }
  if (!exactSlot(body.slot)) throw new Error('invalid codex-slot receipt envelope');
  const requestId = req.headers['idempotency-key'];
  if (typeof requestId !== 'string' || !UUID.test(requestId)) {
    throw new Error('invalid Idempotency-Key');
  }
  return requestId;
}

function resolveReceiptHome(slot) {
  const root = fs.realpathSync(process.env.CODEX_SLOT_RECEIPT_ROOT || '/var/run/cecelia/codex-slot/receipts');
  const recordPath = path.join(root, `${slot.session_id}.json`);
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  if (record.agent_id !== slot.agent_id
      || record.lease_id !== slot.lease_id
      || record.receipt !== slot.receipt
      || record.session_id !== slot.session_id) {
    throw new Error('codex-slot receipt mismatch');
  }
  const home = fs.realpathSync(record.private_home);
  if (!(home === root || home.startsWith(`${root}${path.sep}`))) {
    throw new Error('codex-slot private home escapes receipt root');
  }
  return home;
}

function receiptEnv(slot, home, extra = {}) {
  const env = {
    ...process.env,
    ...extra,
    CODEX_HOME: home,
    CODEX_SLOT_AGENT_ID: slot.agent_id,
    CODEX_SLOT_LEASE_ID: slot.lease_id,
    CODEX_SLOT_RECEIPT: slot.receipt,
    CODEX_SLOT_SESSION_ID: slot.session_id,
  };
  delete env.CODEX_HOMES;
  delete env.CODEX_RELAY_HOME;
  delete env.CODEX_REVIEW_HOME;
  delete env.OPENAI_API_KEY;
  return env;
}

function executeProcess(command, args, options) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    }, options.timeoutMs);
    child.on('error', error => {
      clearTimeout(timer);
      reject({ error: error.message, elapsed: Date.now() - started, stdout, stderr });
    });
    child.on('close', code => {
      clearTimeout(timer);
      const elapsed = Date.now() - started;
      if (timedOut) reject({ error: 'timeout', elapsed, stdout, stderr });
      else if (code !== 0) reject({ error: `exit_code_${code}`, elapsed, stdout, stderr });
      else resolve({ output: stdout.trim(), elapsed });
    });
  });
}

async function callbackBrain(taskId, checkpointId, status, output, durationMs) {
  const result = typeof output === 'string' ? output.slice(0, 50000) : JSON.stringify(output).slice(0, 50000);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${BRAIN_URL}/api/brain/execution-callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_id: taskId,
          checkpoint_id: checkpointId,
          status: status === 'completed' ? 'AI Done' : 'AI Failed',
          result,
          duration_ms: durationMs,
          executor: 'codex-bridge',
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) return;
    } catch {
      // Bounded callback retry; never expose receipt or environment in logs.
    }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

async function runAccepted(body, home) {
  const started = Date.now();
  try {
    const result = body.task_type === 'codex_dev'
      ? await executeProcess(
        'bash',
        [body.runner || RUNNER_SH, '--task-id', body.task_id, '--branch', body.branch],
        {
          cwd: body.work_dir || WORK_DIR,
          env: receiptEnv(body.slot, home, { BRAIN_API_URL: BRAIN_URL }),
          timeoutMs: body.timeout_ms || RUNNER_TIMEOUT_MS,
        },
      )
      : await executeProcess(
        CODEX_BIN,
        ['exec', body.prompt, '-s', body.sandbox || 'read-only'],
        {
          cwd: body.work_dir || process.cwd(),
          env: receiptEnv(body.slot, home),
          timeoutMs: body.timeout_ms || DEFAULT_TIMEOUT_MS,
        },
      );
    await callbackBrain(body.task_id, body.checkpoint_id, 'completed', result.output, result.elapsed);
  } catch (error) {
    await callbackBrain(
      body.task_id,
      body.checkpoint_id,
      'failed',
      `Error: ${error.error || error.message}`,
      error.elapsed || Date.now() - started,
    );
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/execute') {
      sendJSON(res, 410, { ok: false, error: 'retired; use codex-slot broker /run' });
      return;
    }
    if (req.method === 'POST' && req.url === '/execute-review') {
      sendJSON(res, 410, { ok: false, error: 'retired; use isolated CODEX_REVIEW_HOME' });
      return;
    }
    if (req.method === 'GET' && req.url === '/accounts') {
      sendJSON(res, 410, { ok: false, error: 'retired; usage comes from account_usage_cache' });
      return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      let dockerAvailable = false;
      try {
        execSync('docker info', { timeout: 3000, stdio: 'pipe' });
        dockerAvailable = true;
      } catch {
        // Health remains available when Docker is absent.
      }
      sendJSON(res, 200, {
        ok: true,
        status: fs.existsSync(CODEX_BIN) ? 'healthy' : 'degraded',
        codex_bin: fs.existsSync(CODEX_BIN) ? CODEX_BIN : 'NOT FOUND',
        docker_available: dockerAvailable,
      });
      return;
    }
    if (req.method !== 'POST' || req.url !== '/run') {
      sendJSON(res, 404, { ok: false, error: 'Not Found' });
      return;
    }
    if (!validBearer(req)) {
      sendJSON(res, 401, { ok: false, error: 'invalid receiver token' });
      return;
    }
    const body = await parseBody(req);
    validateRunRequest(body, req);
    const home = resolveReceiptHome(body.slot);
    const jobId = randomUUID();
    sendJSON(res, 202, {
      ok: true,
      status: 'accepted',
      job_id: jobId,
      task_id: body.task_id,
      slot: {
        agent_id: body.slot.agent_id,
        lease_id: body.slot.lease_id,
        receipt: body.slot.receipt,
        session_id: body.slot.session_id,
      },
    });
    void runAccepted(body, home);
  } catch (error) {
    sendJSON(res, 400, { ok: false, error: String(error.message || error).slice(0, 300) });
  }
});

module.exports = { exactSlot, receiptEnv, resolveReceiptHome, validateRunRequest };

if (require.main === module) {
  server.listen(PORT, BRIDGE_HOST, () => {
    console.log(`[codex-bridge] receiver listening ${BRIDGE_HOST}:${PORT}`);
  });
}
