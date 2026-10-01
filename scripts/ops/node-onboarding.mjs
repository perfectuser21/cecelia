#!/usr/bin/env node
import { chmod, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { runCommand } from './node-onboarding-runner.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ERRORS = {
  INVALID_REQUEST: '节点接入参数不合法', HOST_KEY_MISMATCH: 'SSH 主机指纹与指定值不一致',
  CREDENTIAL_FAILED: '无法安全读取节点 SSH 凭据', CONNECT_FAILED: '可信 SSH 连接或 Python3 环境不可用',
  PROBE_FAILED: '节点系统探测失败', INSTALL_FAILED: '采集服务安装失败，请检查身份和服务管理环境',
  VERIFY_FAILED: '服务状态或连续健康样本未通过验收', TIMEOUT: '节点接入超过执行时限',
};
function fail(code) { const error = new Error(ERRORS[code]); error.safeCode = code; throw error; }

export function validateRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_REQUEST');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const dns = /^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  if (!uuid.test(value.id) || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(value.name)
    || typeof value.address !== 'string' || !(isIP(value.address) || dns.test(value.address))
    || !/^[a-zA-Z_][a-zA-Z0-9_-]{0,31}$/.test(value.ssh_user)
    || !Number.isInteger(value.ssh_port) || value.ssh_port < 1 || value.ssh_port > 65535
    || typeof value.credential_ref !== 'string' || !/^op:\/\/CS\/[^/\r\n\0]+\/[^/\r\n\0]+$/.test(value.credential_ref)
    || !/^SHA256:[A-Za-z0-9+/]{43}=?$/.test(value.host_key_fingerprint)
    || !['observer', 'worker', 'service', 'database'].includes(value.role)
    || !['enroll', 'sample'].includes(value.mode)
    || typeof value.region !== 'string' || value.region.length > 100 || /[\r\n\0]/.test(value.region)) fail('INVALID_REQUEST');
  return value;
}

export function verifySample(sample, request, probe, previous, now = Date.now()) {
  const h = sample?.health; const s = sample?.service; const observed = Date.parse(h?.observed_at);
  if (s?.enabled !== true || s.active !== true || h?.schema_version !== 1 || h.node_id !== request.id
    || h.agent_version !== '1' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(h.boot_id) || h.hostname !== probe.hostname || h.os !== probe.os
    || !Number.isSafeInteger(h.sequence) || h.sequence < 1 || !Number.isFinite(observed)
    || now - observed > 90000 || observed - now > 30000
    || h.capabilities?.collector !== true || h.capabilities?.janitor !== true || h.capabilities?.execution !== false
    || h.janitor?.policy !== 'owned-cache-only' || h.janitor?.mode !== 'observe') fail('VERIFY_FAILED');
  for (const key of ['memory_total_bytes', 'memory_available_bytes', 'cpu_load_1m', 'cpu_cores', 'disk_free_bytes', 'disk_total_bytes']) {
    if (typeof h.resources?.[key] !== 'number' || !Number.isFinite(h.resources[key]) || h.resources[key] < 0) fail('VERIFY_FAILED');
  }
  if (h.resources.memory_total_bytes <= 0 || h.resources.cpu_cores < 1 || h.resources.disk_total_bytes <= 0
    || h.resources.memory_available_bytes > h.resources.memory_total_bytes || h.resources.disk_free_bytes > h.resources.disk_total_bytes) fail('VERIFY_FAILED');
  if (previous && (h.boot_id !== previous.boot_id || h.sequence <= previous.sequence || observed <= Date.parse(previous.observed_at))) fail('VERIFY_FAILED');
  return h;
}

