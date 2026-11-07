import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {commandsFor} from '../run-basic-check.mjs';

const required = [
  'src/__tests__/integration/task-lease-device-pool.pg.integration.test.js',
  'src/__tests__/integration/executor-startup-headed-owner.pg.integration.test.js',
  'src/__tests__/integration/workflow-common-terminal.pg.integration.test.js',
];
function selected() {
  const steps = commandsFor('brain-integration');
  const step = steps.find(step => required.every(file => step.args.includes(file)));
  assert.ok(step, '现役租约、外部owner及公共Runner终态PG合同必须实际进入PR跑道');
  assert.ok(step.cwd.endsWith('/packages/brain'));
  assert.ok(step.args.includes('../../scripts/ci/deep-integration.config.mjs'));
  assert.ok(!step.args.includes('--passWithNoTests'));
  const migration = steps.findIndex(row => row.args.includes('src/migrate.js'));
  assert.ok(migration >= 0 && migration < steps.indexOf(step));
  return step;
}

test('现役关键PG合同在真实数据库迁移之后进入现有Brain集成跑道', selected);

test('真实PG命令非零必须传播失败且阻止后续操作', () => {
  const step = selected();
  const directory = mkdtempSync(join(tmpdir(), 'ci-current-pg-gate-'));
  const argv = join(directory, 'argv.json'), marker = join(directory, 'must-not-run');
  try {
    writeFileSync(join(directory, 'npx'), `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(argv)},JSON.stringify(process.argv.slice(2)));process.exit(23);\n`, {mode:0o755});
    const runner = new URL('../run-basic-check.mjs', import.meta.url).href;
    const after = {command:process.execPath,args:['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)},'ran')`]};
    const source = `import {runSteps} from ${JSON.stringify(runner)};process.exitCode=runSteps(${JSON.stringify([step, after])},{stdio:'pipe'});`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      encoding:'utf8', env:{...process.env,PATH:`${directory}:${process.env.PATH}`},
    });
    assert.equal(result.status, 23, result.stdout+result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(argv,'utf8')), step.args);
    assert.equal(existsSync(marker), false);
  } finally { rmSync(directory, {recursive:true,force:true}); }
});
