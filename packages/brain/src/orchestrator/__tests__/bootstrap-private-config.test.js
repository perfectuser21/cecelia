import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  readBootstrapPrivateConfig,
  writeBootstrapPgFiles,
} from '../../../../../scripts/lib/bootstrap-private-config.mjs';

const created = [];

function privateFixture(mode = 0o600) {
  const directory = mkdtempSync(join(tmpdir(), 'bootstrap-private-test-'));
  created.push(directory);
  const file = join(directory, 'bootstrap.json');
  writeFileSync(file, JSON.stringify({
    database_url: 'postgresql://cecelia:p%40ss@127.0.0.1:5432/cecelia?sslmode=require',
    approval_signature: 'c2lnbmF0dXJl',
  }), { mode });
  return { directory, file };
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(created.splice(0).map(
    (directory) => rm(directory, { recursive: true, force: true }),
  ));
});

describe('bootstrap private config', () => {
  it('reads secrets only from an owner-only regular file', () => {
    const { file } = privateFixture();
    expect(readBootstrapPrivateConfig(file)).toEqual({
      database_url: 'postgresql://cecelia:p%40ss@127.0.0.1:5432/cecelia?sslmode=require',
      approval_signature: 'c2lnbmF0dXJl',
    });
  });

  it('rejects a group/world-readable secret file', () => {
    const { file } = privateFixture(0o644);
    expect(() => readBootstrapPrivateConfig(file))
      .toThrow('bootstrap_private_config_permissions_invalid');
  });

  it('writes libpq service and password files without exposing the URI', () => {
    const { directory, file } = privateFixture();
    const serviceFile = join(directory, 'pg_service.conf');
    const passFile = join(directory, 'pgpass');
    writeBootstrapPgFiles(file, { serviceFile, passFile });

    expect(statSync(serviceFile).mode & 0o777).toBe(0o600);
    expect(statSync(passFile).mode & 0o777).toBe(0o600);
    expect(readFileSync(serviceFile, 'utf8')).toContain('[kernel_release_bootstrap]');
    expect(readFileSync(serviceFile, 'utf8')).toContain('dbname=cecelia');
    expect(readFileSync(serviceFile, 'utf8')).not.toContain('p@ss');
    expect(readFileSync(passFile, 'utf8')).toContain('p@ss');
    expect(readFileSync(passFile, 'utf8')).not.toContain('postgresql://');
  });
});
