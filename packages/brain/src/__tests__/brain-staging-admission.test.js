import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,rmSync,existsSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
const repo=resolve(import.meta.dirname,'../../../..'),sha='a'.repeat(40),digest=`sha256:${'b'.repeat(64)}`;
let dir;
afterEach(()=>{if(dir)rmSync(dir,{recursive:true,force:true});});
function run(mode){
 dir=mkdtempSync(join(tmpdir(),'brain-admission-'));
 for(const sub of ['scripts/lib','packages/brain','bin','logs','state'])mkdirSync(join(dir,sub),{recursive:true});
 for(const file of ['brain-deploy.sh','staging-deploy.sh','lib/brain-staging.sh','staging-verify.sh']){
  const from=join(repo,'scripts',file);if(existsSync(from))copyFileSync(from,join(dir,'scripts',file));
 }
 writeFileSync(join(dir,'packages/brain/package.json'),JSON.stringify({version:'1.445.48'}));
 writeFileSync(join(dir,'scripts/lib/bluegreen.sh'),'send_bark(){ :; }\n');
 writeFileSync(join(dir,'scripts/lib/internal-auth-token.sh'),'ensure_cecelia_internal_token(){ :; }\n');
 writeFileSync(join(dir,'scripts/lib/brain-image-retention.sh'),'RETENTION_COMPOSE_ARGS=()\nretention_begin(){ :; }\nretention_finish(){ :; }\n');
 writeFileSync(join(dir,'scripts/brain-build.sh'),'echo build >> "$EVENTS"\n');
 for(const file of ['.env.docker','.env.staging'])writeFileSync(join(dir,file),'DB_NAME=cecelia_staging\n');
 const docker=`#!/usr/bin/env bash
set -e
echo "$*" >> "$COMMANDS"
case "$1" in
 info) exit 0;;
 image) [[ "$MODE" != missing-image ]] || exit 1; if [[ "$*" == *Config.Env* ]]; then echo "GIT_SHA=$SHA"; else echo "$DIGEST"; fi; exit 0;;
 network)
  if [[ "$2" == inspect ]]; then
   [[ -f "$STATE/network" ]] || exit 1
   if [[ "$*" == *cecelia.staging.request* ]]; then cat "$STATE/network"; elif [[ "$*" == *cecelia.staging* ]]; then echo admission-v1; fi
  elif [[ "$2" == create ]]; then for arg in "$@"; do case "$arg" in cecelia.staging.request=*) echo "$arg" | cut -d= -f2 > "$STATE/network";; esac; done
  elif [[ "$2" == rm ]]; then rm -f "$STATE/network"; fi
  exit 0;;
 inspect)
  if [[ "$*" == *cecelia.staging.request* ]]; then cat "$STATE/$2"; exit; fi
  if [[ "$*" == *cecelia.staging* ]]; then echo admission-v1; exit; fi
  if [[ "$*" != *--format* ]]; then [[ -f "$STATE/$2" ]]; exit; fi
  if [[ "$*" == *State.Health* ]]; then echo healthy; elif [[ "$*" == *'{{.Image}}'* || "$*" == *'{{.Id}}'* ]]; then if [[ "$MODE" == wrong-digest ]]; then echo "sha256:wrong"; else echo "$DIGEST"; fi; else exit 1; fi; exit 0;;
 rm) for arg in "$@"; do case "$arg" in cecelia-admission-*) rm -f "$STATE/$arg";; esac; done; exit 0;;
 stop|tag) exit 0;;
 run)
  name=""; previous=""; owner=""
  for arg in "$@"; do
   [[ "$previous" != --name ]] || name="$arg"
   case "$arg" in cecelia.staging.request=*) owner=$(echo "$arg" | cut -d= -f2);; esac
   previous="$arg"
  done
  [[ -z "$name" ]] || printf '%s' "$owner" > "$STATE/$name"
  if [[ "$*" == *src/migrate.js* ]]; then
   if [[ "$*" == *'.env.docker'* ]]; then echo production-migrate >> "$EVENTS"; exit 88; fi
   echo staging-migrate >> "$EVENTS"; [[ "$MODE" != migration-failure ]] || exit 9
  fi
  echo container; exit 0;;
 exec)
  if [[ "$*" == *pg_total_relation_size* ]]; then echo 100000000; exit 0; fi
  if [[ "$*" == *'df -Pk'* ]]; then if [[ "$MODE" == disk-full ]]; then printf 'Filesystem 1024-blocks Used Available Capacity Mounted\nfixture 1000 950 50 95%% /\n'; exit; fi; printf "Filesystem 1024-blocks Used Available Capacity Mounted\nfixture 30000000 5000000 25000000 10%% /\n"; exit 0; fi
  if [[ "$*" == *pg_dump* ]]; then echo dump; exit 0; fi
  if [[ "$*" == *pg_restore* ]]; then cat >/dev/null; [[ "$MODE" != restore-failure ]]; exit; fi
  if [[ "$*" == *pg_isready* ]]; then exit 0; fi
  if [[ "$*" == *health* ]]; then
   echo staging-health >> "$EVENTS"
   actual="$SHA"; [[ "$MODE" != wrong-sha ]] || actual=cccccccccccccccccccccccccccccccccccccccc
   isolated=true; [[ "$MODE" != not-isolated ]] || isolated=false
   printf '{"status":"healthy","git_sha":"%s","version":"1.445.48","runtime":{"isolated":%s,"background_automation":false}}' "$actual" "$isolated"; exit 0
  fi
  if [[ "$*" == *tick/status* ]]; then echo '{"enabled":false}'; exit 0; fi
  if [[ "$*" == *current_database* ]]; then
   database=cecelia_staging; [[ "$MODE" != production-db ]] || database=cecelia
   printf '{"database":"%s","host":"stage-db","tasks_table":true}' "$database"; exit 0; fi
  if [[ "$*" == *tasks* ]]; then if [[ "$MODE" == bad-tasks ]]; then echo '{"error":"database unavailable"}'; elif [[ "$MODE" == bad-task-row ]]; then echo '[{"error":"no task"}]'; else echo '[]'; fi; exit 0; fi
  exit 0;;
esac
exit 0
`;
 writeFileSync(join(dir,'bin/docker'),docker,{mode:0o755});
 writeFileSync(join(dir,'bin/sleep'),'#!/bin/sh\nexit 0\n',{mode:0o755});
 writeFileSync(join(dir,'bin/flock'),'#!/bin/sh\nexit 0\n',{mode:0o755});
 const env={...process.env,PATH:`${dir}/bin:${process.env.PATH}`,EXPECTED_SHA:sha,SHA:sha,DIGEST:digest,MODE:mode,
  EVENTS:join(dir,'events'),COMMANDS:join(dir,'commands'),STATE:join(dir,'state'),CECELIA_INTERNAL_TOKEN:'synthetic_production_token',CECELIA_INTERNAL_ENV_FILE:join(dir,'internal.env')};
 const result=spawnSync('bash',[join(dir,'scripts/brain-deploy.sh')],{env,encoding:'utf8',timeout:10000});
 return {...result,events:existsSync(env.EVENTS)?readFileSync(env.EVENTS,'utf8'): '',commands:existsSync(env.COMMANDS)?readFileSync(env.COMMANDS,'utf8'):'',remaining:readdirSync(env.STATE),receipt:existsSync(join(dir,'logs/brain-staging-receipt.json'))?JSON.parse(readFileSync(join(dir,'logs/brain-staging-receipt.json'),'utf8')):null};
}
it.each(['migration-failure','restore-failure','wrong-sha','not-isolated','wrong-digest','missing-image','disk-full','bad-tasks','bad-task-row','production-db'])('候选%s阻断生产迁移与切换',mode=>{
 const result=run(mode);expect(result.events,result.stderr+result.stdout).not.toContain('production-migrate');
 expect(result.status).not.toBe(0);expect(result.remaining).toEqual([]);if(mode!=='missing-image')expect(result.receipt.status).toBe('failed');expect(result.commands).not.toMatch(/stop cecelia-node-brain(?:\n|$)/);
});
it('同一镜像通过隔离候选验收后才开始生产迁移',()=>{
 const result=run('success');expect(result.status,result.stderr+result.stdout).toBe(88);
 expect(result.events.split('\n').filter(Boolean)).toEqual(['build','staging-migrate','staging-health','production-migrate']);
 expect(result.remaining).toEqual([]);expect(result.receipt.database).toEqual({database:'cecelia_staging',host:'stage-db',tasks_table:true});
 expect(result.commands).toContain('--internal');expect(result.commands).toContain('BRAIN_PREVIEW=1');
 const candidates=result.commands.split('\n').filter(line=>line.startsWith('run ')&&!line.includes('.env.docker'));
 expect(candidates.length).toBe(3);for(const command of candidates){expect(command).not.toMatch(/--env-file|CECELIA_INTERNAL_TOKEN|CECELIA_INTERNAL_ENV_FILE|synthetic_production_token|\.credentials|--network host/);}
 expect(result.commands).toContain(digest);expect(result.commands).not.toContain('--env-file '+join(dir,'.env.staging'));
});
