import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run=promisify(execFile);
async function fixture(t){
 const root=await realpath(await mkdtemp(join(tmpdir(),'image-deploy-')));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'scripts','lib'),{recursive:true});await mkdir(join(root,'scripts','brain-image-retention'));
 await copyFile(new URL('./lib/brain-image-retention.sh',import.meta.url),join(root,'scripts','lib','brain-image-retention.sh'));
 await writeFile(join(root,'scripts','brain-image-retention','cli.mjs'),`import fs from 'node:fs';
 fs.appendFileSync(process.env.FIXTURE_LOG,JSON.stringify(process.argv.slice(2))+'\\n');
 if(process.env.FIXTURE_FAIL==='1')process.exit(1);
 process.stdout.write(process.env.FIXTURE_DISABLED==='1'?'disabled':process.argv[2]==='begin'?process.argv[3]:'success');`);
 return {root,log:join(root,'calls'),helper:join(root,'scripts','lib','brain-image-retention.sh')};
}
test('真实shell保护入口生成单独intent并将同一ID交给finish；默认disabled不传空权威',async t=>{
 const f=await fixture(t),env={...process.env,FIXTURE_LOG:f.log};
 await run('bash',['-c','source "$1"; retention_begin 1.0.2 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; retention_finish success','_',f.helper],{env});
 const calls=(await readFile(f.log,'utf8')).trim().split('\n').map(JSON.parse);
 assert.equal(calls.length,2);assert.equal(calls[0][0],'begin');assert.match(calls[0][1],/^[a-f0-9-]{36}$/);assert.deepEqual(calls[1],['finish',calls[0][1],'success']);
 await run('bash',['-c','source "$1"; retention_begin 1.0.2 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; retention_finish success','_',f.helper],{env:{...env,FIXTURE_DISABLED:'1'}});
 assert.equal((await readFile(f.log,'utf8')).trim().split('\n').length,3);
});
test('保护落盘失败不能继续部署，finish失败不抹掉原intent',async t=>{
 const f=await fixture(t),env={...process.env,FIXTURE_LOG:f.log,FIXTURE_FAIL:'1'};
 await assert.rejects(run('bash',['-ec','source "$1"; retention_begin 1.0.2 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; echo forbidden','_',f.helper],{env}));
});
test('Docker部署先保护后build，sidecar携带同一ledger卷和intent，两条终态均验真',async()=>{
 const deploy=await readFile(new URL('./brain-deploy.sh',import.meta.url),'utf8');
 assert.ok(deploy.includes('retention_begin'));
 assert.ok(deploy.indexOf('retention_begin')<deploy.indexOf('# 1. Build image'));
 const swap=await readFile(new URL('./lib/bluegreen.sh',import.meta.url),'utf8');
 assert.match(swap,/CECELIA_IMAGE_DEPLOYMENT_ID/);assert.match(swap,/\/run\/cecelia-docker-data/);
 const sidecar=await readFile(new URL('./lib/bluegreen-sidecar.sh',import.meta.url),'utf8');
 assert.match(sidecar,/retention_finish success/);assert.match(sidecar,/retention_finish recovered/);
 const rollback=await readFile(new URL('./brain-rollback.sh',import.meta.url),'utf8');
 assert.ok(rollback.indexOf('retention_rollback')<rollback.indexOf('# Stop current'));
 assert.match(rollback,/retention_finish "\$CECELIA_ROLLBACK_OUTCOME"/);
});
test('默认disabled不引入不存在的Janitor挂载，可信intent才选择独立compose卷配置',async t=>{
 const base=await readFile(new URL('../docker-compose.us-vps.yml',import.meta.url),'utf8');
 assert.ok(!base.includes('/mnt/openclaw_data/cecelia-janitor'));
 const f=await fixture(t);
 const command='source "$1"; retention_begin 1.0.2 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; printf "%s" "${RETENTION_COMPOSE_ARGS[*]:-}"';
 const disabled=await run('bash',['-euc',command,'_',f.helper],{env:{...process.env,FIXTURE_LOG:f.log,FIXTURE_DISABLED:'1'}});
 assert.equal(disabled.stdout,'');
 const enabled=await run('bash',['-euc',command,'_',f.helper],{env:{...process.env,FIXTURE_LOG:f.log}});
 assert.match(enabled.stdout,/-f .*docker-compose.image-retention.yml/);
 const overlay=await readFile(new URL('../docker-compose.image-retention.yml',import.meta.url),'utf8');
 assert.match(overlay,/create_host_path: false/);assert.match(overlay,/\/run\/cecelia-docker-data/);
});
