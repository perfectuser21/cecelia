import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export function clientCommands(source) {
  return source.split('\n').filter(line => !line.trim().startsWith('#')).join('\n')
    .replace(/\b(?:command\s+-v|which)\s+(?:psql|curl)\b/g, '')
    .replace(/\b(?:echo|log|skip|fail|printf|ok|pass)\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g,
      (command, argument) => argument.includes('$(') || argument.includes('`') ? command : '');
}
export async function fixture(run, { health } = {}) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.endsWith('/health')) {
        res.end(JSON.stringify(health || { local_execution: { role: process.env.GUARD_FIXTURE_ROLE || 'executor' } }));
      } else if (req.method === 'POST') {
        const data = JSON.parse(body);
        res.statusCode = data.title || data.name ? 201 : 400;
        res.end(JSON.stringify({ id: '00000000-0000-0000-0000-000000000001', warnings: [] }));
      } else { res.end('{}'); }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const temp = await mkdtemp(resolve(tmpdir(), 'smoke-write-guard-'));
  const dockerLog = resolve(temp, 'docker-calls');
  const psqlLog = resolve(temp, 'psql-calls');
  const boundaryLog = resolve(temp, 'external-boundary');
  const boundaryScript = resolve(temp, 'boundary.sh');
  await writeFile(boundaryScript, `set -T
guard_fixture_boundary() {
  case "$BASH_COMMAND" in *smoke-production-guard.mjs*) return;; esac
  case "$BASH_COMMAND" in
    cd\\ *|node\\ *|psql\\ *|docker\\ *|git\\ *|mkdir\\ *|mktemp\\ *|cat\\ *|grep\\ *|date\\ *|command\\ *|npx\\ *|bash\\ *|"\\$PSQL"*|"\\\"\\$PSQL"*)
      printf reached > "$GUARD_BOUNDARY_LOG"; exit 97;;
  esac
}
trap guard_fixture_boundary DEBUG
`);
  await writeFile(resolve(temp, 'docker'), '#!/usr/bin/env node\nconst fs = require("node:fs"); fs.appendFileSync(process.env.GUARD_DOCKER_LOG, JSON.stringify(process.argv.slice(2))+"\\n"); if(process.argv[2]==="context") { if(process.env.GUARD_DOCKER_CONTEXT_ERROR==="1") process.exit(1); if(process.argv[3]==="show") process.stdout.write(process.env.GUARD_DOCKER_ACTIVE_CONTEXT || "default"); else process.stdout.write(JSON.stringify(process.env.GUARD_DOCKER_ENDPOINT || "unix:///tmp/guard-fixture.sock")); } else if(process.argv[2]==="exec") process.stdout.write("fixture-token"); else process.stdout.write(process.env.GUARD_DOCKER_FIXTURE);\n', { mode: 0o755 });
  await writeFile(resolve(temp, 'psql'), '#!/usr/bin/env node\nconst fs=require("node:fs"); fs.appendFileSync(process.env.GUARD_PSQL_LOG,JSON.stringify(process.argv.slice(2))+"\\n"); if (process.env.GUARD_NATIVE_PSQL) { const {spawnSync}=require("node:child_process"); const env={...process.env}; for(const k of ["PGHOSTADDR","PGSERVICE","PGSERVICEFILE"]) if(!env[k]) delete env[k]; const r=spawnSync(process.env.GUARD_NATIVE_PSQL,process.argv.slice(2),{stdio:"inherit",env,timeout:3000,killSignal:"SIGKILL"}); process.exit(r.status ?? 1); } console.log(1);\n', { mode: 0o755 });
  const info = { State: { Running: true }, Config: { Env: ['NODE_ENV=test', 'DB_NAME=cecelia_test', `BRAIN_PORT=${port}`] }, HostConfig: { NetworkMode: 'host' }, NetworkSettings: { Ports: {} } };
  async function smoke(script, overrides = {}, dockerInfo = info, guardOnly = false, scriptArgs = []) {
    let args = [script === '-c' || script.includes('/') ? script : `packages/brain/scripts/smoke/${script.endsWith('.sh') ? script : script + '-smoke.sh'}`, ...scriptArgs];
    if (guardOnly) {
      const source = await readFile(resolve(root, args[0]), 'utf8');
      const prefix = source.slice(0, source.indexOf('\nfi') + 3)
        .replace(/\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/\.\.\/lib/g, resolve(root, 'packages/brain/scripts/lib'));
      args = ['-c', prefix + '\nprintf "GUARD_ACCEPTED"\n'];
    }
    return new Promise((resolve, reject) => {
      const boundaryEnv = overrides.GUARD_EXECUTION_BOUNDARY === '1'
        ? { BASH_ENV: boundaryScript, GUARD_BOUNDARY_LOG: boundaryLog } : {};
      const proc = spawn('bash', args, {
        cwd: root,
        env: { ...process.env, PATH: `${temp}:${process.env.PATH}`, BRAIN: `http://127.0.0.1:${port}`, BRAIN_URL: `http://127.0.0.1:${port}`, BRAIN_CONTAINER: 'cecelia-brain-smoke', DATABASE_URL: 'postgresql://cecelia@localhost:5432/cecelia_test', SMOKE_ALLOW_WRITE: '', DOCKER_HOST: '', DOCKER_CONTEXT: '', PGHOSTADDR: '', PGSERVICE: '', PGSERVICEFILE: '', http_proxy: '', HTTP_PROXY: '', https_proxy: '', HTTPS_PROXY: '', all_proxy: '', ALL_PROXY: '', GUARD_DOCKER_LOG: dockerLog, GUARD_PSQL_LOG: psqlLog, GUARD_DOCKER_FIXTURE: JSON.stringify(dockerInfo), ...overrides, ...boundaryEnv },
      });
      let output = '';
      proc.stdout.on('data', data => { output += data; });
      proc.stderr.on('data', data => { output += data; });
      proc.on('error', reject);
      proc.on('close', code => resolve({ code, output }));
    });
  }
  async function dockerCalls() {
    let contents;
    try { contents = await readFile(dockerLog, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return contents.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  }
  async function psqlCalls() {
    try { return (await readFile(psqlLog, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async function reachedBoundary() {
    try { await readFile(boundaryLog); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  try { await run({ requests, smoke, info, port, dockerCalls, psqlCalls, reachedBoundary }); }
  finally { await new Promise(resolve => server.close(resolve)); await rm(temp, { recursive: true, force: true }); }
}