async function privateDirectory(path) {
  const full = resolve(path); const parents = []; let p = full;
  while (dirname(p) !== p) { parents.unshift(p); p = dirname(p); }
  for (const part of parents) {
    try { if ((await lstat(part)).isSymbolicLink()) fail('CREDENTIAL_FAILED'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await mkdir(full, { recursive: true, mode: 0o700 });
  if ((await lstat(full)).uid !== process.getuid()) fail('CREDENTIAL_FAILED');
  await chmod(full, 0o700);
  return full;
}

// 第一行固定启动器，第二行只承载 JSON 的 base64，不交给 shell 解释。
function remoteInput(payload, source) {
  const encoded = Buffer.from(JSON.stringify({ ...payload, remote_source: source })).toString('base64');
  return `import sys,base64,json; p=json.loads(base64.b64decode(sys.stdin.readline())); exec(compile(p.pop('remote_source'),'node-agent-remote.py','exec')); print(json.dumps(dispatch(p)))\n${encoded}\n`;
}

export async function onboard(input, dependencies = {}) {
  const runner = dependencies.runner || runCommand;
  let home = dependencies.home || homedir();
  const steps = []; let stage = 'connect'; let directory; let locked = false;
  const controller = new AbortController();
  const totalTimeoutMs = Math.min(175000, dependencies.totalTimeoutMs || 175000);
  const deadline = Date.now() + totalTimeoutMs;
  const timer = setTimeout(() => controller.abort(), totalTimeoutMs);
  const sleep = async ms => {
    if (!dependencies.sleep) return delay(ms, undefined, { signal: controller.signal });
    let abort;
    const cancelled = new Promise((_, reject) => {
      abort = () => reject(new Error('执行超时'));
      controller.signal.addEventListener('abort', abort, { once: true });
      if (controller.signal.aborted) abort();
    });
    try { return await Promise.race([dependencies.sleep(ms), cancelled]); }
    finally { controller.signal.removeEventListener('abort', abort); }
  };
  const stop = () => controller.abort();
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  let request;
  const receipt = { type: 'node_onboarding_receipt', id: typeof input?.id === 'string' ? input.id.slice(0, 64) : null,
    name: typeof input?.name === 'string' ? input.name.slice(0, 64) : null, mode: input?.mode === 'sample' ? 'sample' : 'enroll', verified: false, steps };
  const labels = { connect: '建立可信连接', probe: '探测节点环境', install: '安装观察服务', verify: '验收持续采集' };
  const done = () => steps.push({ key: stage, label: labels[stage], status: 'completed' });
  const call = async (command, args, options = {}) => {
    if (controller.signal.aborted || Date.now() >= deadline) fail('TIMEOUT');
    const result = await runner(command, args, { ...options, timeoutMs: Math.min(options.timeoutMs || 25000, deadline - Date.now()), signal: controller.signal });
    if (result.code !== 0) throw new Error('命令失败');
    return result.stdout;
  };
  try {
    request = validateRequest(input);
    home = await realpath(home);
    await privateDirectory(join(home, '.credentials'));
    const root = await privateDirectory(join(home, '.credentials/cecelia-onboarding'));
    directory = join(root, request.id);
    // 并发安装同一身份时拒绝进入，避免互相覆盖凭据。
    try { await mkdir(directory, { mode: 0o700 }); locked = true; } catch { fail('CREDENTIAL_FAILED'); }
    const key = join(directory, 'key'); const knownHosts = join(directory, 'known_hosts');
    try {
      const secret = await call('op', ['read', request.credential_ref], { timeoutMs: 15000 });
      if (!secret.trim()) fail('CREDENTIAL_FAILED');
      await writeFile(key, secret, { mode: 0o600, flag: 'wx' });
    } catch { fail('CREDENTIAL_FAILED'); }
    const scan = await call('ssh-keyscan', ['-T', '12', '-p', String(request.ssh_port), request.address]);
    const candidates = scan.split('\n').filter(line => line && !line.startsWith('#') && line.length < 8192);
    const trusted = [];
    for (const line of candidates.slice(0, 16)) {
      const file = join(directory, 'candidate');
      await writeFile(file, line + '\n', { mode: 0o600 });
      const fingerprint = await call('ssh-keygen', ['-lf', file, '-E', 'sha256']);
      if (fingerprint.trim().split(/\s+/)[1] === request.host_key_fingerprint.replace(/=$/, '')) trusted.push(line);
    }
    if (!trusted.length) fail('HOST_KEY_MISMATCH');
    await writeFile(knownHosts, trusted.join('\n') + '\n', { mode: 0o600, flag: 'wx' });
    const args = ['-F', '/dev/null', '-T', '-i', key, '-p', String(request.ssh_port),
      '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none', '-o', 'StrictHostKeyChecking=yes',
      '-o', `UserKnownHostsFile=${knownHosts}`, '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=12',
      '-o', 'ConnectionAttempts=1', '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2',
      '-o', 'PasswordAuthentication=no', '-o', 'KbdInteractiveAuthentication=no', '-o', 'ClearAllForwardings=yes',
      '-o', 'PermitLocalCommand=no', '-o', 'RequestTTY=no', '-l', request.ssh_user, request.address,
      "python3 -c 'import sys; exec(sys.stdin.readline())'"];
    const source = await readFile(join(HERE, 'node-agent-remote.py'), 'utf8');
    const remote = async (action, extra = {}) => JSON.parse(await call('ssh', args, { input: remoteInput({ action, id: request.id, ...extra }, source), timeoutMs: action === 'install' ? 80000 : 25000 }));
    const probe = await remote('probe'); done(); stage = 'probe';
    if (!['linux', 'darwin'].includes(probe.os) || typeof probe.hostname !== 'string' || !probe.hostname) fail('PROBE_FAILED');
    done();
    if (request.mode === 'enroll') { stage = 'install'; await remote('install', { collector: await readFile(join(HERE, 'node-agent.py'), 'utf8') }); done(); }
    stage = 'verify';
    // 服务刚启动时等待首份样本落地，仅重试读取，不接受失败样本。
    let first;
    for (let attempt = 0; attempt < 6; attempt++) {
      try { first = verifySample(await remote('sample'), request, probe); break; }
      catch (error) { if (attempt === 5 || request.mode === 'sample') throw error; await sleep(2000); }
    }
    await sleep(10500);
    const sample = await remote('sample');
    const health = verifySample(sample, request, probe, first);
    done(); return { ...receipt, verified: true, service: sample.service, health };
  } catch (error) {
    const error_code = controller.signal.aborted ? 'TIMEOUT' : (error.safeCode || ({ connect: 'CONNECT_FAILED', probe: 'PROBE_FAILED', install: 'INSTALL_FAILED', verify: 'VERIFY_FAILED' }[stage]));
    steps.push({ key: stage, label: labels[stage], status: 'failed' });
    return { ...receipt, error_code, error: ERRORS[error_code] };
  } finally {
    clearTimeout(timer); controller.abort(); process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
    if (locked) await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let request;
  try {
    const raw = process.env.TASK_ONBOARDING_REQUEST;
    if (!raw || raw.length > 16384 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) fail('INVALID_REQUEST');
    request = JSON.parse(Buffer.from(raw, 'base64').toString());
  } catch {}
  const result = await onboard(request);
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = result.verified ? 0 : 1;
}
