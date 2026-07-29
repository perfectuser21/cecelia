import { describe, expect, it, vi } from 'vitest';
import {
  createTrustedReceiptResolver,
  loadTrustedReceiptResolver,
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

function chainFixture(length = 4) {
  const keys = createTrustFixture();
  const cell = fixtureCell();
  const entries = [];
  let previousBundleHash = null;
  for (let index = 0; index < length; index += 1) {
    const grant = fixtureGrant(keys, cell);
    const receipt = fixtureReceipt(keys, grant, cell);
    const bundle = fixtureBundle(
      keys,
      cell,
      grant,
      [receipt],
      [grant],
      previousBundleHash,
    );
    const hash = sha256Canonical(bundle);
    entries.push({ bundle, grant, hash, receipt });
    previousBundleHash = hash;
  }
  return {
    keys,
    cell,
    entries,
    bundles: new Map(entries.map(({ bundle, hash }) => [hash, bundle])),
    genesisHash: entries[0].hash,
    headHash: entries.at(-1).hash,
  };
}

describe('createTrustedReceiptResolver', () => {
  it('reads and verifies one trusted ancestry only once per resolver', () => {
    const value = chainFixture();
    const readBundle = vi.fn(
      (hash) => structuredClone(value.bundles.get(hash)),
    );
    const resolve = createTrustedReceiptResolver({
      readBundle,
      trustRegistry: value.keys.registry,
      bundleChain: {
        schema_version: 'kernel-equivalence-bundle-chain/v1',
        genesis_hash: value.genesisHash,
        head_hash: value.headHash,
      },
      now: FIXTURE_NOW,
    });

    for (const entry of value.entries) {
      expect(resolve(
        `receipt-bundle:${entry.hash}`,
        fixtureExpected(value.cell, entry.grant),
      )).toMatchObject({
        bundle_hash: entry.hash,
        receipt_ids: [entry.receipt.receipt_id],
      });
    }

    expect(readBundle.mock.calls.length).toBeLessThanOrEqual(
      value.entries.length,
    );
  });

  it('does not cache a failed tampered ancestry verification', () => {
    const value = chainFixture(2);
    const tamperedGenesis = structuredClone(value.entries[0].bundle);
    tamperedGenesis.signature = 'tampered';
    let serveTampered = true;
    const readBundle = vi.fn((hash) => {
      if (hash === value.genesisHash && serveTampered) {
        return structuredClone(tamperedGenesis);
      }
      return structuredClone(value.bundles.get(hash));
    });
    const resolve = createTrustedReceiptResolver({
      readBundle,
      trustRegistry: value.keys.registry,
      bundleChain: {
        schema_version: 'kernel-equivalence-bundle-chain/v1',
        genesis_hash: value.genesisHash,
        head_hash: value.headHash,
      },
      now: FIXTURE_NOW,
    });

    expect(() => resolve(
      `receipt-bundle:${value.headHash}`,
      fixtureExpected(value.cell, value.entries.at(-1).grant),
    )).toThrowError(expect.objectContaining({
      code: 'receipt_bundle_hash_mismatch',
    }));

    serveTampered = false;
    expect(resolve(
      `receipt-bundle:${value.headHash}`,
      fixtureExpected(value.cell, value.entries.at(-1).grant),
    )).toMatchObject({ bundle_hash: value.headHash });
    expect(readBundle.mock.calls.filter(
      ([hash]) => hash === value.genesisHash,
    )).toHaveLength(2);
  });

  it('never shares successful verification across resolver trust registries', () => {
    const value = chainFixture(2);
    const readBundle = (hash) => structuredClone(value.bundles.get(hash));
    const chain = {
      schema_version: 'kernel-equivalence-bundle-chain/v1',
      genesis_hash: value.genesisHash,
      head_hash: value.headHash,
    };
    const expected = fixtureExpected(
      value.cell,
      value.entries.at(-1).grant,
    );
    const trusted = createTrustedReceiptResolver({
      readBundle,
      trustRegistry: value.keys.registry,
      bundleChain: chain,
      now: FIXTURE_NOW,
    });
    expect(trusted(`receipt-bundle:${value.headHash}`, expected))
      .toMatchObject({ bundle_hash: value.headHash });

    const unrelatedRegistry = createTrustFixture().registry;
    const untrusted = createTrustedReceiptResolver({
      readBundle,
      trustRegistry: unrelatedRegistry,
      bundleChain: chain,
      now: FIXTURE_NOW,
    });
    expect(() => untrusted(`receipt-bundle:${value.headHash}`, expected))
      .toThrowError(expect.objectContaining({
        code: 'bundle_signature_invalid',
      }));
  });

  it('retains a private validated registry snapshot for cached verification', () => {
    const value = chainFixture(2);
    const resolve = createTrustedReceiptResolver({
      readBundle: (hash) => structuredClone(value.bundles.get(hash)),
      trustRegistry: value.keys.registry,
      bundleChain: {
        schema_version: 'kernel-equivalence-bundle-chain/v1',
        genesis_hash: value.genesisHash,
        head_hash: value.headHash,
      },
      now: FIXTURE_NOW,
    });
    const reference = `receipt-bundle:${value.headHash}`;
    const expected = fixtureExpected(
      value.cell,
      value.entries.at(-1).grant,
    );

    expect(resolve(reference, expected))
      .toMatchObject({ bundle_hash: value.headHash });
    value.keys.registry.keys[0].public_key_pem = 'caller-mutated';
    expect(resolve(reference, expected))
      .toMatchObject({ bundle_hash: value.headHash });
    expect(() => createTrustedReceiptResolver({
      readBundle: (hash) => structuredClone(value.bundles.get(hash)),
      trustRegistry: value.keys.registry,
      bundleChain: {
        schema_version: 'kernel-equivalence-bundle-chain/v1',
        genesis_hash: value.genesisHash,
        head_hash: value.headHash,
      },
      now: FIXTURE_NOW,
    })).toThrowError(expect.objectContaining({
      code: 'trust_registry_invalid',
    }));
  });

  it('preloads an async durable chain before exposing a synchronous resolver', async () => {
    const value = fixture();
    const readBundle = vi.fn(async () => structuredClone(value.bundle));
    const resolve = await loadTrustedReceiptResolver({
      readBundle,
      trustRegistry: value.keys.registry,
      bundleChain: {
        schema_version: 'kernel-equivalence-bundle-chain/v1',
        genesis_hash: value.hash,
        head_hash: value.hash,
      },
      now: FIXTURE_NOW,
    });

    expect(resolve(
      `receipt-bundle:${value.hash}`,
      fixtureExpected(value.cell, value.grant),
    )).toMatchObject({
      bundle_hash: value.hash,
      receipt_ids: [value.receipt.receipt_id],
    });
    expect(readBundle).toHaveBeenCalledOnce();
  });

  it('resolves a content-addressed raw bundle and re-verifies both signatures', () => {
    const value = fixture();
    const readBundle = vi.fn(() => structuredClone(value.bundle));
    const resolve = createTrustedReceiptResolver({
      readBundle,
      trustRegistry: value.keys.registry,
      bundleChain: {
        schema_version: 'kernel-equivalence-bundle-chain/v1',
        genesis_hash: value.hash,
        head_hash: value.hash,
      },
      now: FIXTURE_NOW,
    });

    expect(resolve(
      `receipt-bundle:${value.hash}`,
      fixtureExpected(value.cell, value.grant),
    )).toMatchObject({
      bundle_hash: value.hash,
      receipt_ids: [value.receipt.receipt_id],
    });
    expect(readBundle).toHaveBeenCalledTimes(1);
    expect(readBundle).toHaveBeenCalledWith(value.hash);
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
      bundleChain: {
        schema_version: 'kernel-equivalence-bundle-chain/v1',
        genesis_hash: value.hash,
        head_hash: value.hash,
      },
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
        bundleChain: {
          schema_version: 'kernel-equivalence-bundle-chain/v1',
          genesis_hash: value.hash,
          head_hash: value.hash,
        },
        now: FIXTURE_NOW,
      });
      expect(() => resolve(
        `receipt-bundle:${value.hash}`,
        fixtureExpected(value.cell, value.grant),
      )).toThrowError(expect.objectContaining({ code: 'receipt_bundle_unavailable' }));
    }
  });

  it('rejects a valid signed bundle that is not in the trusted head ancestry', () => {
    const trusted = fixture();
    const rogue = fixture();
    const bundles = new Map([
      [trusted.hash, trusted.bundle],
      [rogue.hash, rogue.bundle],
    ]);
    const resolve = createTrustedReceiptResolver({
      readBundle: (hash) => bundles.get(hash),
      trustRegistry: trusted.keys.registry,
      bundleChain: {
        schema_version: 'kernel-equivalence-bundle-chain/v1',
        genesis_hash: trusted.hash,
        head_hash: trusted.hash,
      },
      now: FIXTURE_NOW,
    });

    expect(() => resolve(
      `receipt-bundle:${rogue.hash}`,
      fixtureExpected(rogue.cell, rogue.grant),
    )).toThrowError(expect.objectContaining({
      code: 'receipt_bundle_not_in_trusted_chain',
    }));
  });
});
