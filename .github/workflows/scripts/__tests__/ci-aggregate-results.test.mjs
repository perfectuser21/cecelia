import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// 直接运行工作流聚合闸，防止依赖 cancelled 后 required check 仍然报绿。
// 只展开 needs.*.result；状态经环境变量传入，不能被当成 shell 代码执行。
function loadGate(filename, jobId) {
  const workflow = readFileSync(new URL(`../../${filename}`, import.meta.url), 'utf8');
  const lines = workflow.split('\n');
  const start = lines.indexOf(`  ${jobId}:`);
  assert.notEqual(start, -1, `找不到聚合 job：${jobId}`);
  const nextJob = lines.findIndex((line, index) => index > start && /^  [\w-]+:/.test(line));
  const job = lines.slice(start, nextJob === -1 ? undefined : nextJob);
  const needsLine = job.find((line) => /^    needs: \[.+\]$/.test(line));
  assert.ok(needsLine, `${jobId} 必须声明依赖`);
  const needs = needsLine.match(/\[(.+)\]/)[1].split(',').map((name) => name.trim());

  const runStarts = job.flatMap((line, index) => line === '        run: |' ? [index] : []);
  assert.equal(runStarts.length, 1, `${jobId} 必须有唯一聚合脚本`);
  const scriptLines = [];
  for (const line of job.slice(runStarts[0] + 1)) {
    if (line && !line.startsWith('          ')) break;
    scriptLines.push(line.slice(10));
  }
  const referencedJobs = new Set();
  const script = scriptLines.join('\n').replace(
    /\$\{\{\s*needs\.([\w-]+)\.result\s*\}\}/g,
    (_, name) => {
      referencedJobs.add(name);
      return `\${CI_AGGREGATE_RESULT_${needs.indexOf(name)}}`;
    },
  );
  assert.deepEqual([...referencedJobs].sort(), [...needs].sort(), `${jobId} 必须检查每个依赖`);
  assert.equal(script.includes('${{'), false, `${jobId} 有未展开的 Actions 表达式`);
  return { jobId, needs, script };
}

function assertGateExit(gate, overrides, expectedExit) {
  const env = { PATH: process.env.PATH };
  for (const [index, name] of gate.needs.entries()) {
    env[`CI_AGGREGATE_RESULT_${index}`] = Object.hasOwn(overrides, name) ? overrides[name] : 'success';
  }
  // 与 Actions 的 bash 默认执行行为一致；运行完整聚合脚本，而非复制判断逻辑。
  const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', gate.script], {
    env,
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, '聚合脚本必须正常结束');
  assert.equal(result.status, expectedExit, `${gate.jobId} 状态 ${JSON.stringify(overrides)} 判定错误`);
}

const ci = loadGate('ci.yml', 'ci-passed');
const smoke = loadGate('ci-smoke-glob-runner.yml', 'smoke-glob-runner-passed');
const rejectedResults = ['failure', 'cancelled', '', 'unknown'];

test('ci-passed：全部依赖成功时放行', () => {
  assertGateExit(ci, {}, 0);
});

for (const dependency of ci.needs.filter((name) => name !== 'core-regression')) {
  test(`ci-passed：${dependency} 因条件未运行时放行`, () => {
    assertGateExit(ci, { [dependency]: 'skipped' }, 0);
  });
  for (const result of rejectedResults) {
    test(`ci-passed：${dependency} 为 ${JSON.stringify(result)} 时拒绝`, () => {
      assertGateExit(ci, { [dependency]: result }, 1);
    });
  }
}

for (const result of [...rejectedResults, 'skipped']) {
  test(`ci-passed：core-regression 为 ${JSON.stringify(result)} 时拒绝`, () => {
    assertGateExit(ci, { 'core-regression': result }, 1);
  });
}

test('Smoke Glob Runner Passed：底层成功时放行', () => {
  assertGateExit(smoke, {}, 0);
});

for (const result of [...rejectedResults, 'skipped']) {
  test(`Smoke Glob Runner Passed：底层为 ${JSON.stringify(result)} 时拒绝`, () => {
    assertGateExit(smoke, { 'smoke-glob-runner': result }, 1);
  });
}
