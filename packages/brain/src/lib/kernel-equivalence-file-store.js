import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import {
  isAbsolute,
  join,
  resolve,
} from 'node:path';
import {
  EquivalenceReceiptError,
} from './kernel-equivalence-receipts.js';

const HASH_PATTERN = /^[a-f0-9]{64}$/;

function fail(code) {
  throw new EquivalenceReceiptError(code);
}

export function createReadOnlyBundleReader({ directory } = {}) {
  if (
    typeof directory !== 'string'
    || !isAbsolute(directory)
    || resolve(directory) !== directory
    || directory === '/'
  ) {
    fail('receipt_store_unsafe');
  }
  let directoryStat;
  let canonicalDirectory;
  try {
    directoryStat = lstatSync(directory);
    canonicalDirectory = realpathSync(directory);
  } catch {
    fail('receipt_store_unavailable');
  }
  if (
    !directoryStat.isDirectory()
    || directoryStat.isSymbolicLink()
  ) {
    fail('receipt_store_unsafe');
  }

  return function readBundle(hash) {
    if (!HASH_PATTERN.test(hash ?? '')) fail('receipt_reference_invalid');
    const path = join(canonicalDirectory, `${hash}.json`);
    let descriptor;
    let descriptorStat;
    let pathStat;
    let canonicalPath;
    try {
      descriptor = openSync(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      descriptorStat = fstatSync(descriptor);
      canonicalPath = realpathSync(path);
      pathStat = lstatSync(path);
    } catch (error) {
      if (descriptor != null) closeSync(descriptor);
      fail(
        error?.code === 'ENOENT'
          ? 'receipt_bundle_unavailable'
          : 'receipt_bundle_path_unsafe',
      );
    }
    if (
      !descriptorStat.isFile()
      || pathStat.isSymbolicLink()
      || descriptorStat.nlink !== 1
      || descriptorStat.dev !== pathStat.dev
      || descriptorStat.ino !== pathStat.ino
      || canonicalPath !== join(canonicalDirectory, `${hash}.json`)
      || !canonicalPath.startsWith(`${canonicalDirectory}/`)
    ) {
      closeSync(descriptor);
      fail('receipt_bundle_path_unsafe');
    }
    try {
      return JSON.parse(readFileSync(descriptor, 'utf8'));
    } catch {
      fail('receipt_bundle_json_invalid');
    } finally {
      closeSync(descriptor);
    }
  };
}
