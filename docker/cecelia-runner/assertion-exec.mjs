#!/usr/bin/env node

import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VITEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const PYTEST = /(^|\/)test_[^/]+\.py$/;
const SMOKE = /\/smoke\/[^/]+\.sh$/;
const SAFE_PATH = /^[A-Za-z0-9_./@+-]+$/;
const executorOwner = lstatSync(fileURLToPath(import.meta.url)).uid;

function fail(message, exitCode = 64) {
  process.stderr.write(`[assertion-exec] ${message}\n`);
  process.exit(exitCode);
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || isAbsolute(value)
    || !SAFE_PATH.test(value)) fail('unsafe assertion path');
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.startsWith('-'))) {
    fail('unsafe assertion path');
  }
  return value;
}

function shape(assertionId) {
  const raw = String(assertionId ?? '');
  if (raw.startsWith('manual:')) {
    const command = raw.slice(7).trim();
    const parts = command.split(/\s+/);
    if (parts.length === 4 && parts.slice(0, 3).join(' ') === 'npx vitest run'
      && VITEST.test(parts[3])) return { kind: 'vitest', path: parts[3] };
    if (parts.length === 4 && parts.slice(0, 3).join(' ') === 'python3 -m pytest'
      && PYTEST.test(parts[3])) return { kind: 'pytest', path: parts[3] };
    if (parts.length === 2 && parts[0] === 'bash' && SMOKE.test(parts[1])) {
      return { kind: 'bash', path: parts[1] };
    }
    fail('assertion command is not canonical');
  }
  if (VITEST.test(raw)) return { kind: 'vitest', path: raw };
  if (PYTEST.test(raw)) return { kind: 'pytest', path: raw };
  if (SMOKE.test(raw)) return { kind: 'bash', path: raw };
  fail('assertion is not runnable');
}

function canonical(shapeValue) {
  const path = safeRelativePath(shapeValue.path);
  if (shapeValue.kind === 'vitest') {
    return { command: `npx vitest run ${path}`, receiptArgv: ['npx', 'vitest', 'run', path] };
  }
  if (shapeValue.kind === 'pytest') {
    return { command: `python3 -m pytest ${path}`, receiptArgv: ['python3', '-m', 'pytest', path] };
  }
  return { command: `bash ${path}`, receiptArgv: ['bash', path] };
}

function trustedFile(path, label) {
  let real;
  try { real = realpathSync(path); } catch { fail(`${label} is unavailable`); }
  const info = lstatSync(real);
  if (!info.isFile() || (info.mode & 0o022) !== 0
    || (info.uid !== 0 && info.uid !== executorOwner)) {
    fail(`${label} is not owned by the runner image`);
  }
  return real;
}

function within(root, path) {
  const suffix = relative(root, path);
  return suffix !== '' && suffix !== '..' && !suffix.startsWith('../') && !isAbsolute(suffix);
}

function trackedAssertion(repoRoot, pathRef) {
  const candidate = resolve(repoRoot, pathRef);
  let target;
  try { target = realpathSync(candidate); } catch { fail('assertion path is unavailable'); }
  if (!within(repoRoot, target) || !lstatSync(target).isFile()) fail('assertion path escaped checkout');
  const trackedList = process.env.CECELIA_ASSERTION_TRACKED_PATHS_FILE;
  if (!trackedList || !isAbsolute(trackedList)) fail('trusted path manifest is missing');
  const manifestPath = trustedFile(trackedList, 'tracked path manifest');
  const tracked = new Set(readFileSync(manifestPath, 'utf8').split('\0').filter(Boolean));
  if (!tracked.has(pathRef)) fail('assertion path is not tracked');
  return target;
}

function findUp(start, root, suffix) {
  for (let current = start; within(root, current) || current === root; current = dirname(current)) {
    const candidate = join(current, suffix);
    if (existsSync(candidate)) return trustedFile(candidate, suffix);
    if (current === root) break;
  }
  fail(`${suffix} is unavailable`);
}

function execution(repoRoot, parsed) {
  const shapeValue = shape(parsed.assertion_id);
  const descriptor = canonical(shapeValue);
  if (parsed.command !== descriptor.command) fail('contract command differs from assertion identity');
  const target = trackedAssertion(repoRoot, shapeValue.path);
  if (shapeValue.kind === 'vitest') {
    const node = trustedFile(process.execPath, 'node');
    const vitest = findUp(dirname(target), repoRoot, 'node_modules/vitest/vitest.mjs');
    return { ...descriptor, executable: node, argv: [vitest, 'run', target, '--'] };
  }
  if (shapeValue.kind === 'pytest') {
    const python = trustedFile('/usr/bin/python3', 'python3');
    return { ...descriptor, executable: python, argv: ['-m', 'pytest', '--', target] };
  }
  return {
    ...descriptor,
    executable: trustedFile('/bin/bash', 'bash'),
    argv: [target],
  };
}

let assertion;
try { assertion = JSON.parse(process.argv[3] ?? ''); } catch { fail('invalid assertion JSON'); }
const repoRoot = realpathSync(process.cwd());
const command = execution(repoRoot, assertion);
if (process.argv[2] === '--describe') {
  process.stdout.write(`${JSON.stringify(command.receiptArgv)}\n`);
  process.exit(0);
}
if (process.argv[2] !== '--run') fail('expected --describe or --run');
const child = spawnSync(command.executable, command.argv, {
  cwd: repoRoot,
  env: {
    HOME: process.env.HOME ?? '/nonexistent',
    PATH: '/usr/local/bin:/usr/bin:/bin',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    DB_URL: process.env.DB_URL ?? '',
    BASELINE_SHA: process.env.BASELINE_SHA ?? '',
    CECELIA_TRUSTED_ASSERTION: process.env.CECELIA_TRUSTED_ASSERTION ?? '',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'safe.directory',
    GIT_CONFIG_VALUE_0: repoRoot,
    CECELIA_ASSERTION_TRACKED_PATHS_FILE:
      process.env.CECELIA_ASSERTION_TRACKED_PATHS_FILE ?? '',
  },
  stdio: 'inherit',
});
if (child.error) fail(child.error.message, 70);
process.exit(Number.isInteger(child.status) ? child.status : 70);
