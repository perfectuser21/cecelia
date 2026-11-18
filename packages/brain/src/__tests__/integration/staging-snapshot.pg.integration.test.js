import { it, expect } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { DB_DEFAULTS } from '../../db-config.js';

// CI 从本作业的 PG service 取客户端，本机用已安装的同主版本客户端。
function snapshotService(serverAddress) {
  const expected = process.env.CI_PG_SERVER_ADDRESS;
  if (!expected) return;
  expect(serverAddress).toBe(expected);

  const docker = (...args) => execFileSync('docker', args, {encoding: 'utf8'}).trim();
  const candidates = docker('ps', '--quiet', '--no-trunc', '--filter', `publish=${DB_DEFAULTS.port}/tcp`);
  expect(candidates, '数据库宿主端口必须关联运行中的容器').not.toBe('');
  const format = '{{.Id}} {{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}';
  const matches = docker('inspect', '--format', format, ...candidates.split(/\s+/))
    .split('\n')
    .map(row => row.trim().split(/\s+/))
    .filter(([, ...addresses]) => addresses.includes(expected));
  expect(matches, '数据库端口和服务地址必须唯一标识容器').toHaveLength(1);
  return matches[0][0];
}

function snapshotClient(name, dir, serverMajor, service) {
  let executable;
  if (service) {
    expect(service).toMatch(/^[a-f0-9]{64}$/);
    executable = join(dir, `service-${name}`);
    writeFileSync(executable, `#!/bin/sh
exec docker exec -i -e PGHOST=127.0.0.1 -e PGPORT=5432 -e PGDATABASE -e PGUSER -e PGPASSWORD "${service}" ${name} "$@"
`, {mode: 0o755});
  } else {
    executable = execFileSync('which', [name], {encoding: 'utf8'}).trim();
  }
  const version = execFileSync(executable, ['--version'], {encoding: 'utf8'});
  expect(version, `${name} must match PostgreSQL ${serverMajor}`).toMatch(new RegExp(`PostgreSQL\\) ${serverMajor}\\.`));
  return executable;
}

it('实际候选快照保留非空父子数据并恢复有效外键', async () => {
  // 仅操作本测试独占schema；本机只使用scratch，CI使用隔离service数据库。
  expect(process.env.CI === 'true' ? ['cecelia_scratch', 'cecelia_test'] : ['cecelia_scratch']).toContain(DB_DEFAULTS.database);
  const client = new pg.Client(DB_DEFAULTS);
  const schema = `stage_fk_${randomUUID().replaceAll('-', '')}`;
  const dir = mkdtempSync(join(tmpdir(), 'stage-fk-'));
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ${schema};
      CREATE TABLE ${schema}.captures(id integer PRIMARY KEY);
      CREATE TABLE ${schema}.capture_atoms(id integer PRIMARY KEY, capture_id integer REFERENCES ${schema}.captures(id));
      CREATE TABLE ${schema}.memory_stream(id integer PRIMARY KEY);
      CREATE TABLE ${schema}.learnings(id integer PRIMARY KEY, source_memory integer REFERENCES ${schema}.memory_stream(id));
      INSERT INTO ${schema}.captures VALUES (1);
      INSERT INTO ${schema}.capture_atoms VALUES (2,1);
      INSERT INTO ${schema}.memory_stream VALUES (3);
      INSERT INTO ${schema}.learnings VALUES (4,3);`);
    const source = readFileSync(resolve(import.meta.dirname, '../../../../../scripts/lib/brain-staging.sh'), 'utf8');
    // 运行脚本中的真实导出命令，包装器只将连接及表名空间限制到测试库和独占schema。
    const body = source.match(/docker exec cecelia-node-brain sh -ec '([^']+)' \| candidate_docker exec -i /);
    expect(body).not.toBeNull();
    const {rows: [server]} = await client.query("SELECT current_setting('server_version_num')::int / 10000 AS major, host(inet_server_addr()) AS address");
    const service = snapshotService(server.address);
    const pgDump = snapshotClient('pg_dump', dir, server.major, service);
    const pgRestore = snapshotClient('pg_restore', dir, server.major, service);
    writeFileSync(join(dir, 'pg_dump'), `#!/usr/bin/env bash\nset -euo pipefail\nargs=()\nwhile (($#)); do\n case "$1" in -h|-p|-U|-d) shift 2;; --exclude-table-data=*) args+=("--exclude-table-data=$TEST_SCHEMA.\${1#*=}"); shift;; *) args+=("$1"); shift;; esac\ndone\nexec "$REAL_PG_DUMP" "\${args[@]}" --schema="$TEST_SCHEMA"\n`, {mode:0o755});
    const env = {...process.env, PATH:`${dir}:${process.env.PATH}`, REAL_PG_DUMP:pgDump,
      TEST_SCHEMA:schema, DB_NAME:'cecelia', DB_HOST:'unused', DB_USER:'unused', DB_PASSWORD:DB_DEFAULTS.password || '',
      PGHOST:DB_DEFAULTS.host, PGPORT:String(DB_DEFAULTS.port), PGUSER:DB_DEFAULTS.user,
      PGDATABASE:DB_DEFAULTS.database, PGPASSWORD:DB_DEFAULTS.password || ''};
    const dump = spawnSync('bash', ['-ec', body[1]], {env, timeout:20000, maxBuffer:8*1024*1024});
    expect(dump.status, dump.stderr?.toString()).toBe(0);
    await client.query(`DROP SCHEMA ${schema} CASCADE`);
    const restored = spawnSync(pgRestore, ['--exit-on-error','--no-owner','--no-acl','-d',DB_DEFAULTS.database],
      {env, input:dump.stdout, encoding:'utf8', timeout:20000});
    expect(restored.status, restored.stderr).toBe(0);
    expect((await client.query(`SELECT a.id, c.id AS parent_id FROM ${schema}.capture_atoms a JOIN ${schema}.captures c ON c.id=a.capture_id`)).rows).toEqual([{id:2,parent_id:1}]);
    expect((await client.query(`SELECT l.id, m.id AS parent_id FROM ${schema}.learnings l JOIN ${schema}.memory_stream m ON m.id=l.source_memory`)).rows).toEqual([{id:4,parent_id:3}]);
    await expect(client.query(`INSERT INTO ${schema}.capture_atoms VALUES (5,999)`)).rejects.toMatchObject({code:'23503'});
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
    rmSync(dir, {recursive:true,force:true});
  }
}, 60000);
