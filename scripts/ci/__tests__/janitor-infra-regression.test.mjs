import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repoRoot=fileURLToPath(new URL('../../../',import.meta.url));
for(const name of ['janitor_resident_service_exempt','janitor_system_domain_service_exempt']){
  test(`Janitor原生Shell回归：${name}`,()=>{
    const child=spawnSync('bash',[`scripts/ops/__tests__/janitor/${name}.test.sh`],{cwd:repoRoot,stdio:'inherit'});
    if(child.error)throw child.error;
    assert.equal(child.signal,null,'回归进程不得被信号中断');
    assert.equal(child.status,0,'原生回归必须真实通过');
  });
}
