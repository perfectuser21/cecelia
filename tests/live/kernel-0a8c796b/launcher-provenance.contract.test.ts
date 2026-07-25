import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const launcher = path.join(repoRoot, 'scripts/claude-launch.sh');
const migration = path.join(
  repoRoot,
  'packages/brain/migrations/360_session_provenance.sql'
);
const database = process.env.DB_NAME || 'cecelia_test';
const schema = `contract_launcher_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-provenance-contract-'));

if (!/_test$|_scratch$/.test(database)) {
  throw new Error(`contract test requires a test database, got ${database}`);
}

function psql(sql: string) {
  return spawnSync(
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', '-d', database, '-qAt', '-c', sql],
    { encoding: 'utf8', env: process.env }
  );
}

beforeAll(() => {
  expect(
    fs.existsSync(migration),
    'RED: session_provenance migration 尚未实现，launcher 无真实表可登记'
  ).toBe(true);
  const migrationSql = fs.readFileSync(migration, 'utf8');
  const setup = psql(`
    CREATE SCHEMA "${schema}";
    SET search_path TO "${schema}";
    CREATE TABLE schema_version (
      version TEXT PRIMARY KEY,
      description TEXT,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );
    ${migrationSql}
  `);
  expect(setup.status, setup.stderr).toBe(0);
});

afterAll(() => {
  psql(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('Claude launcher provenance contract（launcher ↔ 真 PostgreSQL）', () => {
  it('claude launcher 在真 PostgreSQL 写入 machine provenance 并回读', () => {
    const sid = randomUUID();
    const taskId = randomUUID();
    const fakeClaude = path.join(tempRoot, 'claude');
    const psqlProxy = path.join(tempRoot, 'psql');
    const realPsql = spawnSync('bash', ['-lc', 'command -v psql'], {
      encoding: 'utf8',
    }).stdout.trim();

    fs.writeFileSync(fakeClaude, '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
    fs.writeFileSync(
      psqlProxy,
      `#!/usr/bin/env bash
args=()
for arg in "$@"; do
  [[ "$arg" == "cecelia" ]] && continue
  args+=("$arg")
done
exec "${realPsql}" -d "${database}" "\${args[@]}"
`,
      { mode: 0o755 }
    );

    const launched = spawnSync(
      'bash',
      [launcher, '-p', 'contract probe'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${tempRoot}:${process.env.PATH}`,
          PGOPTIONS: `-c search_path=${schema}`,
          CLAUDE_CODE_EXECPATH: fakeClaude,
          CLAUDE_SESSION_ID: sid,
          CECELIA_DISPATCH: '1',
          CECELIA_LAUNCHED_BY: 'cecelia-run',
          HARNESS_TASK_ID: taskId,
          CECELIA_NO_AUTO_WORKTREE: '1',
        },
      }
    );
    expect(launched.status, launched.stderr).toBe(0);

    const row = psql(`
      SET search_path TO "${schema}";
      SELECT session_id || '|' || kind || '|' || launched_by || '|' || task_id
      FROM session_provenance
      WHERE session_id = '${sid}';
    `);
    expect(row.status, row.stderr).toBe(0);
    expect(row.stdout.trim()).toBe(`${sid}|machine|cecelia-run|${taskId}`);
  });
});
