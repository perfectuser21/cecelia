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

for (const scenario of ['normal', 'brain-failure', 'cancelled', 'race', 'stale-readback']) it(`实际CLI售后：${scenario}`, async () => {
  const fails = scenario === 'brain-failure';
  const root = await mkdtemp(join(tmpdir(), 'cmdr-aftercare-'));
  let stored, firstStored, patchCount = 0;
  const server = createServer(async (req, res) => {
    if (req.method === 'PATCH') {
      patchCount++; let data = ''; for await (const chunk of req) data += chunk;
      stored = JSON.parse(data).result; if (patchCount === 1) firstStored = stored;
      res.writeHead(fails ? 503 : 200); res.end('{}');
    } else { res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ result: scenario === 'stale-readback' && patchCount > 1 ? firstStored : stored })); }
  });
  await new Promise(accept => server.listen(0, '127.0.0.1', accept));
  try {
    const prefix = join(root, 'escort-fixture-host-cmd-test');
    const context = { tag: 'cmd-test', host: 'fixture-host', escortId: id, taskId: id,
      finalized: true, nonce: 'current-nonce', brainUrl: `http://127.0.0.1:${server.address().port}` };
    await writeFile(`${prefix}.request.json`, JSON.stringify(context)); await writeFile(`${prefix}.lock`, 'test');
    if (scenario === 'cancelled') {
      await writeFile(join(root, 'disabled'), 'yes'); await writeFile(join(root, 'cancelled'), 'yes');
    }
    await writeFile(`${prefix}.json`, JSON.stringify({ schema_version: 1, run_tag: context.tag,
      host: context.host, escort_id: id, nonce: context.nonce, status: 'completed', finalize_verified: true,
      actor: 'work-commander', at: '2026-10-02T03:00:01.000Z', facts: ['终态真实读回'], evidence: ['/receipt.json'] }));
    const bin = join(root, 'cron');
    await writeFile(bin, `#!${process.execPath}\nconst fs=require('node:fs');
      const root=process.env.COMMANDER_AFTERCARE_DIR;
      fs.appendFileSync(root+'/calls',process.argv.slice(2).join(' ')+'\\n');
      if(process.argv[3]==='rm')fs.writeFileSync(root+'/removed','yes');
      if(process.argv[3]==='disable')fs.writeFileSync(root+'/disabled','yes');
      if(process.argv[3]==='disable'&&'${scenario}'==='race'&&!fs.existsSync(root+'/retried'))fs.writeFileSync(root+'/cancelled','yes');
      if(process.argv[3]==='disable'&&'${scenario}'==='stale-readback'){
        fs.writeFileSync(root+'/latest-tick','yes');
        const p=root+'/escort-fixture-host-cmd-test.json';const ack=JSON.parse(fs.readFileSync(p));
        ack.at='2026-10-02T03:00:06.000Z';fs.writeFileSync(p,JSON.stringify(ack));
      }
      if(process.argv[3]==='enable')fs.rmSync(root+'/disabled',{force:true});
      if(process.argv[3]==='run'){fs.rmSync(root+'/cancelled',{force:true});fs.writeFileSync(root+'/retried','yes');}
      const state=fs.existsSync(root+'/cancelled')?{lastRunStatus:'error',lastError:'Cron job disabled by operator.'}:{lastRunStatus:'ok',lastRunAtMs:Date.parse('2026-10-02T03:00:00.000Z'),lastDurationMs:2000};
      if(fs.existsSync(root+'/latest-tick'))state.lastRunAtMs+=5000;
      console.log(JSON.stringify({jobs:fs.existsSync(root+'/removed')?[]:[{id:'${id}',name:'escort-fixture-host-cmd-test',schedule:{kind:'every'},enabled:!fs.existsSync(root+'/disabled'),state}]}));`, { mode: 0o755 });
    await execute(process.execPath, [script, '--worker', `${prefix}.request.json`], {
      env: { ...process.env, COMMANDER_AFTERCARE_DIR: root, COMMANDER_OPENCLAW_BIN: bin }, timeout: 10000 });
    const result = JSON.parse(await readFile(`${prefix}.result.json`, 'utf8'));
    const retained = fails || scenario === 'stale-readback';
    expect(result.status).toBe(retained ? 'retained' : 'retired'); expect(patchCount).toBe(['race', 'stale-readback'].includes(scenario) ? 2 : 1);
    const calls = await readFile(join(root, 'calls'), 'utf8');
    if (retained) expect(calls).not.toContain('cron rm');
    else { expect(stored.commander_aftercare.nonce).toBe(context.nonce); expect(calls).toContain(`cron rm ${id}`); }
    if (['cancelled', 'race'].includes(scenario)) {
      expect(calls).toContain(`cron enable ${id}`); expect(calls).toContain(`cron run ${id}`);
    }
  } finally { await new Promise(accept => server.close(accept)); await rm(root, { recursive: true, force: true }); }
}, 15000);
