import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export function checked(command, args, { env, cwd, input, timeout = 120000 } = {}) {
  const result = spawnSync(command, args, { env, cwd, input, timeout, maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.signal || result.status !== 0) throw Error(`${command} failed (${result.status ?? result.signal}): ${result.error?.message || Buffer.concat([result.stdout || Buffer.alloc(0), result.stderr || Buffer.alloc(0)]).toString().slice(-4000)}`);
  return result.stdout;
}

export function cleanProcessEnv(directory, path = process.env.PATH) {
  return { PATH: path, HOME: join(directory, 'home'), TMPDIR: join(directory, 'tmp'), TMP: join(directory, 'tmp'), TEMP: join(directory, 'tmp'),
    LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  if ([5432, 5221].includes(port)) return freePort();
  return port;
}

export async function startPrivatePg({ nativeBin, image = 'mirror.gcr.io/pgvector/pgvector:pg15' } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'cecelia-private-pg-'));
  for (const part of ['home', 'tmp']) mkdirSync(join(directory, part));
  const owner = 'ci-debt-' + randomBytes(8).toString('hex');
  const password = randomBytes(18).toString('hex');
  const port = await freePort(), name = owner;
  const env = cleanProcessEnv(directory);
  const marker = join(directory, 'owner');
  writeFileSync(marker, owner, { mode: 0o600 });
  let started = false;
  const inspectOwner = () => {
    if (nativeBin) {
      if (readFileSync(marker, 'utf8') !== owner) throw Error('native postgres owner mismatch; cleanup forbidden');
    } else {
      const label = checked('docker', ['inspect', '--format', '{{ index .Config.Labels "cecelia.ci.owner" }}', name], { env }).toString().trim();
      if (label !== owner) throw Error('docker postgres owner mismatch; cleanup forbidden');
    }
  };
  const tool = (program, args, input) => {
    if (!['psql', 'pg_dump', 'pg_isready'].includes(program)) throw Error('unapproved postgres program');
    const connection = ['-h', '127.0.0.1', '-p', String(port), '-U', 'ci_debt'];
    return nativeBin ? checked(join(nativeBin, program), [...connection, ...args], { env: { ...env, PGPASSWORD: password }, input })
      : checked('docker', ['exec', '-i', '-e', `PGPASSWORD=${password}`, name, program, ...connection, ...args], { env, input });
  };
  const close = () => {
    if (started) {
      // run 可能在拉镜像/创建容器前失败；先区分不存在和未知归属。
      const exists = nativeBin || checked('docker', ['container', 'ls', '--all', '--quiet', '--filter', `name=^/${name}$`], { env }).toString().trim();
      if (exists) inspectOwner();
      if (nativeBin) {
        const status = spawnSync(join(nativeBin, 'pg_ctl'), ['-D', join(directory, 'data'), 'status'], { env, timeout: 10000 });
        if (status.status === 0) checked(join(nativeBin, 'pg_ctl'), ['-D', join(directory, 'data'), '-m', 'immediate', '-w', 'stop'], { env });
        else if (status.status !== 3) throw Error('cannot verify native postgres stopped; preserving owned data directory');
      }
      else if (exists) checked('docker', ['rm', '-f', '-v', name], { env });
      started = false;
    }
    rmSync(directory, { recursive: true, force: true });
  };
  try {
    if (nativeBin) {
      checked(join(nativeBin, 'initdb'), ['-D', join(directory, 'data'), '-U', 'ci_debt', '--auth=trust', '--no-locale', '-E', 'UTF8'], { env });
      started = true;
      checked(join(nativeBin, 'pg_ctl'), ['-D', join(directory, 'data'), '-l', join(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${directory}`, '-w', 'start'], { env });
    } else {
      if (process.platform !== 'linux') throw Error('Docker host-network backend requires Linux; use explicit --native-bin locally');
      started = true;
      checked('docker', ['run', '-d', '--name', name, '--label', `cecelia.ci.owner=${owner}`, '--network', 'host',
        '-e', 'POSTGRES_USER=ci_debt', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=postgres', image,
        'postgres', '-h', '127.0.0.1', '-p', String(port)], { env });
    }
    started = true;
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { tool('pg_isready', ['-d', 'postgres']); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    if (!ready) throw Error('private postgres did not become ready');
    return { directory, owner, password, port, tool, close, inspectOwner,
      config: { host: '127.0.0.1', port, user: 'ci_debt', password, database: 'postgres', connectionTimeoutMillis: 3000 } };
  } catch (error) {
    try { close(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], `${error.message}; cleanup failed: ${cleanupError.message}`);
    }
    throw error;
  }
}
