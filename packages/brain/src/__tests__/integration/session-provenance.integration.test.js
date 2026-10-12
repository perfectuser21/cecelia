import { afterAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import os from 'node:os';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(__dirname, '../../../migrations/360_session_provenance.sql');
let pool;

afterAll(async () => {
  if (!pool) return;
  await pool.query(`DELETE FROM session_provenance WHERE launched_by = 'session-provenance-integration'`);
});

describe('session_provenance migration（真 PostgreSQL）', () => {
  it('支持 human/machine、CHECK、UUID 与幂等重放', async () => {
    pool = (await import('../../db.js')).default;
    const sql = fs.readFileSync(migrationPath, 'utf8');
    await pool.query(sql);
    await pool.query(sql);

    await pool.query(
      `INSERT INTO session_provenance(session_id, kind, launched_by)
       VALUES ('integration-human', 'human', 'session-provenance-integration')
       ON CONFLICT (session_id) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO session_provenance(session_id, kind, launched_by, task_id)
       VALUES ('integration-machine', 'machine', 'session-provenance-integration',
               '00000000-0000-4000-8000-000000000001')
       ON CONFLICT (session_id) DO NOTHING`
    );
    await expect(pool.query(
      `INSERT INTO session_provenance(session_id, kind, launched_by)
       VALUES ('integration-invalid', 'robot', 'session-provenance-integration')`
    )).rejects.toMatchObject({ code: '23514' });

    const { rows } = await pool.query(
      `SELECT session_id, kind, launched_by, task_id
       FROM session_provenance
       WHERE session_id IN ('integration-human', 'integration-machine')
       ORDER BY session_id`
    );
    expect(rows).toEqual([
      {
        session_id: 'integration-human',
        kind: 'human',
        launched_by: 'session-provenance-integration',
        task_id: null,
      },
      {
        session_id: 'integration-machine',
        kind: 'machine',
        launched_by: 'session-provenance-integration',
        task_id: '00000000-0000-4000-8000-000000000001',
      },
    ]);
  });

  it('launcher → 真实 HTTP 路由 → PostgreSQL → GET 读回，重复请求不改出处', async () => {
    pool = (await import('../../db.js')).default;
    const router = (await import('../../routes/session-provenance.js')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/brain/session-provenance', router);
    const server = await new Promise(resolve => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const sid = randomUUID();
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'provenance-pg-'));
    const fakeClaude = path.join(temp, 'claude');
    fs.writeFileSync(fakeClaude, '#!/bin/bash\nexit 0\n', { mode: 0o755 });
    try {
      const launcher = path.resolve(__dirname, '../../../../../scripts/claude-launch.sh');
      const exit = await new Promise((resolve, reject) => {
        const child = spawn('bash', [launcher, '-p', 'provenance check'], { cwd: temp,
          env: { ...process.env, BRAIN_URL: base, CLAUDE_CODE_EXECPATH: fakeClaude,
            CLAUDE_SESSION_ID: sid, CECELIA_DISPATCH: '1', CECELIA_NO_AUTO_WORKTREE: '1',
            CECELIA_LAUNCHED_BY: 'session-provenance-integration', HARNESS_TASK_ID: '' },
          stdio: 'pipe' });
        child.on('error', reject);
        child.on('exit', resolve);
      });
      expect(exit).toBe(0);
      const { rows } = await pool.query('SELECT kind FROM session_provenance WHERE session_id=$1', [sid]);
      expect(rows).toEqual([{ kind: 'machine' }]);
      const replay = await fetch(`${base}/api/brain/session-provenance`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid, kind: 'human', launched_by: 'changed' }) });
      expect(replay.status).toBe(200);
      expect((await replay.json()).kind).toBe('machine');
      const readback = await fetch(`${base}/api/brain/session-provenance/${sid}`);
      expect((await readback.json()).launched_by).toBe('session-provenance-integration');
    } finally {
      await new Promise(resolve => server.close(resolve));
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });
});
