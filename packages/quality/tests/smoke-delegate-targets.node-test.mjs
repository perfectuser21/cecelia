import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { fixture, root } from './fixtures/smoke-production-guard-fixture.mjs';

test('c8 forwards the checked connection instead of inherited container SMOKE_DATABASE_URL', async () => {
  await fixture(async ({ smoke, info, dockerCalls }) => {
    info.Config.Env.push('SMOKE_DATABASE_URL=postgresql://localhost/cecelia');
    const connection = 'postgresql://fixture@localhost:5432/cecelia_test';
    await smoke('c8a-harness-checkpoint-resume.sh', { SMOKE_ALLOW_WRITE: '1',
      DATABASE_URL: connection, CONTAINER_DATABASE_URL: '' }, info);
    const calls = (await dockerCalls()).filter(args => args[0] === 'exec');
    assert.ok(calls.length, 'actual container writer was not exercised');
    for (const args of calls) assert.ok(args.includes(`SMOKE_DATABASE_URL=${connection}`),
      'container inherited an unchecked connection');
    const source = await readFile(resolve(root, 'packages/brain/scripts/smoke/c8a-harness-checkpoint-resume.sh'), 'utf8');
    const commands = source.replace(/\\\n/g, ' ').split('\n').filter(line => /^\s*docker exec/.test(line));
    assert.equal(commands.length, 2, 'both checkpoint put and resume must stay covered');
    for (const command of commands) assert.match(command, /-e "SMOKE_DATABASE_URL=\$CONTAINER_DB_URL"/);
  });
});

const delegates = [
  ['packages/brain/scripts/model-accounts-seed-e2e.sh', []],
  ['scripts/preview-ledger-activate.sh', ['cecelia_test', '123']],
];
for (const [script] of delegates) {
  test(`${script}: every actual psql invocation disables startup configuration`, async () => {
    const source = await readFile(resolve(root, script), 'utf8');
    const commands = source.split('\n').filter(line => !line.trim().startsWith('#')).join('\n');
    assert.doesNotMatch(commands, /\bpsql[ \t]+(?!-X(?:[ \t]|$))/);
  });
}

// Minimal PostgreSQL wire peer: authentication and scalar responses only, no database or SQL execution.
function postgresFixture() {
  const message = (type, body) => {
    const size = Buffer.alloc(4); size.writeInt32BE(body.length + 4);
    return Buffer.concat([Buffer.from(type), size, body]);
  };
  return createServer(socket => {
    socket.setTimeout(3000, () => socket.destroy());
    let pending = Buffer.alloc(0), started = false;
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= (started ? 5 : 8)) {
        const length = pending.readInt32BE(started ? 1 : 0);
        if (pending.length < length + (started ? 1 : 0)) return;
        if (!started && pending.readInt32BE(4) === 80877103) {
          pending = pending.subarray(length); socket.write('N'); continue;
        }
        const type = started ? String.fromCharCode(pending[0]) : '';
        pending = pending.subarray(length + (started ? 1 : 0));
        if (!started) {
          started = true;
          socket.write(Buffer.concat([message('R', Buffer.alloc(4)),
            message('S', Buffer.from('client_encoding\0UTF8\0')),
            message('S', Buffer.from('server_version\0' + '16.0\0')), message('Z', Buffer.from('I'))]));
        } else if (type === 'Q') {
          const meta = Buffer.alloc(18); meta.writeInt32BE(23, 6); meta.writeInt16BE(4, 10); meta.writeInt32BE(-1, 12);
          socket.write(Buffer.concat([message('T', Buffer.concat([Buffer.from([0, 1]), Buffer.from('?column?\0'), meta])),
            message('D', Buffer.from([0, 1, 0, 0, 0, 1, 49])), message('C', Buffer.from('SELECT 1\0')),
            message('Z', Buffer.from('I'))]));
        } else if (type === 'X') socket.end();
      }
    });
  });
}
for (const [script, args] of delegates) {
  test(`${script}: native psql cannot reconnect through PSQLRC`, async t => {
    let psql;
    try { psql = execFileSync('which', ['psql'], { encoding: 'utf8' }).trim(); }
    catch { t.skip('native psql unavailable; mandatory command checks still run'); return; }
    const db = postgresFixture();
    let redirects = 0;
    const other = createServer(socket => { redirects++; socket.destroy(); });
    const temp = await mkdtemp(resolve(tmpdir(), 'smoke-delegate-psqlrc-'));
    await Promise.all([new Promise(r => db.listen(0, '127.0.0.1', r)), new Promise(r => other.listen(0, '127.0.0.1', r))]);
    try {
      const config = resolve(temp, 'psqlrc');
      await writeFile(config, `\\connect postgresql://fixture@127.0.0.1:${other.address().port}/cecelia_test\n`);
      await fixture(async ({ smoke, psqlCalls }) => {
        const result = await smoke(script, { GUARD_NATIVE_PSQL: psql, PSQLRC: config,
          DATABASE_URL: `postgresql://fixture@127.0.0.1:${db.address().port}/cecelia_test`,
          DB_HOST: '127.0.0.1', DB_USER: 'fixture', PGPORT: String(db.address().port) }, undefined, false, args);
        assert.equal(redirects, 0, 'default psql startup configuration changed the actual endpoint');
        assert.equal(result.code, 0, result.output);
        const calls = await psqlCalls();
        assert.equal(calls.length, script.startsWith('packages/') ? 1 : 2);
        for (const call of calls) assert.equal(call[0], '-X');
      });
    } finally {
      await Promise.all([new Promise(r => db.close(r)), new Promise(r => other.close(r))]);
      await rm(temp, { recursive: true, force: true });
    }
  });
}
