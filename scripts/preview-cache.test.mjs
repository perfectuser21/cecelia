import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, lstat, rm, rename, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const module = await import('./preview-cache/service.mjs').catch(() => ({}));
const run = promisify(execFile);
const DAY = 86400000;
async function fixture(t) {
  assert.equal(typeof module.createCacheService, 'function', '缺少专属 cache 执行面');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'preview-cache-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  let time = Date.now(); let state = 'CLOSED'; let ghCalls = 0; let failRemove = false;
  const closedAt = new Date(time - 3 * DAY).toISOString();
  const github = async () => { ghCalls++; if (state === 'ERROR') throw Error('credential-hidden');
    return { state, closedAt, mergedAt: null, headRefOid: 'a'.repeat(40), updatedAt: closedAt,
      url: 'https://github.com/perfectuser21/cecelia/pull/42' }; };
  const service = module.createCacheService({ root, now: () => time, github,
    remove: async path => { if (failRemove) { await rm(join(path, 'partial'), { force: true }); throw Error('fixture'); }
      await rm(path, { recursive: true }); } });
  const cache = join(root, '.npm-cache-preview-42');
  const writer = async () => service.withWriter('42', async dir => {
    await writeFile(join(dir, 'partial'), '真实writer');
  });
  const request = async () => {
    time += 2 * DAY;
    const plan = await service.plan({ policy: module.POLICY });
    assert.equal(plan.resources.length, 1);
    return { ...plan.resources[0].request, task_id: randomUUID(), intent_id: randomUUID() };
  };
  return { root, cache, service, writer, request, setState: s => { state = s; },
    calls: () => ghCalls, failRemove: v => { failRemove = v; }, advance: n => { time += n; } };
}
test('真实npm writer创建新cache登记私有归属，完成24h后HTTP合同可执行并复验df', async t => {
  const f = await fixture(t);
  const pkg = join(f.root, 'npm-fixture'); await mkdir(pkg);
  await writeFile(join(pkg, 'package.json'), '{"name":"preview-cache-real-writer","version":"1.0.0"}');
  await run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--offline', '--cache', join(pkg, '.bootstrap-cache')], { cwd: pkg });
  await f.service.withWriter('42', cache => run('npm', ['ci', '--cache', cache, '--offline', '--ignore-scripts'], { cwd: pkg }));
  assert.equal((await f.service.plan({ policy: module.POLICY })).resources.length, 0);
  const req = await f.request(); const receipt = await f.service.execute(req);
  assert.equal(receipt.status, 'success'); assert.equal(receipt.actor, 'preview-agent:mmv');
  assert.equal(receipt.evidence.absent, true); assert.ok(receipt.before.available_bytes > 0);
  assert.ok(receipt.after.available_bytes > 0);
  await assert.rejects(lstat(f.cache), { code: 'ENOENT' });
  assert.deepEqual(await f.service.execute(req), receipt);
  assert.deepEqual(await f.service.receipt(req.intent_id), receipt);
  await assert.rejects(f.service.execute({ ...req, task_id: randomUUID() }), { code: 'INTENT_CONFLICT' });
  assert.equal((await lstat(join(f.root, '.preview-cache-owners'))).mode & 0o777, 0o700);
});
test('legacy未知cache继续写入但不追认归属，不生成可删候选', async t => {
  const f = await fixture(t); await mkdir(f.cache); await f.writer(); f.advance(3 * DAY);
  assert.equal((await f.service.plan({ policy: module.POLICY })).resources.length, 0);
  assert.equal(await readFile(join(f.cache, 'partial'), 'utf8'), '真实writer');
});
test('writer锁阻止计划/删除，并发writer被拒，残留锁不按时间抢占', async t => {
  const f = await fixture(t); await f.writer(); const req = await f.request();
  await f.service.withWriter('42', async () => {
    await assert.rejects(f.writer(), { code: 'RESOURCE_LOCKED' });
    await assert.rejects(f.service.execute(req), { code: 'RESOURCE_LOCKED' });
    assert.equal((await f.service.plan({ policy: module.POLICY })).resources.length, 0);
  });
  await mkdir(join(f.root, '.preview-cache-owners', 'locks', '42'));
  f.advance(999 * DAY); await assert.rejects(f.writer(), { code: 'RESOURCE_LOCKED' });
});
for (const state of ['OPEN', 'ERROR', 'UNKNOWN']) test(`execute锁内重新查询GitHub，${state}拒删`, async t => {
  const f = await fixture(t); await f.writer(); const req = await f.request(); f.setState(state);
  await assert.rejects(f.service.execute(req)); assert.ok((await lstat(f.cache)).isDirectory());
  assert.equal(f.calls(), 2);
});
for (const replace of ['inode', 'symlink']) test(`${replace}替换拒删，旁路目录/worktree/PID不触碰`, async t => {
  const f = await fixture(t); await f.writer(); const req = await f.request();
  const saved = join(f.root, 'preview-42'); await rename(f.cache, saved);
  await writeFile(join(saved, 'dirty-worktree'), 'keep');
  if (replace === 'inode') await mkdir(f.cache); else await symlink(saved, f.cache);
  await assert.rejects(f.service.execute(req), { code: 'IDENTITY_CHANGED' });
  assert.equal(await readFile(join(saved, 'dirty-worktree'), 'utf8'), 'keep');
});
test('请求过期与任意path/cmd/repo字段拒绝，删除前零副作用', async t => {
  const f = await fixture(t); await f.writer(); const req = await f.request();
  for (const key of ['path', 'cmd', 'cwd', 'env', 'repo', 'action']) {
    await assert.rejects(f.service.execute({ ...req, [key]: '/tmp' }), { code: 'INVALID_REQUEST' });
  }
  f.advance(600000); await assert.rejects(f.service.execute(req), { code: 'PLAN_EXPIRED' });
  assert.ok((await lstat(f.cache)).isDirectory());
});
test('部分删除失败持久executing；新intent拒绝，重启同intent可继续并出一次回执', async t => {
  const f = await fixture(t); await f.writer(); const req = await f.request(); f.failRemove(true);
  await assert.rejects(f.service.execute(req), { code: 'EXECUTION_UNCONFIRMED' });
  assert.equal((await f.service.receipt(req.intent_id)).status, 'executing');
  await assert.rejects(f.service.execute({ ...req, intent_id: randomUUID() }), { code: 'RESOURCE_INFLIGHT' });
  f.failRemove(false); assert.equal((await f.service.execute(req)).status, 'success');
});
test('同intent并发绑定不同资源，第二资源在删除前被阻断', async t => {
  const f = await fixture(t); await f.writer(); const req = await f.request();
  await f.service.withWriter('43', dir => writeFile(join(dir, 'partial'), 'other'));
  const owner = JSON.parse(await readFile(join(f.root, '.preview-cache-owners/owners/43.json'), 'utf8'));
  let enter; let release; const entered = new Promise(r => { enter = r; }); const hold = new Promise(r => { release = r; });
  const concurrent = module.createCacheService({ root: f.root, now: () => Date.parse(req.expires_at) - 1000,
    github: async pr => ({ state: 'CLOSED', closedAt: '2020-01-01T00:00:00Z', mergedAt: null, headRefOid: 'a'.repeat(40), updatedAt: '2020-01-01T00:00:00Z', url: `https://github.com/perfectuser21/cecelia/pull/${pr}` }),
    sample: async root => { enter(); await hold; return module.disk(root); } });
  // 两资源都已过冷却；让第一个intent停在持久化前，检验跨资源intent锁。
  owner.last_writer_finished_at = '2020-01-01T00:00:00Z';
  await writeFile(join(f.root, '.preview-cache-owners/owners/43.json'), JSON.stringify(owner));
  const first = concurrent.execute(req); await entered;
  try { await assert.rejects(Promise.race([concurrent.execute({ ...req, resource_id: owner.resource_id }), new Promise((_, reject) => setTimeout(() => reject(Error('intent锁未拦截第二资源')), 100))]), { code: 'RESOURCE_LOCKED' }); }
  finally { release(); await first; }
  assert.ok((await lstat(join(f.root, '.npm-cache-preview-43'))).isDirectory());
});
test('删除后采样失败保留executing，新实例同intent确认精确缺失，无第二次删除', async t => {
  const f = await fixture(t); await f.writer(); const req = await f.request(); let samples = 0;
  const crash = module.createCacheService({ root: f.root, now: () => Date.parse(req.expires_at) - 1000,
    github: async () => ({ state: 'CLOSED', closedAt: '2020-01-01T00:00:00Z', mergedAt: null, headRefOid: 'a'.repeat(40), updatedAt: '2020-01-01T00:00:00Z', url: 'https://github.com/perfectuser21/cecelia/pull/42' }),
    sample: async root => { if (++samples === 2) throw Error('crash-after-delete'); return module.disk(root); } });
  await assert.rejects(crash.execute(req), { code: 'EXECUTION_UNCONFIRMED' });
  await assert.rejects(lstat(f.cache), { code: 'ENOENT' });
  const restarted = module.createCacheService({ root: f.root, remove: () => assert.fail('重复删除') });
  assert.equal((await restarted.execute(req)).status, 'success');
});
test('plan零写入；journal符号链接不可信，GH固定argv不走shell', async t => {
  const f = await fixture(t);
  assert.equal((await f.service.plan({ policy: module.POLICY })).resources.length, 0);
  await assert.rejects(lstat(join(f.root, '.preview-cache-owners')), { code: 'ENOENT' });
  const bin = join(f.root, 'bin'); await mkdir(bin);
  const argsFile = join(f.root, 'argv.json');
  await writeFile(join(bin, 'gh'), `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(process.env.FIXTURE_GH_ARGS, JSON.stringify(process.argv.slice(2)));console.log('{}');\n`, { mode: 0o700 });
  const oldPath = process.env.PATH; process.env.PATH = `${bin}:${oldPath}`; process.env.FIXTURE_GH_ARGS = argsFile;
  try {
    await module.github('42');
    assert.deepEqual(JSON.parse(await readFile(argsFile, 'utf8')), ['pr','view','42','--repo','perfectuser21/cecelia','--json','state,closedAt,mergedAt,headRefOid,updatedAt,url']);
    await assert.rejects(module.github('42;touch /tmp/no'), { code: 'INVALID_PR' });
  } finally { process.env.PATH = oldPath; delete process.env.FIXTURE_GH_ARGS; }
  await f.writer();
  const path = join(f.root, '.preview-cache-owners/owners/42.json'); await rename(path, `${path}.saved`); await symlink(`${path}.saved`, path);
  await assert.rejects(f.service.plan({ policy: module.POLICY }), { code: 'UNTRUSTED_JOURNAL' });
});
for (const moment of ['before', 'after']) test(`删除${moment}真实进程退出，重启保留executing与残留锁，未知PID不触碰`, async t => {
  const f = await fixture(t); await f.writer(); const req = await f.request();
  const script = `import {createCacheService} from ${JSON.stringify(new URL('./preview-cache/service.mjs', import.meta.url).href)};
    import {rm} from 'node:fs/promises';
    const service=createCacheService({root:${JSON.stringify(f.root)},now:()=>${Date.parse(req.expires_at)-1000},
      github:async()=>({state:'CLOSED',closedAt:'2020-01-01',headRefOid:'${'a'.repeat(40)}',updatedAt:'2020-01-01',url:'https://github.com/perfectuser21/cecelia/pull/42'}),
      remove:async path=>{${moment === 'after' ? 'await rm(path,{recursive:true});' : ''}process.exit(0);}});
    await service.execute(${JSON.stringify(req)});`;
  await run(process.execPath, ['--input-type=module', '-e', script]);
  const restarted = module.createCacheService({ root: f.root });
  assert.equal((await restarted.receipt(req.intent_id)).status, 'executing');
  await assert.rejects(restarted.execute(req), { code: 'RESOURCE_LOCKED' });
  if (moment === 'before') assert.ok((await lstat(f.cache)).isDirectory()); else await assert.rejects(lstat(f.cache), { code: 'ENOENT' });
});
test('恢复时必须匹配intent记录的dev/ino，不能仅信新owner记录', async t => {
  const f = await fixture(t); await f.writer(); const req = await f.request(); f.failRemove(true);
  await assert.rejects(f.service.execute(req));
  await rename(f.cache, join(f.root, 'old-inode')); await mkdir(f.cache);
  const path = join(f.root, '.preview-cache-owners/owners/42.json');
  const owner = JSON.parse(await readFile(path, 'utf8')); const s = await lstat(f.cache);
  owner.ino = s.ino; owner.dev = s.dev; await writeFile(path, JSON.stringify(owner)); f.failRemove(false);
  await assert.rejects(f.service.execute(req), { code: 'IDENTITY_CHANGED' });
  assert.ok((await lstat(f.cache)).isDirectory());
});
