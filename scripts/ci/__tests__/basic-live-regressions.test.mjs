import assert from 'node:assert/strict';
import test from 'node:test';
import {cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve('vitest/package.json', {paths:[join(root, 'packages/brain')]})), 'vitest.mjs');

// 只在私有副本破坏生产实现；基线必须正常收集并通过，导入错误不算击穿。
for (const spec of [
  {name:'learning issues 必须调用真实建单路由', file:'learnings-received.test.js', source:'routes/tasks.js',
    anchor:'for (const issue of issues_found) {', replacement:'for (const issue of []) {', minimum:9, failed:3},
  {name:'Cortex建议必须调用真实建单函数', file:'autocreate-task-from-cortex.test.js', source:'dispatch-helpers.js',
    anchor:'export async function autoCreateTasksFromCortex(rcaResult, context = {}) {',
    replacement:'export async function autoCreateTasksFromCortex(rcaResult, context = {}) { return [];', minimum:7, failed:6},
]) {
  test(spec.name, {timeout:120000}, () => {
    const directory = mkdtempSync(join(tmpdir(), 'ci-live-regression-'));
    try {
      const brain = join(directory, 'packages/brain');
      mkdirSync(brain, {recursive:true});
      writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
      cpSync(join(root,'packages/brain/src'), join(brain,'src'), {recursive:true});
      cpSync(join(root,'packages/brain/package.json'), join(brain,'package.json'));
      for (const folder of ['scripts','config']) cpSync(join(root,'packages/brain',folder), join(brain,folder), {recursive:true});
      symlinkSync(join(root,'node_modules'), join(directory,'node_modules'), 'dir');
      symlinkSync(join(root,'packages/brain/node_modules'), join(brain,'node_modules'), 'dir');
      const target = join(brain,'src',spec.source);
      const original = readFileSync(target,'utf8');
      assert.equal(original.split(spec.anchor).length, 2, '变异锚点必须唯一');
      const config = join(directory,'vitest.config.mjs');
      writeFileSync(config, `export default {resolve:{alias:{vitest:${JSON.stringify(join(dirname(cli),'dist/index.js'))}}},test:{environment:'node',include:['src/__tests__/${spec.file}'],setupFiles:['src/__tests__/helpers/supertest-loopback.js','src/__tests__/helpers/execution-directory-fixture.js'],pool:'forks',poolOptions:{forks:{minForks:1,maxForks:1}},cache:false,testTimeout:30000,hookTimeout:30000}};`);
      const execute = () => {
        const reportFile = join(directory,'report.json');
        rmSync(reportFile, {force:true});
        const result = spawnSync(process.execPath, [cli,'run','--config',config,'--reporter=json',`--outputFile=${reportFile}`], {cwd:brain,encoding:'utf8',timeout:60000});
        assert.ifError(result.error);
        assert.equal(result.signal,null,result.stderr);
        assert.ok(existsSync(reportFile),result.stdout+result.stderr);
        return {...result, report:JSON.parse(readFileSync(reportFile,'utf8'))};
      };
      const healthy = execute();
      assert.equal(healthy.status,0,healthy.stdout+healthy.stderr+JSON.stringify(healthy.report));
      assert.ok(healthy.report.numPassedTests >= spec.minimum, '必须真实收集并通过目标回归');
      writeFileSync(target,original.replace(spec.anchor,spec.replacement));
      const broken = execute();
      assert.notEqual(broken.status,0,'真实建单已失效，回归却仍然通过');
      assert.equal(broken.report.numTotalTests,healthy.report.numTotalTests,'变异不能导致未收集或导入失败');
      const assertions = broken.report.testResults.flatMap(row=>row.assertionResults);
      const failed = assertions.filter(row=>row.status==='failed');
      assert.ok(failed.length >= spec.failed,JSON.stringify(broken.report));
      assert.ok(failed.every(row=>(row.failureMessages||[]).some(message=>/AssertionError|expected .*|to (?:be|equal|have)/s.test(message))), '必须是业务断言失败');
    } finally { rmSync(directory,{recursive:true,force:true}); }
  });
}
