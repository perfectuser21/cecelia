import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));

test('Phone lease：真实Node 5项、Python 2项及迁移3项完整执行', () => {
  const commands = [
    {command:process.execPath, args:['--test','--test-reporter=tap','scripts/phone-rpa/us-price-lease.test.mjs'], minimum:5},
    {command:'python3', args:['-m','unittest','discover','-s','scripts/phone-rpa','-p','test_us_price_lease.py'], minimum:2},
    {command:'python3', args:['-m','unittest','discover','-s','scripts/phone-rpa','-p','test_lease_migration.py'], minimum:3},
  ];
  const env={...process.env};
  // 子Node必须运行自己的测试，不继承外层node --test上下文。
  delete env.NODE_TEST_CONTEXT;
  for (const {command,args,minimum} of commands) {
    const result=spawnSync(command,args,{cwd:root,encoding:'utf8',env,timeout:20000});
    const output=(result.stdout??'')+(result.stderr??'');
    process.stdout.write(output);
    const label=`Phone lease ${args.at(-1)}`;
    assert.equal(result.error,undefined,`${label}: ${result.error?.message}`);
    assert.equal(result.signal,null,`${label}: signal ${result.signal}`);
    assert.equal(result.status,0,`${label}: 真实子进程失败`);
    // 退出码是成功前提；再验证执行数及skip，拒绝空发现或跳过却返回0。
    if(command===process.execPath) {
      const count=name=>Number([...output.matchAll(new RegExp(`^# ${name} (\\d+)\\s*$`,'gm'))].at(-1)?.[1]??NaN);
      assert.ok(count('tests')>=minimum,`${label}: 必须完整执行至少${minimum}项`);
      for(const name of ['fail','cancelled','skipped','todo']) assert.equal(count(name),0,`${label}: ${name}必须为0`);
      assert.equal(count('pass'),count('tests'),`${label}: 全部用例必须通过`);
    } else {
      const count=Number(output.match(/^Ran (\d+) tests? in /m)?.[1]??NaN);
      assert.ok(count>=minimum,`${label}: 必须完整执行至少${minimum}项`);
      assert.match(output,/^OK\s*$/m,`${label}: 不接受skip或expected failure`);
    }
  }
});
