import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import {
  writeBootstrapPgFiles,
} from '../../../../../scripts/lib/bootstrap-private-config.mjs';

const directory = mkdtempSync(join(tmpdir(), 'bootstrap-pg-integration-'));

afterAll(() => rm(directory, { recursive: true, force: true }));

describe('bootstrap private libpq references', () => {
  it('connects to the real test database without URI argv or secret env', () => {
    const url = new URL('postgresql://localhost/');
    url.hostname = DB_DEFAULTS.host;
    url.port = String(DB_DEFAULTS.port);
    url.username = DB_DEFAULTS.user;
    url.password = DB_DEFAULTS.password;
    url.pathname = `/${DB_DEFAULTS.database}`;
    const privateConfig = join(directory, 'bootstrap.json');
    writeFileSync(privateConfig, JSON.stringify({
      database_url: url.toString(),
      approval_signature: 'c2lnbmF0dXJl',
    }), { mode: 0o600 });
    const serviceFile = join(directory, 'pg_service.conf');
    const passFile = join(directory, 'pgpass');
    writeBootstrapPgFiles(privateConfig, { serviceFile, passFile });

    const output = execFileSync('psql', [
      '-XqAt',
      '-c',
      'SELECT current_database()',
    ], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        PGSERVICEFILE: serviceFile,
        PGPASSFILE: passFile,
        PGSERVICE: 'kernel_release_bootstrap',
      },
    }).trim();
    expect(output).toBe(DB_DEFAULTS.database);
    expect(output).toMatch(/_test$|_scratch$/);
  });
});
