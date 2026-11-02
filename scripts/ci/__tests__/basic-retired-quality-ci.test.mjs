import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {planChecks} from '../basic-scope.mjs';

test('已退役Quality不再创建CI组件，旧目录差分仍保守验证现役组件',()=>{
 const full=planChecks([],{full:true});
 assert.ok(!full.some(row=>row.component==='quality'));
 assert.deepEqual(planChecks(['packages/quality/old.js']),full);
 assert.ok(full.some(row=>row.component==='brain-unit'));
 assert.ok(full.some(row=>row.component==='api'));
});

test('旧Quality检查命令拒绝执行，不能静默空成功',()=>{
 const cli=new URL('../run-basic-check.mjs',import.meta.url);
 const result=spawnSync(process.execPath,[cli.pathname,'--list','quality'],{encoding:'utf8'});
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/未知 CI 组件/);
});
