import { it,expect } from 'vitest';
import { mkdtempSync,writeFileSync,rmSync,existsSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const helper=fileURLToPath(new URL('../../../scripts/lib/internal-auth-token.sh',import.meta.url));
function run(os,mode){
 const dir=mkdtempSync(join(tmpdir(),'auth-file-mode-'));
 try{
  const env=join(dir,'env'),marker=join(dir,'chmod-attempted'),calls=join(dir,'stat-arguments');writeFileSync(env,'CECELIA_INTERNAL_TOKEN='+ 'a'.repeat(64)+'\n',{mode:0o600});
  for(const [name,script] of Object.entries({
   uname:'printf "%s\\n" "$MODE_PROBE_OS"',
   stat:'printf "%s\\n" "$1" >> "$MODE_PROBE_CALLS"; if [ "$1" = "-f" ] && [ "$MODE_PROBE_OS" = Linux ]; then printf "File: filesystem metadata\\n"; exit 1; fi; printf "%s\\n" "$MODE_PROBE_MODE"',
   chmod:': > "$MODE_PROBE_MARKER"; exit 1',
  }))writeFileSync(join(dir,name),'#!/bin/sh\n'+script+'\n',{mode:0o755});
  const result=spawnSync('bash',['-c','source "$1"; ensure_cecelia_internal_token "$2"','_',helper,env],{encoding:'utf8',env:{...process.env,PATH:dir+':'+process.env.PATH,MODE_PROBE_OS:os,MODE_PROBE_MODE:mode,MODE_PROBE_MARKER:marker,MODE_PROBE_CALLS:calls}});
  return {stat:existsSync(calls)?readFileSync(calls,'utf8'):null,status:result.status,chmod:existsSync(marker),output:result.stdout+result.stderr};
 }finally{rmSync(dir,{recursive:true,force:true});}
}
it('Linux和Darwin现有600只读文件直接复用，stat失败stdout不会引发chmod',()=>{
 for(const os of ['Linux','Darwin']){const result=run(os,'600');expect(result.stat).toBe(os==='Linux'?'-c\n':'-f\n');expect(result.status).toBe(0);expect(result.chmod).toBe(false);expect(result.output).not.toContain('a'.repeat(64));}
});
it('坏权限在只读环境无法修复时明确拒绝，不返回成功或输出凭据',()=>{
 const result=run('Linux','644');expect(result.status).not.toBe(0);expect(result.chmod).toBe(true);expect(result.output).not.toContain('a'.repeat(64));
});
