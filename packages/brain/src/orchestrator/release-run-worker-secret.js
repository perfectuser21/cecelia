import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';

const PRIVATE_DIRECTORY_PREFIX = 'cecelia-release-worker-';
const PRIVATE_FILE_NAME = 'authority.json';
const DEFAULT_STALE_AFTER_MS = 2 * 60 * 60_000;

function assertPrivateReference(file) {
  if (
    !isAbsolute(file ?? '')
    || basename(file) !== PRIVATE_FILE_NAME
    || !basename(dirname(file)).startsWith(PRIVATE_DIRECTORY_PREFIX)
  ) {
    throw new Error('release_worker_private_reference_invalid');
  }
  const directory = dirname(file);
  const directoryStat = lstatSync(directory);
  const stat = lstatSync(file);
  const uid = process.getuid?.();
  if (
    !directoryStat.isDirectory()
    || directoryStat.isSymbolicLink()
    || (directoryStat.mode & 0o777) !== 0o700
    || (uid != null && directoryStat.uid !== uid)
    || !stat.isFile()
    || stat.isSymbolicLink()
    || (stat.mode & 0o777) !== 0o600
    || stat.nlink !== 1
    || (uid != null && stat.uid !== uid)
  ) {
    throw new Error('release_worker_private_reference_invalid');
  }
  return { directory, directoryStat, stat };
}

function openPrivateReference(file) {
  const before = assertPrivateReference(file);
  let descriptor;
  try {
    descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    const parentAfter = lstatSync(before.directory);
    if (
      !opened.isFile()
      || opened.nlink !== 1
      || opened.dev !== before.stat.dev
      || opened.ino !== before.stat.ino
      || parentAfter.dev !== before.directoryStat.dev
      || parentAfter.ino !== before.directoryStat.ino
    ) {
      throw new Error('release_worker_private_reference_invalid');
    }
    return { descriptor, ...before };
  } catch (error) {
    if (descriptor != null) closeSync(descriptor);
    if (error?.message === 'release_worker_private_reference_invalid') throw error;
    throw new Error('release_worker_private_reference_invalid', { cause: error });
  }
}

export function createPrivateReleaseWorkerConfig(value, {
  temporaryRoot = tmpdir(),
  now = () => new Date(),
} = {}) {
  const directory = mkdtempSync(join(temporaryRoot, PRIVATE_DIRECTORY_PREFIX));
  chmodSync(directory, 0o700);
  const file = join(directory, PRIVATE_FILE_NAME);
  try {
    writeFileSync(file, `${JSON.stringify(value)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    chmodSync(file, 0o600);
    const timestamp = now();
    utimesSync(file, timestamp, timestamp);
    utimesSync(directory, timestamp, timestamp);
    return { file };
  } catch (error) {
    try {
      unlinkSync(file);
    } catch {
      // The file may not have been created.
    }
    try {
      rmdirSync(directory);
    } catch {
      // Preserve the original write error.
    }
    throw error;
  }
}

export function readPrivateReleaseWorkerConfig(file) {
  const { descriptor } = openPrivateReference(file);
  let value;
  try {
    value = JSON.parse(readFileSync(descriptor, 'utf8'));
  } finally {
    closeSync(descriptor);
  }
  if (
    !value
    || typeof value.authorization !== 'string'
    || typeof value.deploy_token !== 'string'
    || !value.database
    || typeof value.database !== 'object'
  ) {
    throw new Error('release_worker_private_config_invalid');
  }
  return value;
}

export function createPrivateRollbackWorkerConfig(value, options) {
  if (
    !value
    || typeof value.rollback_authorization !== 'string'
    || !value.database
    || typeof value.database !== 'object'
    || Object.hasOwn(value, 'deploy_token')
    || Object.hasOwn(value, 'authorization')
  ) {
    throw new Error('release_rollback_worker_private_config_invalid');
  }
  return createPrivateReleaseWorkerConfig(value, options);
}

export function readPrivateRollbackWorkerConfig(file) {
  const { descriptor } = openPrivateReference(file);
  let value;
  try {
    value = JSON.parse(readFileSync(descriptor, 'utf8'));
  } finally {
    closeSync(descriptor);
  }
  if (
    !value
    || typeof value.rollback_authorization !== 'string'
    || !value.database
    || typeof value.database !== 'object'
    || Object.hasOwn(value, 'deploy_token')
    || Object.hasOwn(value, 'authorization')
  ) {
    throw new Error('release_rollback_worker_private_config_invalid');
  }
  return value;
}

export function cleanupPrivateReleaseWorkerConfig(file) {
  const opened = openPrivateReference(file);
  closeSync(opened.descriptor);
  const immediatelyBeforeUnlink = lstatSync(file);
  if (
    immediatelyBeforeUnlink.dev !== opened.stat.dev
    || immediatelyBeforeUnlink.ino !== opened.stat.ino
    || immediatelyBeforeUnlink.nlink !== 1
  ) {
    throw new Error('release_worker_private_reference_invalid');
  }
  unlinkSync(file);
  rmdirSync(opened.directory);
}

export function cleanupStalePrivateReleaseWorkerConfigs({
  temporaryRoot = tmpdir(),
  now = () => new Date(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
} = {}) {
  if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) {
    throw new Error('release_worker_stale_reaper_request_invalid');
  }
  let removed = 0;
  let entries = [];
  try {
    entries = readdirSync(temporaryRoot);
  } catch {
    return { removed };
  }
  if (!Array.isArray(entries)) return { removed };
  const nowMs = now().getTime();
  for (const entry of entries) {
    if (!entry.startsWith(PRIVATE_DIRECTORY_PREFIX)) continue;
    const file = join(temporaryRoot, entry, PRIVATE_FILE_NAME);
    try {
      const { directoryStat, stat } = assertPrivateReference(file);
      const newestMtime = Math.max(directoryStat.mtimeMs, stat.mtimeMs);
      if (nowMs - newestMtime < staleAfterMs) continue;
      cleanupPrivateReleaseWorkerConfig(file);
      removed += 1;
    } catch {
      // Never touch malformed, linked, foreign-owned, or active-looking paths.
    }
  }
  return { removed };
}

export const __test__ = {
  PRIVATE_DIRECTORY_PREFIX,
  PRIVATE_FILE_NAME,
  assertPrivateReference,
  openPrivateReference,
};
