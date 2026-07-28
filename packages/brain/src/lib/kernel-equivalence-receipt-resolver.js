import {
  EquivalenceReceiptError,
  expectedFromReceiptBundle,
  sha256Canonical,
  verifyReceiptBundle,
} from './kernel-equivalence-receipts.js';

const REFERENCE_PATTERN = /^receipt-bundle:([a-f0-9]{64})$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const CHAIN_FIELDS = Object.freeze([
  'genesis_hash',
  'head_hash',
  'schema_version',
]);

function fail(code, detail = null) {
  throw new EquivalenceReceiptError(code, detail);
}

export function createTrustedReceiptResolver({
  readBundle,
  trustRegistry,
  bundleChain,
  now = Date.now(),
} = {}) {
  if (typeof readBundle !== 'function') fail('receipt_reader_required');
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    fail('verification_time_invalid');
  }
  const chainFields = bundleChain && typeof bundleChain === 'object'
    ? Object.keys(bundleChain).sort()
    : [];
  if (
    chainFields.length !== CHAIN_FIELDS.length
    || chainFields.some((field, index) => field !== [...CHAIN_FIELDS].sort()[index])
    || bundleChain.schema_version !== 'kernel-equivalence-bundle-chain/v1'
    || !HASH_PATTERN.test(bundleChain.genesis_hash ?? '')
    || !HASH_PATTERN.test(bundleChain.head_hash ?? '')
  ) {
    fail('receipt_bundle_chain_invalid');
  }

  function readVerifiedHash(hash) {
    let raw;
    try {
      raw = readBundle(hash);
    } catch {
      fail('receipt_bundle_unavailable');
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      fail('receipt_bundle_unavailable');
    }
    if (sha256Canonical(raw) !== hash) {
      fail('receipt_bundle_hash_mismatch');
    }
    return raw;
  }

  function trustedAncestry(read) {
    const hashes = new Set();
    let currentHash = bundleChain.head_hash;
    let head = null;
    for (let depth = 0; depth < 100; depth += 1) {
      if (hashes.has(currentHash)) fail('receipt_bundle_chain_invalid');
      hashes.add(currentHash);
      const raw = read(currentHash);
      if (head == null) head = raw;
      if (raw.previous_bundle_hash == null) {
        if (currentHash !== bundleChain.genesis_hash) {
          fail('receipt_bundle_chain_invalid');
        }
        verifyReceiptBundle(
          head,
          trustRegistry,
          expectedFromReceiptBundle(head),
          {
            now,
            resolvePreviousBundle: read,
          },
        );
        return hashes;
      }
      if (!HASH_PATTERN.test(raw.previous_bundle_hash)) {
        fail('receipt_bundle_chain_invalid');
      }
      currentHash = raw.previous_bundle_hash;
    }
    fail('receipt_bundle_chain_invalid');
  }

  return function resolve(reference, expected) {
    const match = REFERENCE_PATTERN.exec(reference ?? '');
    if (!match) fail('receipt_reference_invalid');
    const expectedHash = match[1];
    const cache = new Map();
    const read = (hash) => {
      if (!cache.has(hash)) cache.set(hash, readVerifiedHash(hash));
      return cache.get(hash);
    };
    const raw = read(expectedHash);
    if (!trustedAncestry(read).has(expectedHash)) {
      fail('receipt_bundle_not_in_trusted_chain');
    }
    const verified = verifyReceiptBundle(
      raw,
      trustRegistry,
      expected,
      {
        now,
        resolvePreviousBundle: (hash) => {
          try {
            return read(hash);
          } catch {
            fail('receipt_bundle_unavailable');
          }
        },
      },
    );
    return Object.freeze({
      ...verified,
      bundle_hash: expectedHash,
      reference,
    });
  };
}
