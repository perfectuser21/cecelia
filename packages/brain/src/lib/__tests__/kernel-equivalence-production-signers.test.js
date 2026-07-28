import { generateKeyPairSync } from 'node:crypto';
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  TRUSTED_NON_RELEASE_EQUIVALENCE_DESCRIPTORS,
} from '../kernel-equivalence-trusted-assembly.js';
import {
  loadProductionEffectSignerSet,
} from '../kernel-equivalence-production-signers.js';

const NOW = Date.parse('2026-07-28T12:02:00.000Z');
const roots = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'kernel-eq-effect-signers-'));
  roots.push(root);
  const keys = [];
  const signingKeys = {};
  const keyIds = {};
  for (
    const [index, descriptor]
    of TRUSTED_NON_RELEASE_EQUIVALENCE_DESCRIPTORS.entries()
  ) {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const keyId = `effect-${String(index + 1).padStart(2, '0')}-2026-07`;
    const secretFile = join(root, `${keyId}.pem`);
    writeFileSync(
      secretFile,
      privateKey.export({ type: 'pkcs8', format: 'pem' }),
      { mode: 0o600 },
    );
    chmodSync(secretFile, 0o600);
    keyIds[descriptor.seam_id] = keyId;
    signingKeys[descriptor.seam_id] = {
      key_id: keyId,
      secret_file: secretFile,
    };
    keys.push({
      key_id: keyId,
      purpose: 'effect_receipt',
      service_id: descriptor.seam_id,
      public_key_pem: publicKey.export({ type: 'spki', format: 'pem' }),
      not_before: '2026-07-28T00:00:00.000Z',
      not_after: '2026-08-28T00:00:00.000Z',
      revoked_at: null,
      rotates_key_id: null,
    });
  }
  const cells = TRUSTED_NON_RELEASE_EQUIVALENCE_DESCRIPTORS.flatMap(
    (descriptor) => (
      ['claude', 'codex', 'grok'].flatMap((provider) => (
        ['normal', 'violation', 'recovery'].map((scenario) => ({
          cell_id: `${descriptor.behavior_id}::${provider}::${scenario}`,
          behavior_id: descriptor.behavior_id,
          provider,
          scenario,
          seam_id: descriptor.seam_id,
          adapter_id: descriptor.adapter_id,
          effect_signer_status: 'available',
          effect_key_id: keyIds[descriptor.seam_id],
          blocked_by: null,
        }))
      ))
    ),
  );
  return {
    plan: {
      schema_version: 'kernel-equivalence-drill-plan/v1',
      behavior_count: 11,
      cells: [
        ...cells,
        ...['claude', 'codex', 'grok'].flatMap((provider) => (
          ['normal', 'violation', 'recovery'].map((scenario) => ({
            cell_id:
              `KERNEL-P0-07-RELEASE-PROMOTION::${provider}::${scenario}`,
            behavior_id: 'KERNEL-P0-07-RELEASE-PROMOTION',
            provider,
            scenario,
            seam_id: 'kernel.release.staging_promotion',
            adapter_id: 'kernel.drill.release_promotion.v1',
            effect_signer_status: 'missing',
            effect_key_id: null,
            blocked_by: 'seam_receipt_signer_missing',
          }))
        )),
      ],
    },
    trustRegistry: {
      schema_version: 'kernel-equivalence-trust-registry/v1',
      algorithm: 'ed25519',
      grant_max_age_seconds: 900,
      effect_receipt_max_age_seconds: 86_400,
      collector_bundle_max_age_seconds: 86_400,
      replay_nonce: {
        single_use: true,
        atomic_consumer_required: true,
      },
      keys,
    },
    signingKeys,
    now: () => NOW,
  };
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop(), { recursive: true, force: true });
  }
});

describe('production effect signer set', () => {
  it('loads exactly one registry-bound signer for every non-release seam', () => {
    const value = fixture();
    const signers = loadProductionEffectSignerSet(value);

    expect(Object.keys(signers).sort()).toEqual(
      TRUSTED_NON_RELEASE_EQUIVALENCE_DESCRIPTORS
        .map(({ seam_id: seamId }) => seamId)
        .sort(),
    );
    for (const descriptor of TRUSTED_NON_RELEASE_EQUIVALENCE_DESCRIPTORS) {
      expect(signers[descriptor.seam_id]).toMatchObject({
        key_id: value.signingKeys[descriptor.seam_id].key_id,
        purpose: 'effect_receipt',
        service_id: descriptor.seam_id,
        signEffectResult: expect.any(Function),
      });
    }
    expect(Object.isFrozen(signers)).toBe(true);
    expect(JSON.stringify(signers)).not.toMatch(
      /secret_file|private|BEGIN PRIVATE KEY/,
    );
  });

  it.each([
    ['missing seam', (value) => {
      delete value.signingKeys[
        TRUSTED_NON_RELEASE_EQUIVALENCE_DESCRIPTORS[0].seam_id
      ];
    }, 'production_effect_signing_key_set_invalid'],
    ['extra seam', (value) => {
      value.signingKeys['kernel.attacker.seam'] = {
        key_id: 'attacker',
        secret_file: '/tmp/attacker',
      };
    }, 'production_effect_signing_key_set_invalid'],
    ['wrong plan key', (value) => {
      value.plan.cells[0].effect_key_id = 'attacker';
    }, 'production_effect_plan_invalid'],
    ['cross-seam registry key', (value) => {
      const first =
        TRUSTED_NON_RELEASE_EQUIVALENCE_DESCRIPTORS[0].seam_id;
      const second =
        TRUSTED_NON_RELEASE_EQUIVALENCE_DESCRIPTORS[1].seam_id;
      value.signingKeys[first].key_id = value.signingKeys[second].key_id;
    }, 'production_effect_plan_invalid'],
    ['raw private key field', (value) => {
      const seam =
        TRUSTED_NON_RELEASE_EQUIVALENCE_DESCRIPTORS[0].seam_id;
      value.signingKeys[seam].private_key = 'forbidden';
    }, 'production_effect_signing_key_invalid'],
  ])('fails closed for %s', (_label, mutate, code) => {
    const value = fixture();
    mutate(value);

    expect(() => loadProductionEffectSignerSet(value)).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it('reads descriptor values once and rejects accessors', () => {
    const value = fixture();
    const seam =
      TRUSTED_NON_RELEASE_EQUIVALENCE_DESCRIPTORS[0].seam_id;
    Object.defineProperty(value.signingKeys[seam], 'key_id', {
      configurable: true,
      enumerable: true,
      get() {
        return 'attacker';
      },
    });

    expect(() => loadProductionEffectSignerSet(value)).toThrowError(
      expect.objectContaining({
        code: 'production_effect_signing_key_invalid',
      }),
    );
  });
});
