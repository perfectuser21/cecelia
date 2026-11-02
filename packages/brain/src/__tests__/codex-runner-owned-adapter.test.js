import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const bridge = join(repo, 'packages/brain/scripts/codex-bridge/codex-bridge.cjs');
const runner = join(repo, 'packages/brain/scripts/codex-bridge/runner.sh');
const execute = (cmd, args, options) => new Promise((resolveRun, reject) => {
  const child = spawn(cmd, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
  child.on('error', reject); child.on('close', status => resolveRun({ status, stdout, stderr }));
});
function environment(root, extra = {}) {
  const env = { PATH: process.env.PATH, HOME: root, LANG: 'C.UTF-8', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', ...extra };
  for (const key of ['RUNNER_SH', 'WORK_DIR', 'CODEX_HOMES', 'CODEX_PROJECT_ROOT', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']) delete env[key];
  return env;
}

describe('Brain 自有 legacy Codex adapter', () => {
  it('默认workspace由bridge所在仓库派生，不依赖机器用户名或~/repos', async () => {
    const root = realpathSync(mkdtempSync('/tmp/codex-owned-default-'));
    try {
      const result = await execute(process.execPath, ['-e', 'process.stdout.write(require(process.argv[1]).resolveLegacyWorkDir())', bridge], { env: environment(root) });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe(repo);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('私有CLI在无Engine目录的隔离仓库完成dry-run且仅写本仓状态', async () => {
    const root = realpathSync(mkdtempSync('/tmp/codex-owned-cli-'));
    try {
      const target = join(root, 'packages/brain/scripts/codex-bridge/runner.sh');
      mkdirSync(dirname(target), { recursive: true }); copyFileSync(runner, target);
      const env = environment(root, { CODEX_HOME: join(root, 'account') });
      const init = await execute('git', ['init', '-q', root], { env });
      expect(init.status).toBe(0);
      const result = await execute('bash', [target, '--branch', 'cp-fixture', '--dry-run'], { cwd: root, env });
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stdout).toContain(`ProjectRoot: ${root}`);
      expect(readFileSync(join(root, '.dev-mode.cp-fixture'), 'utf8')).toContain('provider: codex');
      expect(existsSync(join(root, 'packages/engine'))).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('真实bridge适配器使用Brain runner和显式workspace，注入账号/PRD并如实返回非零', async () => {
    const root = realpathSync(mkdtempSync('/tmp/codex-owned-bridge-'));
    const requests = [];
    const server = createServer(async (req, res) => {
      let body = ''; for await (const chunk of req) body += chunk;
      requests.push({ method: req.method, url: req.url, body });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ title: '本地任务', description: '本地PRD内容' }));
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    try {
      const bin = join(root, 'bin'), workspace = join(root, 'workspace'), resultFile = join(root, 'provider.json');
      mkdirSync(bin); mkdirSync(workspace);
      const provider = join(bin, 'codex-fixture');
      writeFileSync(provider, `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(resultFile)},JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),home:process.env.CODEX_HOME,homes:process.env.CODEX_HOMES}));\n`);
      chmodSync(provider, 0o755);
      writeFileSync(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n'); chmodSync(join(bin, 'sleep'), 0o755);
      const env = environment(root, {
        CODEX_BIN: provider, CODEX_MAX_RETRIES: '1', BRAIN_URL: `http://127.0.0.1:${server.address().port}`,
        PATH: `${bin}:${process.env.PATH}`,
      });
      const script = `require(process.argv[1]).executeRunner(process.argv[2],'task-fixture','cp-owned',process.argv[3],{timeoutMs:10000,codexHomes:process.argv[2]}).then(()=>process.exit(90),e=>{process.stdout.write(JSON.stringify({error:e.error}));});`;
      const result = await execute(process.execPath, ['-e', script, bridge, join(root, 'account'), workspace], { cwd: root, env });
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stdout).toContain('exit_code_1');
      const actual = JSON.parse(readFileSync(resultFile, 'utf8'));
      expect(actual.cwd).toBe(workspace);
      expect(actual.args[0]).toBe('exec');
      expect(actual.args).toContain('danger-full-access');
      expect(actual.args).not.toContain('--cwd');
      expect(actual.args.at(-1)).toContain('本地PRD内容');
      expect(actual.args.at(-1)).toContain('cp-owned');
      expect(actual.home).toBe(join(root, 'account')); expect(actual.homes).toBe(actual.home);
      expect(requests.map(r => r.url)).toEqual(['/api/brain/tasks/task-fixture', '/api/brain/tasks/task-fixture']);
      expect(requests[1].method).toBe('PATCH');
    } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); rmSync(root, { recursive: true, force: true }); }
  });

  it.each([{ args: [] }, { args: ['--unknown-arg', 'fixture'] }])('私有CLI拒绝缺参数或未知参数：%j', async ({ args }) => {
    const root = realpathSync(mkdtempSync('/tmp/codex-owned-args-'));
    try {
      const result = await execute('bash', [runner, ...args], { env: environment(root) });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/用法|未知参数/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('OAuth账号执行不读取openai.env或注入API key；quota换号与恢复prompt仍有效', async () => {
    const root = realpathSync(mkdtempSync('/tmp/codex-owned-oauth-'));
    try {
      const bin = join(root, 'bin'), log = join(root, 'provider.jsonl');
      mkdirSync(bin); mkdirSync(join(root, '.credentials'));
      writeFileSync(join(root, '.credentials/openai.env'), 'export CODEX_API_KEY=forbidden\nexport OPENAI_API_KEY=forbidden\ntouch "$HOME/credentials-read"\n');
      const provider = join(bin, 'codex-fixture');
      writeFileSync(provider, `#!${process.execPath}\nconst fs=require('fs'),p=${JSON.stringify(log)};const count=fs.existsSync(p)?fs.readFileSync(p,'utf8').trim().split('\\n').length:0;fs.appendFileSync(p,JSON.stringify({home:process.env.CODEX_HOME,key:process.env.CODEX_API_KEY??null,openaiKey:process.env.OPENAI_API_KEY??null,args:process.argv.slice(2)})+'\\n');if(count===0){console.log('Quota exceeded');process.exit(1);}\n`);
      chmodSync(provider, 0o755);
      writeFileSync(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n'); chmodSync(join(bin, 'sleep'), 0o755);
      const first = join(root, 'oauth-first'), second = join(root, 'oauth-second');
      const env = { ...environment(root, { CODEX_BIN: provider, CODEX_MAX_RETRIES: '2', CODEX_MODEL: 'fixture-model', PATH: `${bin}:${process.env.PATH}` }),
        CODEX_HOMES: `${first}:${second}`, CODEX_HOME: join(root, 'unused-fallback'), CODEX_PROJECT_ROOT: root };
      const result = await execute('bash', [runner, '--branch', 'cp-oauth', '--skill', 'fixture-skill'], { cwd: root, env });
      expect(result.status, result.stdout + result.stderr).toBe(1);
      const calls = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      expect(calls.map(call => call.home)).toEqual([first, second, second]);
      expect(calls.every(call => call.key === null && call.openaiKey === null)).toBe(true);
      expect(existsSync(join(root, 'credentials-read'))).toBe(false);
      expect(calls[0].args.at(-1)).toContain('/fixture-skill');
      expect(calls[2].args.at(-1)).toContain('恢复上一次中断');
      expect(calls[0].args.slice(0, 5)).toEqual(['exec', '--model', 'fixture-model', '--sandbox', 'danger-full-access']);
      expect(calls.every(call => !call.args.includes('--cwd'))).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
