import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createImplementationScratch} from '../implementation-scratch.mjs';
test('窄租约纯import不初始化生产pool或污染CLI stdout，旧export保持同一函数',async()=>{
 const child=spawnSync(process.execPath,['--input-type=module','-e',"await import('./scripts/ci/ci-admission-inputs.mjs');"],{cwd:new URL('../../../',import.meta.url),encoding:'utf8',env:{...process.env,NODE_ENV:'test',DB_NAME:'cecelia_scratch'}});
 assert.equal(child.status,0,child.stderr);assert.equal(child.stdout,'');
 const legacy=await import('../implementation-snapshot.mjs');assert.equal(legacy.createImplementationScratch,createImplementationScratch);
});
