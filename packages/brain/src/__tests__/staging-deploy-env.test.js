import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
it.each([
 ['Linux宿主', '/root', undefined, '/root/.credentials/cecelia-internal.env'],
 ['Mac宿主', '/Users/administrator', undefined, '/Users/administrator/.credentials/cecelia-internal.env'],
 ['显式文件优先', '/root', '/fixture/explicit.env', '/fixture/explicit.env'],
 ['无宿主使用当前用户', undefined, undefined, `${process.env.HOME}/.credentials/cecelia-internal.env`],
])('真实staging脚本%s选同一凭据路径，dry-run零凭据写入', (_, host, explicit, expected) => {
 const root=mkdtempSync(join(tmpdir(),'staging-env-'));
 try {
  for(const p of ['scripts/lib','packages/brain','bin'])mkdirSync(join(root,p),{recursive:true});
  for(const p of ['scripts/staging-deploy.sh','scripts/lib/internal-auth-token.sh'])copyFileSync(join(repo,p),join(root,p));
  writeFileSync(join(root,'packages/brain/package.json'),'{"version":"1.0.0"}');
  writeFileSync(join(root,'.env.staging'),'');
  writeFileSync(join(root,'bin/docker'),'#!/bin/sh\nexit 99\n',{mode:0o755});
  const env={...process.env,PATH:`${root}/bin:${process.env.PATH}`};delete env.HOST_HOME;delete env.CECELIA_INTERNAL_ENV_FILE;delete env.CECELIA_INTERNAL_TOKEN;
  if(host)env.HOST_HOME=host;if(explicit)env.CECELIA_INTERNAL_ENV_FILE=explicit;
  const before=readdirSync(root,{recursive:true}).sort();
  const output=execFileSync('bash',[join(root,'scripts/staging-deploy.sh'),'--dry-run'],{env,encoding:'utf8'});
  expect(output).toContain(`[dry-run] ensure_cecelia_internal_token ${expected}\n`);
  expect(output).toContain('Staging Deploy SUCCESS');
  expect(readdirSync(root,{recursive:true}).sort()).toEqual(before);
 }finally {rmSync(root,{recursive:true,force:true});}
});
