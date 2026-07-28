import { describe, expect, it, vi } from 'vitest';
import {
  createTrustedReceiptResolver,
} from '../kernel-equivalence-receipt-resolver.js';
import { sha256Canonical } from '../kernel-equivalence-receipts.js';
import {
  FIXTURE_NOW,
  createTrustFixture,
  fixtureBundle,
  fixtureCell,
  fixtureExpected,
  fixtureGrant,
  fixtureReceipt,
} from './kernel-equivalence-test-fixtures.js';

function fixture() {
  const keys = createTrustFixture();
  const cell = fixtureCell();
  const grant = fixtureGrant(keys, cell);
  const receipt = fixtureReceipt(keys, grant, cell);
  const bundle = fixtureBundle(keys, cell, grant, [receipt]);
  const hash = sha256Canonical(bundle);
  return { keys, cell, grant, receipt, bundle, hash };
}

describe('createTrustedReceiptResolver', () => {
  it('resolves a content-addressed raw bundle and re-verifies both signatures', () => {
    const value = fixture();
    const readBundle = vi.fn(() => structuredClone(value.bundle));
    const resolve = createTrustedReceiptResolver({
      readBundle,
      trustRegistry: value.keys.registry,
      now: FIXTURE_NOW,
    });

    expect(resolve(
      `receipt-bundle:${value.hash}`,
      fixtureExpected(value.cell, value.grant),
    )).toMatchObject({
      bundle_hash: value.hash,
      receipt_ids: [value.receipt.receipt_id],
    });
    expect(readBundle).toHaveBeenCalledExactlyOnceWith(value.hash);
  });

  it.each([
    ['path traversal', 'receipt-bundle:../../secret', 'receipt_reference_invalid'],
    ['absolute path', 'receipt-bundle:/tmp/secret', 'receipt_reference_invalid'],
    ['wrong digest', `receipt-bundle:${'f'.repeat(64)}`, 'receipt_bundle_hash_mismatch'],
  ])('rejects %s references', (_label, reference, code) => {
    const value = fixture();
    const resolve = createTrustedReceiptResolver({
      readBundle: () => structuredClone(value.bundle),
      trustRegistry: value.keys.registry,
      now: FIXTURE_NOW,
    });

    expect(() => resolve(
      reference,
      fixtureExpected(value.cell, value.grant),
    )).toThrowError(expect.objectContaining({ code }));
  });

  it('fails closed on missing or malformed raw bundles', () => {
    const value = fixture();
    for (const raw of [null, 'not-an-object']) {
      const resolve = createTrustedReceiptResolver({
        readBundle: () => raw,
        trustRegistry: value.keys.registry,
        now: FIXTURE_NOW,
      });
      expect(() => resolve(
        `receipt-bundle:${value.hash}`,
        fixtureExpected(value.cell, value.grant),
      )).toThrowError(expect.objectContaining({ code: 'receipt_bundle_unavailable' }));
    }
  });
});
