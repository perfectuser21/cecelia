import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';

const PRIVATE_DIRECTORY_PREFIX = 'cecelia-release-worker-';
const PRIVATE_FILE_NAME = 'authority.json';

function assertPrivateReference(file) {
  if (
    !isAbsolute(file ?? '')
    || basename(file) !== PRIVATE_FILE_NAME
    || !basename(dirname(file)).startsWith(PRIVATE_DIRECTORY_PREFIX)
  ) {
    throw new Error('release_worker_private_reference_invalid');
  }
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) {
    throw new Error('release_worker_private_reference_invalid');
  }
}

export function createPrivateReleaseWorkerConfig(value) {
  const directory = mkdtempSync(join(tmpdir(), PRIVATE_DIRECTORY_PREFIX));
  chmodSync(directory, 0o700);
  const file = join(directory, PRIVATE_FILE_NAME);
  try {
    writeFileSync(file, `${JSON.stringify(value)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    chmodSync(file, 0o600);
    return { file };
  } catch (error) {
    try {
      rmdirSync(directory);
    } catch {
      // Preserve the original write error.
    }
    throw error;
  }
}

export function readPrivateReleaseWorkerConfig(file) {
  assertPrivateReference(file);
  const value = JSON.parse(readFileSync(file, 'utf8'));
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

export function cleanupPrivateReleaseWorkerConfig(file) {
  assertPrivateReference(file);
  const directory = dirname(file);
  unlinkSync(file);
  rmdirSync(directory);
}

export const __test__ = {
  PRIVATE_DIRECTORY_PREFIX,
  PRIVATE_FILE_NAME,
  assertPrivateReference,
};
