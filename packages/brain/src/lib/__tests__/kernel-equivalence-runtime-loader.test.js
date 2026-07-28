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
  loadProtectedExecutionGrant,
  loadTrustedEquivalenceRuntime,
  validateTrustedRuntimeEnvironment,
} from '../kernel-equivalence-runtime-loader.js';
import {
  createTrustFixture,
  fixtureCell,
  fixtureGrant,
} from './kernel-equivalence-test-fixtures.js';

const roots = [];

function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), 'kernel-eq-runtime-'));
  roots.push(root);
  return root;
}

function writePrivateKey(root, privateKey) {
  const path = join(root, 'collector.pem');
  writeFileSync(
    path,
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
    { mode: 0o600 },
  );
  chmodSync(path, 0o600);
  return path;
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop(), { recursive: true, force: true });
  }
});

describe('trusted equivalence runtime loader', () => {
  it('rejects raw key material before reporting missing metadata', () => {
    expect(() => validateTrustedRuntimeEnvironment({
      KERNEL_EQ_COLLECTOR_PRIVATE_KEY: 'credential-must-not-escape',
    })).toThrowError(expect.objectContaining({
      code: 'trusted_runtime_raw_secret_forbidden',
    }));
    expect(() => validateTrustedRuntimeEnvironment({}))
      .toThrowError(expect.objectContaining({
        code: 'trusted_runtime_collector_key_file_missing',
      }));
  });

  it('requires exact bounded collector file metadata', () => {
    expect(() => validateTrustedRuntimeEnvironment({
      KERNEL_EQ_COLLECTOR_KEY_FILE: 'relative.pem',
      KERNEL_EQ_COLLECTOR_KEY_ID: 'collector-2026-07',
    })).toThrowError(expect.objectContaining({
      code: 'trusted_runtime_collector_key_file_invalid',
    }));
    expect(validateTrustedRuntimeEnvironment({
      KERNEL_EQ_COLLECTOR_KEY_FILE: '/var/lib/cecelia/kernel/collector.pem',
      KERNEL_EQ_COLLECTOR_KEY_ID: 'collector-2026-07',
    })).toEqual({
      collector_key_file: '/var/lib/cecelia/kernel/collector.pem',
      collector_key_id: 'collector-2026-07',
    });
  });

  it('loads a protected signed grant without exposing its source path', () => {
    const root = temporaryRoot();
    const keys = createTrustFixture();
    const grant = fixtureGrant(keys, fixtureCell());
    const grantPath = join(root, 'grant.json');
    writeFileSync(grantPath, JSON.stringify(grant), { mode: 0o600 });
    chmodSync(grantPath, 0o600);

    const loaded = loadProtectedExecutionGrant({ grantPath });

    expect(loaded).toEqual(grant);
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(JSON.stringify(loaded)).not.toContain(grantPath);
  });

  it('composes database authorities and a collector without leaking metadata', async () => {
    const root = temporaryRoot();
    const keys = createTrustFixture();
    const secretFile = writePrivateKey(root, keys.collector.privateKey);
    const pool = {
      connect: async () => {
        throw new Error('not used during load');
      },
      query: async () => ({
        rows: [{
          genesis_hash: null,
          head_hash: null,
          revision: 0,
        }],
        rowCount: 1,
      }),
    };

    const runtime = await loadTrustedEquivalenceRuntime({
      env: {
        KERNEL_EQ_COLLECTOR_KEY_FILE: secretFile,
        KERNEL_EQ_COLLECTOR_KEY_ID: keys.collector.record.key_id,
      },
      trustRegistry: keys.registry,
      pool,
      now: () => Date.parse('2026-07-28T12:02:00.000Z'),
    });

    expect(runtime).toMatchObject({
      schema_version: 'kernel-equivalence-trusted-runtime/v1',
      collector_key_id: keys.collector.record.key_id,
      adapter_count: 0,
      executeCell: expect.any(Function),
    });
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(JSON.stringify(runtime)).not.toContain(secretFile);
    expect(JSON.stringify(runtime)).not.toContain('PRIVATE KEY');
  });

  it('maps a database checkpoint failure to one stable wiring code', async () => {
    const root = temporaryRoot();
    const keys = createTrustFixture();
    const secretFile = writePrivateKey(root, keys.collector.privateKey);
    const pool = {
      connect: async () => {
        throw new Error('unavailable');
      },
      query: async () => {
        throw new Error('database credential should not escape');
      },
    };

    await expect(loadTrustedEquivalenceRuntime({
      env: {
        KERNEL_EQ_COLLECTOR_KEY_FILE: secretFile,
        KERNEL_EQ_COLLECTOR_KEY_ID: keys.collector.record.key_id,
      },
      trustRegistry: keys.registry,
      pool,
    })).rejects.toMatchObject({
      code: 'trusted_runtime_database_unavailable',
    });
  });
});
