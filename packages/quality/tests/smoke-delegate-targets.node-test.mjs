import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { fixture, root, clientCommands } from './fixtures/smoke-production-guard-fixture.mjs';

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
const aliasCall = /(?:"\$(?:\{)?PSQL(?:_EXECUTABLE)?(?:\})?"|\$(?:\{)?PSQL(?:_EXECUTABLE)?(?:\})?)(?=\s)/g;
test('startup scanner recognizes quoted, unquoted and command-substitution SQL aliases', () => {
  for (const command of ['$PSQL -c', '"$PSQL" -c', '$PSQL_EXECUTABLE -c', '"$PSQL_EXECUTABLE" -c',
    '$($PSQL_EXECUTABLE -c)', '$("$PSQL_EXECUTABLE" -c)', '${PSQL} -c']) {
    assert.ok(command.match(aliasCall), command);
  }
  assert.equal('$PSQL_DB'.match(aliasCall), null);
});
for (const name of await readdir(resolve(root, 'packages/brain/scripts/smoke'))) {
  if (!name.endsWith('.sh')) continue;
  const source = await readFile(resolve(root, 'packages/brain/scripts/smoke', name), 'utf8');
  if (!source.match(aliasCall) || !source.includes('command -v psql')) continue;
  test(`${name}: all actual SQL alias calls disable startup configuration`, () => {
    const commands = source.replace(/\\\n/g, ' ').split('\n').filter(line => !line.trim().startsWith('#')).join('\n');
    for (const match of commands.matchAll(aliasCall)) {
      const remainder = commands.slice(match.index + match[0].length);
      assert.match(remainder, /^\s+-X(?:\s|$)/,
        `unchecked SQL alias in ${name}`);
      const firstArg = remainder.trimStart().match(/^(?:-[\w]+|"\$[\w]+")/)[0];
      // Execute the exact alias spelling and first argument through Bash, with a local shell-only recorder.
      // No original query, database client, subprocess, or external endpoint executes here.
      const actual = execFileSync('bash', ['-c', `psql() { printf '%s' "$1"; }; PSQL=psql; PSQL_EXECUTABLE=psql; ${match[0]} ${firstArg}`],
        { encoding: 'utf8', timeout: 1000 });
      assert.equal(actual, '-X', `${name}: actual alias argv omitted startup isolation`);
    }
  });
}
test('all actual curl executable aliases disable default configuration', async () => {
  for (const name of await readdir(resolve(root, 'packages/brain/scripts/smoke'))) {
    if (!name.endsWith('.sh')) continue;
    const source = await readFile(resolve(root, 'packages/brain/scripts/smoke', name), 'utf8');
    const commands = source.replace(/\\\n/g, ' ').split('\n').filter(line => !line.trim().startsWith('#')).join('\n');
    for (const match of commands.matchAll(/"?\$CURL_EXECUTABLE"?(?=\s)/g)) {
      assert.match(commands.slice(match.index + match[0].length), /^\s+-q(?:\s|$)/, name);
    }
  }
});
test('client startup options never become dependency lookup arguments', async () => {
  for (const name of await readdir(resolve(root, 'packages/brain/scripts/smoke'))) {
    if (!name.endsWith('.sh')) continue;
    const source = await readFile(resolve(root, 'packages/brain/scripts/smoke', name), 'utf8');
    assert.doesNotMatch(source, /\b(?:command\s+-v|which)\s+(?:psql\s+-X|curl\s+-q)\b/, name);
  }
});
test('startup audit excludes inert diagnostics and lookups but retains actual client calls', () => {
  for (const client of ['psql', 'curl']) {
    assert.equal(clientCommands(`command -v ${client}\necho "${client} 不在 PATH"`).includes(client), false);
    assert.ok(clientCommands(`echo "$( ${client} -c fixture )"`).includes(client), 'command substitution must remain audited');
    assert.ok(clientCommands(`command -v ${client} || ${client} fixture`).includes(`${client} fixture`), 'lookup must not hide another call on the same line');
    assert.ok(clientCommands(`${client} fixture`).includes(`${client} fixture`));
  }
});
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
const goldenSource = await readFile(resolve(root, 'packages/brain/scripts/smoke/golden-paths-t1-smoke.sh'), 'utf8');
const goldenLine = goldenSource.split('\n').find(line => line.includes('[[ -n "$GP_ID" ]] && command -v psql'));
assert.ok(goldenLine, 'Golden Paths conditional database check must remain covered');
const goldenQuery = goldenLine.slice(goldenLine.indexOf('&& psql') + 3).split('; then')[0];
for (const [script, args] of [...delegates, ['-c', ['DB="$DATABASE_URL"; ' + goldenQuery]]]) {
  const name = script === '-c' ? 'golden-paths-t1 actual conditional psql' : script;
  test(`${name}: native psql cannot reconnect through PSQLRC`, async t => {
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
        assert.equal(calls.length, script === 'scripts/preview-ledger-activate.sh' ? 2 : 1);
        for (const call of calls) assert.equal(call[0], '-X');
      });
    } finally {
      await Promise.all([new Promise(r => db.close(r)), new Promise(r => other.close(r))]);
      await rm(temp, { recursive: true, force: true });
    }
  });
}
