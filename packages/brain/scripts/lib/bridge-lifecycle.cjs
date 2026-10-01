'use strict';

const { spawn } = require('child_process');
const OUTPUT_LIMIT_BYTES = 1024 * 1024;
const KILL_GRACE_MS = 5000;

function positiveInt(value, fallback, maximum) {
  const parsed = (typeof value === 'number' || typeof value === 'string') ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(Math.floor(parsed), maximum) : fallback;
}

function safeRespond(res, statusCode, body) {
  if (res.destroyed || res.writableEnded || res.headersSent) return;
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** 每个Bridge独立计数；槽位包含等待SIGKILL/进程组退出的调用。 */
function createBridgeLifecycle() {
  const maxConcurrent = positiveInt(process.env.CECELIA_BRIDGE_MAX_CONCURRENT, 2, 4);
  const maxTimeout = positiveInt(process.env.CECELIA_BRIDGE_MAX_TIMEOUT_MS, 600000, 600000);
  const defaultTimeout = positiveInt(process.env.CECELIA_BRIDGE_TIMEOUT_MS, 120000, maxTimeout);
  const active = new Set();
  let stopping = false;
  let exiting = false;

  // 固定字段白名单：不记录prompt、账号配置、凭据或模型输出。
  function log(event, fields, warning = false) {
    console[warning ? 'warn' : 'log'](`[bridge] /llm-call ${event}`, { at: new Date().toISOString(), ...fields });
  }

  function exitIfDrained() {
    if (stopping && !exiting && active.size === 0) {
      exiting = true;
      process.exit(0);
    }
  }

  function run(req, res, { command, args, options, timeout, model, cleanup = () => {} }) {
    if (req.aborted || res.destroyed) { cleanup(); return; }
    if (stopping || active.size >= maxConcurrent) {
      cleanup();
      log('rejected', { reason: stopping ? 'shutdown' : 'capacity', active: active.size, limit: maxConcurrent }, true);
      safeRespond(res, 503, { ok: false, error: stopping ? 'Bridge shutting down' : 'Bridge LLM capacity exhausted' });
      return;
    }

    const startTime = Date.now();
    const timeoutMs = Math.min(positiveInt(timeout, defaultTimeout, maxTimeout), maxTimeout);
    // 在创建进程/定时器的现场验证范围，避免上游配置变更移除硬上限。
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000) {
      cleanup();
      safeRespond(res, 400, { ok: false, error: 'Invalid LLM timeout' });
      return;
    }
    let child;
    try {
      // 新进程组让所有未自行setsid的后代一起收尸；不使用spawn内建的单PID timeout。
      child = spawn(command, args, { ...options, detached: true });
    } catch (err) {
      cleanup();
      safeRespond(res, 500, { ok: false, error: err.message, elapsed_ms: Date.now() - startTime });
      return;
    }

    let responded = false;
    let released = false;
    let terminating = false;
    let terminationReason;
    let deadline;
    let graceTimer;
    let reapTimer;
    const output = { stdout: [], stderr: [] };
    const bytes = { stdout: 0, stderr: 0 };
    const record = { stop, forceKill: () => signalGroup('SIGKILL') };
    active.add(record);
    log('start', { pid: child.pid, model, timeout_ms: timeoutMs, active: active.size, limit: maxConcurrent });

    function reply(status, body) {
      if (responded) return;
      responded = true;
      clearTimeout(deadline);
      safeRespond(res, status, { ...body, elapsed_ms: Date.now() - startTime });
    }

    function groupAlive() {
      if (!Number.isInteger(child.pid) || child.pid <= 0) return false;
      try { process.kill(-child.pid, 0); return true; }
      catch (err) { return err.code !== 'ESRCH'; } // EPERM等不能证明组已退出。
    }

    function signalGroup(signal) {
      if (!Number.isInteger(child.pid) || child.pid <= 0 || released) return;
      try { process.kill(-child.pid, signal); }
      catch (err) {
        if (err.code !== 'ESRCH') console.error(`[bridge] group ${child.pid} ${signal}: ${err.message}`);
      }
    }

    function reap() {
      if (released || groupAlive()) return;
      released = true;
      clearTimeout(graceTimer);
      clearInterval(reapTimer);
      req.removeListener('aborted', disconnected);
      res.removeListener('close', responseClosed);
      active.delete(record);
      log('reaped', { pid: child.pid, reason: terminationReason, active: active.size });
      cleanup();
      exitIfDrained();
    }

    function terminate(reason) {
      if (released) return;
      if (!terminating) {
        terminating = true;
        terminationReason = reason;
        signalGroup('SIGTERM');
        // 不在leader的exit/close时取消升级：其孙进程可能仍在同组存活。
        graceTimer = setTimeout(() => {
          log('kill', { pid: child.pid, reason: terminationReason }, true);
          signalGroup('SIGKILL');
          reap();
        }, KILL_GRACE_MS);
        reapTimer = setInterval(reap, 100);
      }
      reap();
    }

    function stop() {
      reply(503, { ok: false, error: 'Bridge shutting down' });
      terminate('shutdown');
    }

    function disconnected() {
      responded = true;
      clearTimeout(deadline);
      terminate('client-disconnect');
    }

    function responseClosed() {
      // IncomingMessage.close也会在请求体正常读完时触发，不能用它取消推理。
      if (!res.writableEnded) disconnected();
    }

    req.once('aborted', disconnected);
    res.once('close', responseClosed);
    for (const stream of ['stdout', 'stderr']) {
      child[stream].on('data', (chunk) => {
        if (responded) return;
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (bytes[stream] + data.length > OUTPUT_LIMIT_BYTES) {
          output.stdout = []; output.stderr = [];
          reply(500, { ok: false, error: 'LLM output exceeded buffer limit' });
          terminate('output-limit');
          return;
        }
        bytes[stream] += data.length;
        output[stream].push(data);
      });
    }
    deadline = setTimeout(() => {
      log('timeout', { pid: child.pid, reason: 'timeout', model, elapsed_ms: Date.now() - startTime }, true);
      reply(200, { ok: false, status: 'timeout', degraded: true, message: 'LLM call timed out' });
      output.stdout = []; output.stderr = [];
      terminate('timeout');
    }, timeoutMs);

    // exit早于close；被孙进程继承的pipe可能让close永久不来。
    child.once('exit', () => terminate('leader-exit'));
    child.on('error', (err) => {
      reply(500, { ok: false, error: err.message });
      terminate('spawn-error');
    });
    child.once('close', (code) => {
      if (!responded) {
        if (code !== 0) {
          const stderr = Buffer.concat(output.stderr).toString('utf8');
          reply(500, { ok: false, error: stderr.slice(0, 500) || `exit code ${code}` });
        } else {
          reply(200, { ok: true, text: Buffer.concat(output.stdout).toString('utf8').trim(), model });
        }
      }
      output.stdout = []; output.stderr = [];
      terminate('close');
    });
  }

  function bindShutdown(server) {
    function shutdown() {
      if (stopping) return;
      stopping = true;
      server.close();
      server.closeIdleConnections?.();
      for (const record of active) record.stop();
      exitIfDrained();
    }
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
    process.once('SIGHUP', shutdown);
    // 正常exit/未捕获异常退出的最后兜底；SIGKILL由OS定义为不可捕获。
    process.once('exit', () => { for (const record of active) record.forceKill(); });
  }

  return { run, bindShutdown };
}

module.exports = { createBridgeLifecycle, safeRespond };
