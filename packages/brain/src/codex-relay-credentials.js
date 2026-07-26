import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const HEADLESS_CONTAINER_RE = /^cecelia-relay-[a-f0-9]{8}-cx-[a-f0-9]{8}$/;
const SAFE_SNAPSHOT_KEY_RE = /^[a-zA-Z0-9-]+$/;

export function codexRelaySnapshotRoot(env = process.env) {
  return env.CODEX_RELAY_SNAPSHOT_ROOT
    || join(env.HOST_HOME || homedir(), 'claude-output', 'codex-relay-credentials');
}

export function snapshotCodexRelayHome(codexHome, snapshotKey, env = process.env) {
  if (!SAFE_SNAPSHOT_KEY_RE.test(String(snapshotKey))) {
    throw new Error(`invalid codex relay snapshot key: ${snapshotKey}`);
  }
  const srcAuth = join(codexHome, 'auth.json');
  if (!existsSync(srcAuth)) {
    throw new Error(`CODEX_RELAY_HOME 下找不到 auth.json: ${srcAuth}`);
  }

  const root = codexRelaySnapshotRoot(env);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);

  // Headless runs use their unique callback/container identity verbatim so
  // callback cleanup can remove one exact direct child. Headed compatibility
  // keeps its task-id key unique with a timestamp and is not callback-cleaned.
  const dirName = HEADLESS_CONTAINER_RE.test(snapshotKey)
    ? snapshotKey
    : `${snapshotKey}-${Date.now()}`;
  const target = join(root, dirName);
  mkdirSync(target, { mode: 0o700 });

  try {
    // mkdir mode is filtered by process umask; force the contract before any
    // credential copy so even a restrictive service umask cannot create 000.
    chmodSync(target, 0o700);
    copyFileSync(srcAuth, join(target, 'auth.json'));
    chmodSync(join(target, 'auth.json'), 0o600);
    const srcConfig = join(codexHome, 'config.toml');
    if (existsSync(srcConfig)) {
      copyFileSync(srcConfig, join(target, 'config.toml'));
      chmodSync(join(target, 'config.toml'), 0o600);
    }
    return target;
  } catch (error) {
    try { chmodSync(target, 0o700); } catch { /* best-effort before cleanup */ }
    rmSync(target, { recursive: true, force: true });
    throw error;
  }
}

export function cleanupCodexRelayHome(containerId, env = process.env) {
  if (!HEADLESS_CONTAINER_RE.test(String(containerId))) return false;
  const root = resolve(codexRelaySnapshotRoot(env));
  const target = resolve(root, containerId);
  if (dirname(target) !== root || basename(target) !== containerId) return false;
  rmSync(target, { recursive: true, force: true });
  return true;
}

export function cleanupCodexRelaySnapshotsForTask(taskId, env = process.env) {
  const short = String(taskId).replaceAll('-', '').slice(0, 8).toLowerCase();
  if (!/^[a-f0-9]{8}$/.test(short)) return [];

  const root = codexRelaySnapshotRoot(env);
  if (!existsSync(root)) return [];
  const matcher = new RegExp(`^cecelia-relay-${short}-cx-[a-f0-9]{8}$`);
  const removed = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !matcher.test(entry.name)) continue;
    if (cleanupCodexRelayHome(entry.name, env)) removed.push(entry.name);
  }
  return removed;
}
