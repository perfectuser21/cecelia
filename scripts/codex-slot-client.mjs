#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import { dirname } from 'node:path';

const AUTHORITY_FIELDS = new Set([
  'account',
  'account_ref',
  'accounts',
  'actor',
  'agent',
  'agent_id',
  'auth',
  'host',
  'team',
  'tenant',
  'token',
]);
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function usage(message = '') {
  if (message) process.stderr.write(`codex-slot: ${message}\n`);
  process.stderr.write(
    'usage: codex-slot start [--project <safe-segment>] [--name <safe-segment>]\n'
    + '       codex-slot stop <handle>\n',
  );
  process.exitCode = 64;
}

function normalizeFlag(flag) {
  return flag.replace(/^--/, '').replaceAll('-', '_');
}

export function parseCommand(argv) {
  const [command, ...args] = argv;
  for (const arg of args) {
    if (arg.startsWith('--') && AUTHORITY_FIELDS.has(normalizeFlag(arg.split('=', 1)[0]))) {
      throw new Error(`authority field is not accepted: ${arg}`);
    }
  }
  if (command === 'start') {
    const body = { project: 'default', name: 'codex' };
    for (let index = 0; index < args.length; index += 1) {
      const flag = args[index];
      if (!['--project', '--name'].includes(flag) || !args[index + 1]) {
        throw new Error(`invalid start argument: ${flag || '<missing>'}`);
      }
      const value = args[index + 1];
      if (!SAFE_SEGMENT.test(value)) throw new Error(`invalid safe segment: ${value}`);
      body[flag.slice(2)] = value;
      index += 1;
    }
    return { command, body };
  }
  if (command === 'stop' && args.length === 1 && args[0].length > 0) {
    return { command, handle: args[0] };
  }
  throw new Error('invalid command');
}

function commandArguments() {
  const forced = process.env.SSH_ORIGINAL_COMMAND;
  if (forced === undefined) return process.argv.slice(2);
  const trimmed = forced.trim();
  if (!trimmed || /[;&|`$<>(){}[\]*?!\n\r]/.test(trimmed)) {
    throw new Error('invalid forced command');
  }
  const parts = trimmed.split(/\s+/);
  if (parts[0] === 'codex-slot') parts.shift();
  return parts;
}

function clientConfig() {
  const token = process.env.CODEX_SLOT_BROKER_TOKEN || '';
  if (!token) throw new Error('CODEX_SLOT_BROKER_TOKEN is not configured');
  const forcedSsh = process.env.SSH_ORIGINAL_COMMAND !== undefined;
  const identityKind = process.env.CODEX_SLOT_IDENTITY_KIND || (forcedSsh ? 'ssh_key' : 'uid');
  const identityRef = process.env.CODEX_SLOT_IDENTITY_REF
    || (forcedSsh ? '' : String(process.getuid?.() ?? ''));
  if (!['uid', 'ssh_key'].includes(identityKind) || !identityRef) {
    throw new Error('root-owned identity mapping is not configured');
  }
  return {
    baseUrl: (process.env.CODEX_SLOT_BRAIN_URL || 'http://localhost:5221').replace(/\/$/, ''),
    token,
    identityKind,
    identityRef,
    stateFile: process.env.CODEX_SLOT_STATE_FILE || '/var/lib/cecelia-codex-slot/handles.json',
  };
}

async function loadHandles(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function saveHandles(path, handles) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(handles)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

async function callBroker(config, path, body, idempotencyKey = null) {
  const headers = {
    authorization: `Bearer ${config.token}`,
    'content-type': 'application/json',
    'x-codex-slot-identity-kind': config.identityKind,
    'x-codex-slot-identity-ref': config.identityRef,
  };
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  const response = await fetch(`${config.baseUrl}/api/brain/codex-slots${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true) {
    const code = payload?.error?.code || `HTTP_${response.status}`;
    const message = payload?.error?.message || 'invalid broker response';
    throw new Error(`${code}: ${message}`);
  }
  return payload;
}

async function main() {
  let command;
  try {
    command = parseCommand(commandArguments());
  } catch (error) {
    usage(error.message);
    return;
  }

  try {
    const config = clientConfig();
    const handles = await loadHandles(config.stateFile);
    if (command.command === 'start') {
      const response = await callBroker(config, '/acquire', command.body, randomUUID());
      handles[response.session.handle] = response.session.session_id;
      await saveHandles(config.stateFile, handles);
      process.stdout.write(`${response.session.handle}\n`);
      return;
    }

    const sessionId = handles[command.handle];
    if (!sessionId) throw new Error('unknown local session handle');
    const response = await callBroker(config, `/${encodeURIComponent(sessionId)}/stop`, {});
    if (response.session.status === 'stopped') {
      delete handles[command.handle];
      await saveHandles(config.stateFile, handles);
    }
    process.stdout.write(`${response.session.handle}\n`);
  } catch (error) {
    process.stderr.write(`codex-slot: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
