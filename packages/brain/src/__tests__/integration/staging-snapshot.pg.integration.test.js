import { it, expect } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { DB_DEFAULTS } from '../../db-config.js';

// 客户端必须来自同一个已绑定service；CI不依赖宿主预装客户端版本。
function snapshotService(serverAddress) {
  if (process.env.CI !== 'true') return '';
  if (process.env.CI_PG_SERVER_ADDRESS) expect(serverAddress).toBe(process.env.CI_PG_SERVER_ADDRESS);
  const docker = (...args) => execFileSync('docker', args, {encoding: 'utf8'}).trim();
  const candidates = docker('ps', '--quiet', '--no-trunc', '--filter', `publish=${DB_DEFAULTS.port}/tcp`);
  expect(candidates, '服务端口必须绑定唯一隔离PG容器').not.toBe('');
  const matches = docker('inspect', '--format', '{{.Id}} {{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}', ...candidates.split(/\s+/))
    .split('\n').map(row => row.trim().split(/\s+/)).filter(([, ...addresses]) => addresses.includes(serverAddress));
  expect(matches).toHaveLength(1);
  expect(matches[0][0]).toMatch(/^[a-f0-9]{64}$/);
  return matches[0][0];
}
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

it('真实完整流式快照经生产helper恢复父子、非默认schema及LOB；producer与restore错误闭锁', async () => {
  expect(process.env.CI === 'true' ? ['cecelia_scratch', 'cecelia_test'] : ['cecelia_scratch']).toContain(DB_DEFAULTS.database);
  const id = randomUUID().replaceAll('-', '');
  const source = `snapshot_src_${id}`, target = `snapshot_dst_${id}`;
  const dir = mkdtempSync(join(tmpdir(), 'stage-snapshot-'));
  const admin = new pg.Client(DB_DEFAULTS);
  let sourceClient, restoredClient, service = '';
  await admin.connect();
  try {
    const {rows: [server]} = await admin.query("SELECT current_setting('server_version_num')::int / 10000 AS major, host(inet_server_addr()) AS address, current_setting('data_directory') AS data_directory");
    service = snapshotService(server.address);
    await admin.query(`CREATE DATABASE ${source}`);
    await admin.query(`CREATE DATABASE ${target}`);
    sourceClient = new pg.Client({...DB_DEFAULTS, database: source});
    restoredClient = new pg.Client({...DB_DEFAULTS, database: target});
    await sourceClient.connect(); await restoredClient.connect();
    await sourceClient.query(`CREATE SCHEMA snapshot_extra;
      CREATE TABLE public.captures(id integer PRIMARY KEY);
      CREATE TABLE snapshot_extra.capture_atoms(id integer PRIMARY KEY, capture_id integer REFERENCES public.captures(id));
      CREATE TABLE public.memory_stream(id integer PRIMARY KEY);
      CREATE TABLE snapshot_extra.learnings(id integer PRIMARY KEY, source_memory integer REFERENCES public.memory_stream(id));
      CREATE TABLE snapshot_extra.binary_assets(id integer PRIMARY KEY, object_id oid NOT NULL);
      INSERT INTO public.captures VALUES (1); INSERT INTO snapshot_extra.capture_atoms VALUES (2,1);
      INSERT INTO public.memory_stream VALUES (3); INSERT INTO snapshot_extra.learnings VALUES (4,3);
      INSERT INTO snapshot_extra.binary_assets VALUES (1,lo_from_bytea(0,decode('000102ffabcdef','hex')));`);
    const {rows: [{bytes}]} = await sourceClient.query('SELECT pg_database_size(current_database())::text AS bytes');
    const log = join(dir, 'commands.jsonl');
    // 适配器仅选择独占测试数据库和同版本服务；完整流式管道由实际生产helper执行。
    const adapter = join(dir, 'adapter.cjs');
    writeFileSync(adapter, String.raw`
const fs=require('fs'),{spawnSync}=require('child_process');
const e=process.env,[kind,...a]=process.argv.slice(2),service=e.SNAPSHOT_SERVICE;
fs.appendFileSync(e.SNAPSHOT_LOG,JSON.stringify({kind,args:a})+'\n');
const run=(command,args,env=e)=>{const r=spawnSync(command,args,{env,stdio:'inherit'});process.exit(r.status??1);};
if(kind==='source'){
 if(a.includes('node')){process.stdout.write(e.SNAPSHOT_BYTES);process.exit(0);}
 // 实际生产dump脚本保留DB_NAME守卫和全部dump参数；连接包装器只改为独占source库。
 run('bash',a.slice(a.indexOf('sh')+1),{...e,DB_NAME:'cecelia',DB_HOST:'unused',DB_USER:'unused',DB_PASSWORD:e.PGPASSWORD});
}
if(a[0]==='inspect'){
 const f=a.at(-1);process.stdout.write(f.includes('.Id')?'e'.repeat(64):f.includes('staging.request')?e.SNAPSHOT_REQUEST:'admission-v1');process.exit(0);
}
if(a[0]!=='exec')process.exit(99);
const interactive=a[1]==='-i',at=interactive?3:2,args=a.slice(at);
if(args[0]==='pg_restore'){
 if(!interactive||args.some(x=>x.startsWith('--jobs'))||args.some(x=>x.includes('/archive')))process.exit(98);
 args[args.indexOf('-d')+1]=e.SNAPSHOT_TARGET;args[args.indexOf('-U')+1]=e.PGUSER;
 if(e.SNAPSHOT_FAIL_RESTORE==='1')args.push('--use-list=/missing-restore-list');
}
if(service){
 run('docker',['exec',...(interactive?['-i']:[]),'-e','PGUSER','-e','PGPASSWORD','-e','PGHOST=127.0.0.1','-e','PGPORT=5432',service,...args]);
}
if(args[0]==='df')args[args.length-1]=e.SNAPSHOT_DATA_DIR;
run(args[0],args.slice(1));
`);
    const dump = service ? 'docker' : execFileSync('which', ['pg_dump'], {encoding:'utf8'}).trim();
    const version = execFileSync(dump, service ? ['exec', service, 'pg_dump', '--version'] : ['--version'], {encoding:'utf8'});
    expect(version).toMatch(new RegExp(`PostgreSQL\\) ${server.major}\\.`));
    const restoreVersion=execFileSync(service?'docker':'pg_restore',service?['exec',service,'pg_restore','--version']:['--version'],{encoding:'utf8'});
    expect(restoreVersion).toMatch(new RegExp(`PostgreSQL\\) ${server.major}\\.`));
    // pg_dump命令使用整个独占数据库，不加schema/table过滤，默认完整包含大对象。
    writeFileSync(join(dir, 'pg_dump'), `#!/usr/bin/env bash
set -euo pipefail
args=()
while (($#)); do case "$1" in -h|-p|-U|-d) shift 2;; *) args+=("$1"); shift;; esac; done
${service ? `docker exec -i -e PGUSER -e PGPASSWORD -e PGHOST=127.0.0.1 -e PGPORT=5432 ${quote(service)} pg_dump` : quote(dump)} -d "$SNAPSHOT_SOURCE" "\${args[@]}"
if [[ "\${SNAPSHOT_FAIL_PRODUCER:-0}" == 1 ]]; then exit 42; fi
`, {mode:0o755});
    const request = randomUUID();
    const env = {...process.env, PATH:`${dir}:${process.env.PATH}`,
      SNAPSHOT_LOG:log, SNAPSHOT_SERVICE:service, SNAPSHOT_BYTES:bytes, SNAPSHOT_REQUEST:request,
      SNAPSHOT_SOURCE:source, SNAPSHOT_TARGET:target, SNAPSHOT_DATA_DIR:server.data_directory,
      PGHOST:DB_DEFAULTS.host, PGPORT:String(DB_DEFAULTS.port), PGUSER:DB_DEFAULTS.user, PGPASSWORD:DB_DEFAULTS.password || ''};
    const helper = resolve(import.meta.dirname, '../../../../../scripts/lib/brain-snapshot.sh');
    const body = `set -euo pipefail
source ${quote(helper)}
docker(){ node ${quote(adapter)} source "$@"; }
candidate_docker(){ node ${quote(adapter)} candidate "$@"; }
db=cecelia-admission-db; request_id="$SNAPSHOT_REQUEST"; sha=${'a'.repeat(40)}; timing_entries=
stage_snapshot_restore
printf 'MIGRATION_ALLOWED\\n'
`;
    const result = spawnSync('bash', ['-c', body], {env, encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
    expect(result.status, result.stderr+result.stdout).toBe(0);
    expect(result.stdout).toContain('MIGRATION_ALLOWED');
    expect((await restoredClient.query('SELECT a.id,c.id AS parent_id FROM snapshot_extra.capture_atoms a JOIN public.captures c ON c.id=a.capture_id')).rows).toEqual([{id:2,parent_id:1}]);
    expect((await restoredClient.query('SELECT l.id,m.id AS parent_id FROM snapshot_extra.learnings l JOIN public.memory_stream m ON m.id=l.source_memory')).rows).toEqual([{id:4,parent_id:3}]);
    expect((await restoredClient.query("SELECT encode(lo_get(object_id),'hex') AS bytes FROM snapshot_extra.binary_assets")).rows).toEqual([{bytes:'000102ffabcdef'}]);
    await expect(restoredClient.query('INSERT INTO snapshot_extra.capture_atoms VALUES (5,999)')).rejects.toMatchObject({code:'23503'});
    const commands = readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);
    const restore = commands.find(x=>x.args.includes('pg_restore'));
    expect(restore.args).toContain('-i');expect(restore.args).toContain('e'.repeat(64));expect(restore.args.some(x=>x.startsWith('--jobs'))).toBe(false);
    expect(commands.filter(x=>x.kind==='source'&&x.args.includes('sh'))).toHaveLength(1);
    const sourceDump = commands.find(x=>x.kind==='source'&&x.args.includes('sh')).args.at(-1);
    expect(sourceDump).not.toMatch(/--exclude|--schema|--table/);
    expect(commands.some(x=>x.args.some(arg=>/snapshot-(create|receive|commit|cleanup)|archive\.part/.test(arg)))).toBe(false);
    expect(result.stdout).toContain('phase=export_transfer_restore');
    // 成功恢复后仍须传播producer最后的非零退出，不能由receiver成功掩盖。
    await restoredClient.end();restoredClient=null;
    await admin.query(`DROP DATABASE ${target}`);await admin.query(`CREATE DATABASE ${target}`);
    const producerFailed=spawnSync('bash',['-c',body],{env:{...env,SNAPSHOT_FAIL_PRODUCER:'1'},encoding:'utf8',timeout:60000});
    expect(producerFailed.status,producerFailed.stderr).toBe(42);expect(producerFailed.stdout).not.toContain('MIGRATION_ALLOWED');
    restoredClient=new pg.Client({...DB_DEFAULTS,database:target});await restoredClient.connect();
    expect((await restoredClient.query('SELECT count(*)::int AS count FROM snapshot_extra.capture_atoms')).rows).toEqual([{count:1}]);
    // 真pg_restore错误也必须阻断helper之后的迁移标记。
    const failed = spawnSync('bash',['-c',body],{env:{...env,SNAPSHOT_FAIL_RESTORE:'1'},encoding:'utf8',timeout:60000});
    expect(failed.status,failed.stderr).not.toBe(0);expect(failed.stdout).not.toContain('MIGRATION_ALLOWED');
  } finally {
    if(sourceClient)await sourceClient.end();if(restoredClient)await restoredClient.end();
    await admin.query(`DROP DATABASE IF EXISTS ${target}`);await admin.query(`DROP DATABASE IF EXISTS ${source}`);
    await admin.end();rmSync(dir,{recursive:true,force:true});
  }
}, 150000);
