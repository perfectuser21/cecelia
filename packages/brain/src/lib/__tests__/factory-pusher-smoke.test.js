import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

it('现行工厂smoke内嵌Node实际验证v2构建/缺材料阻断/gate-off兼容', () => {
  const script = readFileSync(new URL('../../../scripts/smoke/factory-commander-route-smoke.sh', import.meta.url), 'utf8');
  const body = script.match(/<<'NODE'\n([\s\S]*?)\nNODE\n/)[1];
  const imports = body.slice(0, body.indexOf('const client ='));
  const assertions = body.match(/  const cfg = [\s\S]*?(?=  const serial =)/)[0];
  // 执行smoke自身的构建断言；不连接数据库、不派发任务或模拟业务PASS。
  const output = execFileSync(process.execPath, ['--input-type=module', '-'], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)), encoding: 'utf8', timeout: 10000,
    input: `${imports}\nconst die=m=>{throw Error(m)};const ok=m=>console.log('PASS: '+m);\n${assertions}`,
  });
  expect(output).toContain('PASS: v2构建使用共享冻结定义及输入，不代表真实业务验收');
  expect(output).toContain('PASS: 缺定义或输入时资源阻断，不降级旧协议');
  expect(output).toContain('PASS: gate-off保留旧工厂建单兼容');
});
