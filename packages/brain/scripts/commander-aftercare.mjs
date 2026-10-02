#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, open, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { finishEscortAftercare } from '../src/commander-aftercare.js';

const execute = promisify(execFile);
const root = process.env.COMMANDER_AFTERCARE_DIR || join(homedir(), '.openclaw/commander-aftercare');
const self = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

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
    context.nonce = randomUUID();
    context.requestedAt = new Date().toISOString();
    await atomicJson(`${prefix}.request.json`, context);
    const output = await open(`${prefix}.log`, 'a', 0o600);
    const child = spawn(process.execPath, [self, '--worker', `${prefix}.request.json`], {
      detached: true, stdio: ['ignore', output.fd, output.fd], env: process.env,
    });
    await new Promise((accept, reject) => { child.once('spawn', accept); child.once('error', reject); });
    child.unref();
    await output.close();
    console.log(JSON.stringify({ status: 'requested', pid: child.pid, nonce: context.nonce }));
  } catch (error) { await unlink(`${prefix}.lock`); throw error; }
  finally { await lock.close(); }
}

async function worker(path) {
  const context = await readJson(path);
  const prefix = path.replace(/\.request\.json$/, '');
  if (resolve(path) !== resolve(join(root, `escort-${context.host}-${context.tag}.request.json`))) {
    throw Error('request-path-mismatch');
  }
  const result = await finishEscortAftercare(context, {
    now: () => performance.now(), timeoutMs: 20 * 60 * 1000, pollMs: 2000,
    sleep: ms => new Promise(accept => setTimeout(accept, ms)),
    readJobs: async () => JSON.parse(await cron('list', '--all', '--json')).jobs,
    readReceipt: () => readJson(`${prefix}.json`),
    requestTick: id => cron('run', id),
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
      if ((row.task || row).result?.commander_aftercare?.nonce !== context.nonce) throw Error('brain-readback-mismatch');
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
  await atomicJson(`${prefix}.result.json`, { ...result, at: new Date().toISOString(), actor: 'commander-aftercare-program' });
  await unlink(`${prefix}.lock`);
  console.log(JSON.stringify({ status: result.status, reason: result.reason }));
}

try {
  if (args[0] === '--enqueue') await enqueue();
  else if (args[0] === '--worker' && args[1]) await worker(args[1]);
  else throw Error('usage: commander-aftercare.mjs --enqueue < finalized-context.json');
} catch (error) { console.error(error.message); process.exitCode = 1; }
