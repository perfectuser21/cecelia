#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { readFile, writeFile, mkdir, open, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { finishEscortAftercare, inspectAftercareRole } from '../src/commander-aftercare.js';

const execute = promisify(execFile);
const root = process.env.COMMANDER_AFTERCARE_DIR || join(homedir(), '.openclaw/commander-aftercare');
const self = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const canonicalDeadline = c => ({ ...c, deadlineAt: c.deadlineAt === undefined ? new Date(Date.parse(c.requestedAt) + 1200000).toISOString() : c.deadlineAt });

async function atomicJson(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temp, path);
}
async function cron(...argv) {
  return (await execute(process.env.COMMANDER_OPENCLAW_BIN || 'openclaw', ['cron', ...argv],
    { timeout: 100000, maxBuffer: 1024 * 1024 })).stdout;
}
async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function input() {
  let value = '';
  for await (const chunk of process.stdin) {
    value += chunk;
    if (value.length > 32768) throw Error('context-too-large');
  }
  return JSON.parse(value);
}
async function enqueue() {
  const context = await input();
  if (context.finalized !== true || !uuid.test(context.taskId || '')
    || !uuid.test(context.escortId || '') || !['host', 'tag'].every(key =>
      typeof context[key] === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(context[key]))) {
    throw Error('invalid-finalize-context');
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  const prefix = join(root, `escort-${context.host}-${context.tag}`);
  const lock = await open(`${prefix}.lock`, 'wx', 0o600);
  try {
    const prior = await readJson(`${prefix}.request.json`);
    if (prior) {
      const mutable = new Set(['nonce', 'requestedAt', 'deadlineAt', 'operationId', 'generation', 'cancellationRetries']);
      if (Object.entries(context).some(([key, value]) => !mutable.has(key) && !isDeepStrictEqual(value, prior[key]))) throw Error('existing-request-context-mismatch');
    }
    context.nonce = randomUUID();
    context.requestedAt = new Date().toISOString();
    context.deadlineAt = new Date(Date.parse(context.requestedAt) + 20 * 60 * 1000).toISOString();
    if (prior) {
      if (!Number.isFinite(Date.parse(prior.requestedAt))) throw Error('missing-original-requested-at');
      Object.assign(context, prior);
      context.deadlineAt = prior.deadlineAt || new Date(Date.parse(prior.requestedAt) + 20 * 60 * 1000).toISOString();
    }
    let workerId;
    if (process.env.COMMANDER_AFTERCARE_AUTHORITY_MODULE) {
      workerId = randomUUID();
      await writeFile(`${prefix}.lock`, JSON.stringify({ nonce: context.nonce, workerId }));
    }
    await atomicJson(`${prefix}.request.json`, context);
    const output = await open(`${prefix}.log`, 'a', 0o600);
    const child = spawn(process.execPath, [self, '--worker', `${prefix}.request.json`, ...(workerId ? ['--lease', workerId] : [])], {
      detached: true, stdio: ['ignore', output.fd, output.fd], env: process.env,
    });
    await new Promise((accept, reject) => { child.once('spawn', accept); child.once('error', reject); });
    child.unref();
    await output.close();
    console.log(JSON.stringify({ status: 'requested', pid: child.pid, nonce: context.nonce }));
  } catch (error) { await unlink(`${prefix}.lock`); throw error; }
  finally { await lock.close(); }
}

async function worker(path, expectedLease) {
  let context = await readJson(path);
  const prefix = path.replace(/\.request\.json$/, '');
  if (resolve(path) !== resolve(join(root, `escort-${context.host}-${context.tag}.request.json`))) {
    throw Error('request-path-mismatch');
  }
  let adapter, lease;
  if (process.env.COMMANDER_AFTERCARE_AUTHORITY_MODULE) {
    // factory提供refreshContext与withGenerationFence；后者必须与role接班共用
    // durable CAS/fence，并独占await完一次callback。仅包短操作，不占20min worker。
    const module = process.env.COMMANDER_AFTERCARE_AUTHORITY_MODULE;
    if (!isAbsolute(module) || !/\.m?js$/.test(module)) throw Error('invalid-authority-module');
    const { createAftercareAuthority } = await import(pathToFileURL(module).href);
    if (typeof createAftercareAuthority !== 'function') throw Error('invalid-authority-factory');
    const authority = await createAftercareAuthority({ requestPath: path, prefix });
    if (typeof authority?.refreshContext !== 'function' || typeof authority?.withGenerationFence !== 'function') throw Error('incomplete-generation-authority');
    const fence = authority.withGenerationFence.bind(authority);
    adapter = { refreshContext: authority.refreshContext.bind(authority), withGenerationFence: async (token, action) => {
      let called = false, completed = false, open = true, value;
      try {
        await fence(token, async () => {
          if (!open || called) throw Error('invalid-generation-fence-callback');
          called = true; value = await action(); completed = true; return value;
        });
      } finally { open = false; }
      if (!called || !completed) throw Error('generation-fence-not-executed');
      return value;
    } };
    lease = await readJson(`${prefix}.lock`);
    if (typeof lease?.workerId !== 'string' || lease.workerId !== expectedLease) throw Error('foreign-aftercare-lease');
  }
  async function preserve(file, value) {
    const old = await readJson(file);
    if (old && !isDeepStrictEqual(old, value)) throw Error('archive-mismatch');
    if (!old) await atomicJson(file, value);
  }
  async function applyTransition(t) {
    const stable = value => Object.fromEntries(Object.entries(canonicalDeadline(value)).filter(([key]) =>
      !['escortId', 'generation', 'operationId', 'nonce'].includes(key)));
    const start = Date.parse(t.previous?.requestedAt), deadline = start + 20 * 60 * 1000;
    if (!isDeepStrictEqual(stable(t.previous), stable(t.next)) || !uuid.test(t.next?.escortId || '')
      || !Number.isSafeInteger(t.next?.generation) || t.next.generation < 1
      || typeof t.next.operationId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(t.next.operationId)
      || typeof t.next.nonce !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(t.next.nonce)
      || t.lease?.nonce !== t.previous?.nonce || !Number.isFinite(start)
      || Date.parse(t.next.deadlineAt) !== deadline || Date.now() < start || Date.now() >= deadline
      || t.previous.generation !== undefined && (t.next.generation <= t.previous.generation
        || t.next.escortId === t.previous.escortId || t.next.nonce === t.previous.nonce)) throw Error('invalid-generation-transition');
    const jobs = JSON.parse(await cron('list', '--all', '--json')).jobs;
    if (!inspectAftercareRole(jobs, t.next) || Date.now() >= deadline) throw Error('unverified-transition-role');
    const archive = `${prefix}.archive.${t.previous.operationId || t.previous.nonce}`;
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(t.previous.operationId || t.previous.nonce)) throw Error('invalid-archive-identity');
    await preserve(`${archive}.request.json`, t.previous);
    if (t.receipt) await preserve(`${archive}.receipt.json`, t.receipt);
    const ack = await readJson(`${prefix}.json`);
    if (ack && !isDeepStrictEqual(ack, t.receipt)) throw Error('transition-receipt-changed');
    if (ack) await unlink(`${prefix}.json`);
    await atomicJson(path, t.next);
    lease = { ...t.lease, nonce: t.next.nonce };
    await atomicJson(`${prefix}.lock`, lease);
    context = t.next;
    await unlink(`${prefix}.transition.json`);
  }
  if (adapter) {
    const transition = await readJson(`${prefix}.transition.json`);
    if (transition) {
      if (transition.lease.workerId !== expectedLease
        || ![transition.previous.nonce, transition.next.nonce].includes(lease.nonce)
        || ![transition.previous, transition.next].some(c => isDeepStrictEqual(canonicalDeadline(c), canonicalDeadline(context)))) throw Error('foreign-transition-lease');
      await adapter.withGenerationFence({ context: transition.next, generation: transition.next.generation,
        operationId: transition.next.operationId, operation: 'recoverContext' }, async () => {
        const liveLease = await readJson(`${prefix}.lock`), request = await readJson(path);
        if (!isDeepStrictEqual(liveLease, lease) || !isDeepStrictEqual(request, context)) throw Error('stale-transition-worker');
        await applyTransition(transition);
      });
    }
    if (lease.nonce !== context.nonce) throw Error('foreign-aftercare-lease');
  }
  async function ownLease() {
    if (!adapter) return;
    const liveLease = await readJson(`${prefix}.lock`), request = await readJson(path);
    if (!isDeepStrictEqual(liveLease, lease) || !request
      || ['nonce', 'escortId', 'operationId', 'generation'].some(key => request[key] !== context[key])) throw Error('stale-aftercare-worker');
  }
  if (adapter && !context.requestedAt) throw Error('missing-original-requested-at');
  if (!context.requestedAt) context.requestedAt = new Date().toISOString();
  if (!context.deadlineAt) context.deadlineAt = new Date(Date.parse(context.requestedAt) + 20 * 60 * 1000).toISOString();
  if (!adapter) await atomicJson(path, context);
  const budget = await readJson(`${prefix}.retry.json`);
  if (budget && (budget.requestedAt !== context.requestedAt || budget.deadlineAt !== context.deadlineAt
    || !Number.isSafeInteger(budget.count) || budget.count < 0 || budget.count > 2)) throw Error('invalid-cancellation-budget');
  const authorityDeps = adapter ? {
    refreshContext: c => adapter.refreshContext(c),
    withGenerationFence: (token, action) => adapter.withGenerationFence(token, async () => {
      await ownLease(); return action();
    }),
    persistContext: async next => {
      // nonce在shared fence中创建；旧worker和旧lease不能覆盖新请求。
      await ownLease();
      const transition = { previous: await readJson(path), next, lease, receipt: await readJson(`${prefix}.json`) };
      await atomicJson(`${prefix}.transition.json`, transition);
      await applyTransition(transition);
      return next;
    },
  } : {};
  const result = await finishEscortAftercare(context, {
    now: () => performance.now(), timeoutMs: 20 * 60 * 1000, pollMs: 2000,
    wallNow: () => Date.now(), ...authorityDeps,
    cancellationRetries: budget?.count ?? context.cancellationRetries ?? 0,
    persistRetry: async (_c, count) => {
      await ownLease();
      await atomicJson(`${prefix}.retry.json`, { count, requestedAt: context.requestedAt, deadlineAt: context.deadlineAt });
    },
    sleep: ms => new Promise(accept => setTimeout(accept, ms)),
    readJobs: async () => JSON.parse(await cron('list', '--all', '--json')).jobs,
    readReceipt: () => readJson(`${prefix}.json`),
    requestTick: id => cron('run', id),
    resumeJob: id => cron('enable', id),
    quiesceJob: id => cron('disable', id),
    recordAftercare: async receipt => {
      const url = `${(context.brainUrl || 'http://localhost:5221').replace(/\/$/, '')}/api/brain/tasks/${context.taskId}`;
      const response = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result: { commander_aftercare: { ...receipt, recorded_at: new Date().toISOString() } } }),
        signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error(`brain-record-${response.status}`);
      const verified = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!verified.ok) throw Error(`brain-readback-${verified.status}`);
      const row = await verified.json();
      const { recorded_at, ...readback } = (row.task || row).result?.commander_aftercare || {};
      if (!isDeepStrictEqual(readback, receipt)) throw Error('brain-readback-mismatch');
    },
    removeJob: async id => {
      await cron('rm', id);
      const jobs = JSON.parse(await cron('list', '--all', '--json')).jobs;
      if (!Array.isArray(jobs) || jobs.some(job => job.id === id)) throw Error('cron-removal-unconfirmed');
      if (context.executionHost && context.idFile) {
        if (!/^[a-zA-Z0-9@._-]+$/.test(context.executionHost)
          || !/^\/[a-zA-Z0-9/._-]+$/.test(context.idFile)) throw Error('unsafe-id-file-context');
        await execute('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', context.executionHost,
          `test "$(cat '${context.idFile}' 2>/dev/null)" != '${id}' || rm -f '${context.idFile}'`], { timeout: 20000 });
      }
    },
  });
  const finish = async () => {
    await ownLease();
    if (adapter) {
      const jobs = JSON.parse(await cron('list', '--all', '--json')).jobs;
      const absent = Array.isArray(jobs) && !jobs.some(job => job.id === context.escortId
        || job.name === `escort-${context.host}-${context.tag}`);
      if (result.status === 'retired' ? !absent : !inspectAftercareRole(jobs, context)) throw Error('unverified-result-role');
    }
    await atomicJson(`${prefix}.result.json`, { ...result, nonce: context.nonce,
      escortId: context.escortId, generation: context.generation, operationId: context.operationId,
      requestedAt: context.requestedAt, deadlineAt: context.deadlineAt,
      at: new Date().toISOString(), actor: 'commander-aftercare-program' });
    await unlink(`${prefix}.lock`);
  };
  if (adapter) {
    try { await adapter.withGenerationFence({ context, generation: context.generation,
      operationId: context.operationId, operation: 'writeResult' }, finish); }
    catch { console.log(JSON.stringify({ status: 'retained', reason: 'stale-result-or-lease' })); return; }
  } else await finish();
  console.log(JSON.stringify({ status: result.status, reason: result.reason }));
}

try {
  if (args[0] === '--enqueue') await enqueue();
  else if (args[0] === '--worker' && args[1]) await worker(args[1], args[2] === '--lease' ? args[3] : undefined);
  else throw Error('usage: commander-aftercare.mjs --enqueue < finalized-context.json');
} catch (error) { console.error(error.message); process.exitCode = 1; }
