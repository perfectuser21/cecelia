// deploy-token.test.mjs — 预览代理部署令牌加载（任务 6f937566 ②：令牌移出 plist）
//
// 背景：com.cecelia.preview-agent.plist 的 EnvironmentVariables 里明文写着 DEPLOY_TOKEN，
// 来源是 preview-agent-install.sh 把令牌写进 plist、preview-agent.mjs 又只认环境变量。
// 改为：环境变量优先，否则读凭据文件（默认 ~/.credentials/cecelia-deploy-token.env，
// 与 coding-workflow runner 同一个文件）；两处都没有则拒绝启动。令牌原文绝不进日志/序列化输出。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect, promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mod = await import('../deploy-token.mjs').catch(() => ({}));
const run = promisify(execFile);
const SECRET = 'tok_' + 'f'.repeat(60);

function api() {
  assert.equal(typeof mod.loadDeployToken, 'function', '缺少 loadDeployToken');
  assert.equal(typeof mod.describeTokenSource, 'function', '缺少 describeTokenSource');
  return mod;
}
const noFile = () => { const e = new Error('ENOENT: no such file'); e.code = 'ENOENT'; throw e; };

test('环境变量里有 DEPLOY_TOKEN → 用环境变量，不读文件', () => {
  const { loadDeployToken } = api();
  let read = 0;
  const r = loadDeployToken({ env: { DEPLOY_TOKEN: SECRET }, home: '/h', readFile: () => { read++; return ''; } });
  assert.equal(r.token, SECRET);
  assert.equal(r.source, 'env');
  assert.equal(read, 0);
});

test('环境变量没有 → 读默认凭据文件 ~/.credentials/cecelia-deploy-token.env', () => {
  const { loadDeployToken } = api();
  let path;
  const r = loadDeployToken({ env: {}, home: '/h', readFile: (p) => { path = p; return `# c\nDEPLOY_TOKEN=${SECRET}\n`; } });
  assert.equal(path, '/h/.credentials/cecelia-deploy-token.env');
  assert.equal(r.token, SECRET);
  assert.equal(r.source, 'file');
});

test('DEPLOY_TOKEN_FILE 可覆盖文件路径；支持 export 前缀与引号', () => {
  const { loadDeployToken } = api();
  for (const body of [`export DEPLOY_TOKEN="${SECRET}"`, `DEPLOY_TOKEN='${SECRET}'`, `  export DEPLOY_TOKEN=${SECRET}  `]) {
    let path;
    const r = loadDeployToken({ env: { DEPLOY_TOKEN_FILE: '/x/t.env' }, home: '/h', readFile: (p) => { path = p; return `OTHER=1\n${body}\n`; } });
    assert.equal(path, '/x/t.env');
    assert.equal(r.token, SECRET, body);
  }
});

test('只认 DEPLOY_TOKEN 这一行，不把别的变量（如 CODING_WF_DEPLOY_TOKEN）当令牌', () => {
  const { loadDeployToken } = api();
  const r = loadDeployToken({ env: {}, home: '/h', readFile: () => 'CODING_WF_DEPLOY_TOKEN=nope\nDEPLOY_TOKEN_X=nope\n' });
  assert.equal(r.token, null);
  assert.equal(r.reason, 'no_deploy_token_line');
});

test('两处都没有 → token=null 且给出原因（代理据此拒绝启动）', () => {
  const { loadDeployToken } = api();
  const r = loadDeployToken({ env: {}, home: '/h', readFile: noFile });
  assert.equal(r.token, null);
  assert.equal(r.reason, 'file_missing');
  const empty = loadDeployToken({ env: {}, home: '/h', readFile: () => 'DEPLOY_TOKEN=\n' });
  assert.equal(empty.token, null);
});

test('令牌原文不出现在序列化/inspect/来源描述里', () => {
  const { loadDeployToken, describeTokenSource } = api();
  for (const r of [
    loadDeployToken({ env: { DEPLOY_TOKEN: SECRET }, home: '/h', readFile: noFile }),
    loadDeployToken({ env: {}, home: '/h', readFile: () => `DEPLOY_TOKEN=${SECRET}\n` }),
  ]) {
    assert.equal(r.token, SECRET);
    assert.ok(!JSON.stringify(r).includes(SECRET), 'JSON.stringify 泄露令牌');
    assert.ok(!inspect(r, { depth: 5 }).includes(SECRET), 'inspect 泄露令牌');
    assert.ok(!describeTokenSource(r).includes(SECRET), '来源描述泄露令牌');
  }
});

test('CLI check：文件有令牌 → 退出 0 且输出不含令牌；缺文件 → 退出 1', async (t) => {
  api();
  const dir = await mkdtemp(join(tmpdir(), 'deploy-token-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, '.credentials'));
  await writeFile(join(dir, '.credentials', 'cecelia-deploy-token.env'), `DEPLOY_TOKEN=${SECRET}\n`, { mode: 0o600 });
  const cli = fileURLToPath(new URL('../deploy-token.mjs', import.meta.url));
  const env = { PATH: process.env.PATH, HOME: dir };
  const ok = await run(process.execPath, [cli, 'check'], { env });
  assert.ok(!(ok.stdout + ok.stderr).includes(SECRET));
  await assert.rejects(
    run(process.execPath, [cli, 'check'], { env: { ...env, DEPLOY_TOKEN_FILE: join(dir, 'missing.env') } }),
    (err) => err.code === 1 && !String(err.stdout + err.stderr).includes(SECRET),
  );
});

test('resolveReleaseSha：优先读 .release-sha，其次 git HEAD，都没有返回 null', () => {
  assert.equal(typeof mod.resolveReleaseSha, 'function', '缺少 resolveReleaseSha');
  const a = 'a'.repeat(40);
  const b = 'b'.repeat(40);
  assert.equal(mod.resolveReleaseSha({ root: '/r', readFile: () => `${a}\n`, gitHead: () => b }), a);
  assert.equal(mod.resolveReleaseSha({ root: '/r', readFile: noFile, gitHead: () => `${b}\n` }), b);
  assert.equal(mod.resolveReleaseSha({ root: '/r', readFile: () => 'garbage', gitHead: () => { throw new Error('no git'); } }), null);
});
