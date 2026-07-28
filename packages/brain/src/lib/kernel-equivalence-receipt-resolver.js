import {
  EquivalenceReceiptError,
  sha256Canonical,
  verifyReceiptBundle,
} from './kernel-equivalence-receipts.js';

const REFERENCE_PATTERN = /^receipt-bundle:([a-f0-9]{64})$/;

function fail(code, detail = null) {
  throw new EquivalenceReceiptError(code, detail);
}

export function createTrustedReceiptResolver({
  readBundle,
  trustRegistry,
  now = Date.now(),
} = {}) {
  if (typeof readBundle !== 'function') fail('receipt_reader_required');

  return function resolve(reference, expected) {
    const match = REFERENCE_PATTERN.exec(reference ?? '');
    if (!match) fail('receipt_reference_invalid');
    const expectedHash = match[1];
    let raw;
    try {
      raw = readBundle(expectedHash);
    } catch {
      fail('receipt_bundle_unavailable');
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      fail('receipt_bundle_unavailable');
    }
    if (sha256Canonical(raw) !== expectedHash) {
      fail('receipt_bundle_hash_mismatch');
    }
    const verified = verifyReceiptBundle(
      raw,
      trustRegistry,
      expected,
      {
        now,
        resolvePreviousBundle: (hash) => {
          try {
            return readBundle(hash);
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
