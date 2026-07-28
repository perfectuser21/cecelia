import {
  lstatSync,
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
    const path = join(directory, `${hash}.json`);
    let stat;
    let canonicalPath;
    try {
      stat = lstatSync(path);
      canonicalPath = realpathSync(path);
    } catch {
      fail('receipt_bundle_unavailable');
    }
    if (
      !stat.isFile()
      || stat.isSymbolicLink()
      || canonicalPath !== join(canonicalDirectory, `${hash}.json`)
      || !canonicalPath.startsWith(`${canonicalDirectory}/`)
    ) {
      fail('receipt_bundle_path_unsafe');
    }
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      fail('receipt_bundle_json_invalid');
    }
  };
}
