import { it, expect } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const script = new URL('../../scripts/commander-aftercare.mjs', import.meta.url).pathname;
const id = '11111111-2222-4333-8444-555555555555';

it('独立安装器成套原子发布CLI、模块与ESM声明，拒盖普通目录', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cmdr-install-'));
  const install = new URL('../../scripts/install-commander-runtime.mjs', import.meta.url).pathname;
  try {
    const destination = join(root, 'runtime');
    const result = JSON.parse((await execute(process.execPath, [install, destination])).stdout);
    expect(Object.keys(result.hashes)).toHaveLength(2);
    expect(JSON.parse(await readFile(join(destination, 'package.json'), 'utf8')).type).toBe('module');
    const imported = await execute(process.execPath, ['--input-type=module', '-e',
      `import { finishEscortAftercare } from '${destination}/src/commander-aftercare.js'; console.log(typeof finishEscortAftercare)`]);
    expect(imported.stdout.trim()).toBe('function');
    await expect(execute(process.execPath, [install, root])).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const fails of [false, true]) it(`实际CLI售后${fails ? '记账失败保留cron' : '写Brain并读回后注销'}`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'cmdr-aftercare-'));
  let stored, patchCount = 0;
  const server = createServer(async (req, res) => {
    if (req.method === 'PATCH') {
      patchCount++; let data = ''; for await (const chunk of req) data += chunk;
      stored = JSON.parse(data).result; res.writeHead(fails ? 503 : 200); res.end('{}');
    } else { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ result: stored })); }
  });
  await new Promise(accept => server.listen(0, '127.0.0.1', accept));
  try {
    const prefix = join(root, 'escort-fixture-host-cmd-test');
    const context = { tag: 'cmd-test', host: 'fixture-host', escortId: id, taskId: id,
      finalized: true, nonce: 'current-nonce', brainUrl: `http://127.0.0.1:${server.address().port}` };
    await writeFile(`${prefix}.request.json`, JSON.stringify(context)); await writeFile(`${prefix}.lock`, 'test');
    await writeFile(`${prefix}.json`, JSON.stringify({ schema_version: 1, run_tag: context.tag,
      host: context.host, escort_id: id, nonce: context.nonce, status: 'completed', finalize_verified: true,
      actor: 'media', facts: ['终态真实读回'], evidence: ['/receipt.json'] }));
    const bin = join(root, 'cron');
    await writeFile(bin, `#!${process.execPath}\nconst fs=require('node:fs');
      const root=process.env.COMMANDER_AFTERCARE_DIR;
      fs.appendFileSync(root+'/calls',process.argv.slice(2).join(' ')+'\\n');
      if(process.argv[3]==='rm')fs.writeFileSync(root+'/removed','yes');
      if(process.argv[3]==='disable')fs.writeFileSync(root+'/disabled','yes');
      console.log(JSON.stringify({jobs:fs.existsSync(root+'/removed')?[]:[{id:'${id}',name:'escort-fixture-host-cmd-test',schedule:{kind:'every'},enabled:!fs.existsSync(root+'/disabled'),state:{}}]}));`, { mode: 0o755 });
    await execute(process.execPath, [script, '--worker', `${prefix}.request.json`], {
      env: { ...process.env, COMMANDER_AFTERCARE_DIR: root, COMMANDER_OPENCLAW_BIN: bin }, timeout: 10000 });
    const result = JSON.parse(await readFile(`${prefix}.result.json`, 'utf8'));
    expect(result.status).toBe(fails ? 'retained' : 'retired'); expect(patchCount).toBe(1);
    const calls = await readFile(join(root, 'calls'), 'utf8');
    if (fails) expect(calls).not.toContain('cron rm');
    else { expect(stored.commander_aftercare.nonce).toBe(context.nonce); expect(calls).toContain(`cron rm ${id}`); }
  } finally { await new Promise(accept => server.close(accept)); await rm(root, { recursive: true, force: true }); }
}, 15000);
