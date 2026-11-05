import { afterEach, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const roots = [];
const sha = 'a'.repeat(40);
const source = fileURLToPath(new URL('../ci-diagnostics.js', import.meta.url));
// Actual installed gh only parses --help; no real API, config or credential is read.
const realGh = execFileSync('which', ['gh'], { encoding: 'utf8' }).trim();
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function runFixture(mode = 'ok') {
  const root = mkdtempSync(join(tmpdir(), 'ci-diagnostics-cli-')); roots.push(root);
  const trace = join(root, 'argv.jsonl');
  const helper = join(root, 'fixture.cjs');
  writeFileSync(helper, `
const {spawnSync}=require('node:child_process');
const {appendFileSync}=require('node:fs');
const args=process.argv.slice(2),mode=${JSON.stringify(mode)},sha=${JSON.stringify(sha)};
appendFileSync(${JSON.stringify(trace)},JSON.stringify(args)+'\\n');
const parsed=spawnSync(${JSON.stringify(realGh)},[...args,'--help'],{
 env:{HOME:${JSON.stringify(root)},GH_CONFIG_DIR:${JSON.stringify(root)},PATH:'/usr/bin:/bin'},encoding:'utf8',timeout:5000});
if(parsed.status!==0){process.stderr.write(parsed.stderr||'gh local parsing failed');process.exit(parsed.status||2);}
const same=expected=>JSON.stringify(args)===JSON.stringify(expected);
if(same(['pr','view','605','--repo','owned/repo','--json','headRefOid'])){
 if(mode==='pr-error')process.exit(2);
 process.stdout.write(JSON.stringify({headRefOid:mode==='invalid-head'?'not-a-sha':sha}));
}else if(same(['run','list','--repo','owned/repo','--commit',sha,'--status','failure','--limit','1','--json','databaseId,conclusion,headSha'])){
 if(mode==='list-error')process.exit(2);
 process.stdout.write(mode==='bad-json'?'broken':JSON.stringify(mode==='empty'?[]:[{databaseId:99,
 conclusion:mode==='success-run'?'success':'failure',headSha:mode==='foreign-head'?'b'.repeat(40):sha}]));
}else if(same(['run','view','99','--repo','owned/repo','--log-failed'])){
 if(mode==='log-error')process.exit(2);
 process.stdout.write('FAIL packages/brain/src/owned.test.js\\n2 tests failed');
}else{process.stderr.write('unexpected owned CLI arguments');process.exit(3);}
`);
  const executable = join(root, 'gh');
  // A wrapper dispatches only protocol responses, after the real gh parser accepts every argv.
  writeFileSync(executable, '#!/bin/sh\nexec "' + process.execPath + '" "' + helper + '" "$@"\n', { mode: 0o700 });
  const script = `import {diagnoseCiFailure} from ${JSON.stringify('file://' + source)};
const result=await diagnoseCiFailure({prUrl:'https://github.com/owned/repo/pull/605'});
console.log('FIXTURE_RESULT '+JSON.stringify(result));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root, env: { PATH: root + ':' + dirname(process.execPath) + ':/usr/bin:/bin', HOME: root,
      GH_CONFIG_DIR: root, TMPDIR: root }, encoding: 'utf8', timeout: 15000,
  });
  expect(child.status, child.stderr).toBe(0);
  const line = child.stdout.split('\n').find(line => line.startsWith('FIXTURE_RESULT '));
  expect(line).toBeTruthy();
  const calls = existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse) : [];
  return { result: JSON.parse(line.slice('FIXTURE_RESULT '.length)), calls };
}
it('真实defaultExec经过gh合法参数边界，以当前PR精确head诊断失败日志', () => {
  const { result, calls } = runFixture();
  expect(result).toMatchObject({ failure_class: 'test_failure', run_id: '99', retryable: false });
  expect(calls).toHaveLength(3);
  expect(calls[1]).toContain('--commit'); expect(calls[1]).toContain(sha);
});
it.each(['empty', 'invalid-head', 'foreign-head', 'success-run', 'bad-json', 'pr-error', 'list-error'])(
  '%s 不读取不明或其他commit的日志', mode => {
    const { result, calls } = runFixture(mode);
    expect(result).toBeNull(); expect(calls.some(args => args[0] === 'run' && args[1] === 'view')).toBe(false);
    if (mode === 'invalid-head' || mode === 'pr-error') expect(calls).toHaveLength(1);
  },
);
it('读取日志失败保持非致命null，不把命令错误包装成诊断结果', () => {
  const { result, calls } = runFixture('log-error');
  expect(calls).toHaveLength(3); expect(result).toBeNull();
});
