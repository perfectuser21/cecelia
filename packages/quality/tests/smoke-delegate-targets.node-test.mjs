import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { fixture, root, clientCommands } from './fixtures/smoke-production-guard-fixture.mjs';

test('ratchet long-list membership survives early grep exit under pipefail', async () => {
  const source = await readFile(resolve(root, 'packages/quality/scripts/run-smoke-ratchet.sh'), 'utf8');
  const membership = source.match(/^_in_list\(\).*$/m)[0];
  const input = 'abilities-api-smoke.sh\n' + 'private-fixture-tail\n'.repeat(100000);
  for (const [name, expected] of [['abilities-api-smoke.sh', 0], ['abilities-api-smoke', 1]]) {
    const result = spawnSync('bash', ['-c', `set -uo pipefail\n${membership}\nentries=$(cat)\n_in_list '${name}' "$entries"`], { input, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, expected, `literal membership must not turn into SIGPIPE exit 141: ${result.stderr}`);
  }
});

for (const [name, route] of [
  ['company-key-results', '/api/brain/okr/company-key-results'],
  ['company-kr-analysis', '/api/brain/okr/company-key-results/analysis'],
  ['janitor', '/api/brain/janitor/jobs'],
]) {
  test(`${name}: actual readonly curl ignores startup POST and additional target`, async () => {
    const calls = [], additional = [];
    const server = createHttpServer((req, res) => { calls.push([req.method, req.url]); res.end(name === 'janitor' ? JSON.stringify({ jobs: [{ id: 'preview-owned-npm-cache-expiry-v1', enabled: false, name: 'private-fixture' }] }) : '{}'); });
    const extra = createHttpServer((req, res) => { additional.push([req.method, req.url]); res.end('{}'); });
    const temp = await mkdtemp(resolve(tmpdir(), 'company-http-curlrc-'));
    try {
      await new Promise(r => server.listen(0, '127.0.0.1', r));
      await new Promise(r => extra.listen(0, '127.0.0.1', r));
      await writeFile(resolve(temp, '.curlrc'), `request="POST"\ndata="local-fixture-only"\nurl="http://127.0.0.1:${extra.address().port}/extra"\n`);
      // Real wrapper and real curl: stop only after HTTP, before newer main's inline contract imports.
      // This transport boundary is not a replacement for the original 4+3 contract tests.
      const boundary = resolve(temp, 'boundary.sh');
      await writeFile(boundary, `set -T\ntrap 'case "$BASH_COMMAND" in node\\ --input-type=module*) exit 97;; esac' DEBUG\n`);
      const env = { ...process.env, CURL_HOME: temp, BASH_ENV: boundary,
        BRAIN_URL: `http://127.0.0.1:${server.address().port}` };
      for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete env[key];
      const child = spawn('bash', [resolve(root, 'packages/brain/scripts/smoke', `${name}-smoke.sh`)],
        { cwd: root, env, timeout: 5000, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'] });
      let output = ''; child.stdout.on('data', d => output += d); child.stderr.on('data', d => output += d);
      const code = await new Promise((r, j) => { child.on('close', r); child.on('error', j); });
      assert.equal(code, 97, `must reach HTTP-to-contract boundary without importing unmerged business modules: ${output}`);
      assert.deepEqual(calls, [['GET', route]], JSON.stringify({ calls, additional }));
      assert.deepEqual(additional, [], 'curlrc must not append an unchecked target');
    } finally {
      await Promise.all([new Promise(r => server.close(r)), new Promise(r => extra.close(r))]);
      await rm(temp, { recursive: true, force: true });
    }
  });
}

for (const optIn of ['', '1']) {
  test(`ratchet delegates Walking to its required owner without executing it: opt-in=${optIn || 'default'}`, async () => {
    const temp = await mkdtemp(resolve(tmpdir(), 'walking-ratchet-'));
    try {
      const walkingMarker = resolve(temp, 'walking-executed');
      const ordinaryMarker = resolve(temp, 'ordinary-executed');
      await writeFile(resolve(temp, 'walking-skeleton-1node-smoke.sh'), `touch '${walkingMarker}'\nexit 0\n`);
      await writeFile(resolve(temp, 'abilities-api-smoke.sh'), `touch '${ordinaryMarker}'\nexit 0\n`);
      await fixture(async ({ smoke, dockerCalls, requests }) => {
        const result = await smoke('packages/quality/scripts/run-smoke-ratchet.sh', { SMOKE_DIR: temp, SMOKE_ALLOW_WRITE: optIn });
        assert.equal(result.code, 0, result.output);
        await assert.rejects(readFile(walkingMarker), { code: 'ENOENT' });
        await readFile(ordinaryMarker);
        assert.match(result.output, /DELEGATED.*walking-skeleton-1node-smoke\.sh.*walking-ci-e2e/);
        assert.match(result.output, /DELEGATED:\s+1/);
        assert.match(result.output, /PASS:\s+1/);
        assert.match(result.output, /SKIP\(deny\):\s+0/);
        assert.match(result.output, /FAIL\(债务\):\s+0/);
        assert.doesNotMatch(result.output, /(?:PASS|SKIP|FAIL).*walking-skeleton-1node-smoke\.sh/);
        assert.deepEqual(await dockerCalls(), [], 'delegation precedes Docker identity probing');
        assert.deepEqual(requests, [], 'delegation performs no HTTP or business write');
      });
    } finally { await rm(temp, { recursive: true, force: true }); }
  });
}

for (const [name, scriptExit, gateExit, summary, executed] of [
  ['abilities-api-smoke.sh', 0, 0, /PASS:\s+1/, true],
  ['abilities-api-smoke.sh', 9, 1, /FAIL\(基线\):\s+1/, true],
  ['brain-guidance-smoke.sh', 9, 0, /FAIL\(债务\):\s+1/, true],
  ['walking-ratchet-unregistered-fixture.sh', 0, 1, null, false],
  ['map-engine-smoke.sh', 9, 0, /SKIP\(deny\):\s+1/, false],
]) {
  test(`Walking delegation preserves ratchet classification: ${name} exit=${scriptExit}`, async () => {
    const temp = await mkdtemp(resolve(tmpdir(), 'walking-ratchet-classification-'));
    try {
      const marker = resolve(temp, 'executed');
      await writeFile(resolve(temp, name), `touch '${marker}'\nexit ${scriptExit}\n`);
      await fixture(async ({ smoke, dockerCalls, requests }) => {
        const result = await smoke('packages/quality/scripts/run-smoke-ratchet.sh', { SMOKE_DIR: temp, SMOKE_ALLOW_WRITE: '' });
        assert.equal(result.code, gateExit, result.output);
        if (summary) assert.match(result.output, summary);
        else assert.doesNotMatch(result.output, /PASS:.*walking-ratchet-unregistered-fixture/);
        if (executed) await readFile(marker);
        else await assert.rejects(readFile(marker), { code: 'ENOENT' });
        assert.deepEqual(await dockerCalls(), []); assert.deepEqual(requests, []);
      });
    } finally { await rm(temp, { recursive: true, force: true }); }
  });
}

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

for (const [name, uri, accepted] of [['missing', undefined, false],
  ['test', 'postgresql://localhost:5432/cecelia_test', true],
  ['production', 'postgresql://localhost:5432/cecelia', false]]) {
  test(`walking checkpointer actual container URI ${name}`, async () => {
    await fixture(async ({ smoke, info, requests, port }) => {
      if (uri) info.Config.Env.push(`DATABASE_URL=${uri}`);
      const source = await readFile(resolve(root, 'packages/brain/scripts/smoke/walking-skeleton-1node-smoke.sh'), 'utf8');
      const prefix = source.slice(0, source.indexOf('\nfi') + 3)
        .replace(/\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/\.\.\/lib/g, resolve(root, 'packages/brain/scripts/lib'))
        .replaceAll('http://localhost:5221', `http://127.0.0.1:${port}`);
      const result = await smoke('-c', { SMOKE_ALLOW_WRITE: '1' }, info, false, [prefix + '\nprintf GUARD_ACCEPTED']);
      assert.equal(result.output.includes('GUARD_ACCEPTED'), accepted, result.output);
      assert.equal(requests.length, accepted ? 1 : 0, 'checkpointer identity checked before HTTP');
    });
  });
}
