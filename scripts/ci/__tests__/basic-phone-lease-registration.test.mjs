import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, cpSync, copyFileSync, writeFileSync, appendFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const {planChecks} = await import('../basic-scope.mjs');
const wrapper = 'scripts/ci/__tests__/basic-phone-lease.test.mjs';
const suites = ['us-price-lease.test.mjs', 'test_us_price_lease.py', 'test_lease_migration.py'];

test('Phone lease十项真实回归进入必需scripts集合，独立可选workflow已移除', () => {
  const result = spawnSync(process.execPath, ['scripts/ci/run-basic-check.mjs', '--list', 'scripts'], {cwd:root, encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.ok(planChecks(['docs/current/README.md']).some(row=>row.component==='scripts'), 'scripts为每次源码保底的必需跑道');
  assert.ok(JSON.parse(result.stdout).some(step=>step.args.includes(wrapper)));
  assert.equal(existsSync(join(root,'.github/workflows/us-price-lease.yml')),false);
});

for (const [index, suite] of suites.entries()) for (const kind of ['failure','empty','skip']) {
  test(`真实${suite}：${kind}必须红并停止后续命令`, t => {
    const directory=mkdtempSync(join(tmpdir(),'phone-lease-ci-'));
    t.after(()=>rmSync(directory,{recursive:true,force:true}));
    mkdirSync(join(directory,'scripts/ci/__tests__'),{recursive:true});
    copyFileSync(join(root,wrapper),join(directory,wrapper));
    cpSync(join(root,'scripts/phone-rpa'),join(directory,'scripts/phone-rpa'),{recursive:true});
    const target=join(directory,'scripts/phone-rpa',suite);
    if(kind==='empty') writeFileSync(target,'');
    else if(index===0) appendFileSync(target,kind==='failure'
      ? "\ntest('injected failure',()=>assert.fail('lease guard failure'));\n"
      : "\ntest.skip('injected skip',()=>{});\n");
    else appendFileSync(target,kind==='failure'
      ? '\nclass InjectedFailure(unittest.TestCase):\n    def test_failure(self):\n        self.fail("lease guard failure")\n'
      : '\n@unittest.skip("injected skip")\nclass InjectedSkip(unittest.TestCase):\n    def test_skip(self):\n        pass\n');
    const marker=join(directory,'must-not-run');
    if(index<2) appendFileSync(join(directory,'scripts/phone-rpa',suites[index+1]),
      `\npathlib.Path(${JSON.stringify(marker)}).write_text('ran')\n`);
    const env={...process.env};delete env.NODE_TEST_CONTEXT;
    const result=spawnSync(process.execPath,['--test',wrapper],{cwd:directory,encoding:'utf8',env,timeout:20000});
    assert.notEqual(result.status,0,result.stdout+result.stderr);
    assert.equal(result.error,undefined);
    assert.equal(existsSync(marker),false,'失败/空集合/skip之后不得继续下一套回归');
    assert.match(result.stdout+result.stderr, /Phone lease|lease guard failure|完整执行/);
  });
}
