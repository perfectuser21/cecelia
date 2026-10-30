import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const yaml = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
const guard = 'core-regression';
const testPath = 'scripts/ci/__tests__/brain-unit-exit-contract.test.mjs';
const wrapper = yaml.match(/^          run_vitest\(\) [({]\n[\s\S]*?^          [)}]\s*$/m)?.[0]
  .split('\n').map(line => line.slice(10)).join('\n');
assert.ok(wrapper, '实际 CI run_vitest 函数必须可读取');

function executable(path, source) {
  writeFileSync(path, source);
  chmodSync(path, 0o700);
}

function runWrapper({ status = 0, text = 'Tests 5 passed (5)\n', teeStatus = 0, nativeEmpty = false,
  errexit = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'brain-unit-exit-'));
  const label = `contract-${randomUUID()}`;
  const log = `/tmp/vitest-${label}.txt`;
  try {
    writeFileSync(join(dir, 'output'), text);
    executable(join(dir, 'npx'), `#!/usr/bin/env bash
if [[ "$NATIVE_EMPTY" == 1 ]]; then
  printf 'No test files found, exiting with code determined by native option\\n'
  for arg in "$@"; do [[ "$arg" == --passWithNoTests ]] && exit 0; done
  exit 1
fi
cat "$FIXTURE_OUTPUT"
exit "$FIXTURE_EXIT"
`);
    executable(join(dir, 'tee'), `#!/usr/bin/env bash
/usr/bin/tee "$@"
exit "$FIXTURE_TEE_EXIT"
`);
    return spawnSync('bash', ['-c', `${errexit ? 'set -e' : 'set +e'}\n${wrapper}
SHARD=1
run_vitest "$1" fixture-coverage
result=$?
${errexit ? '[[ "$-" == *e* ]] || exit 88' : '[[ "$-" != *e* ]] || exit 89'}
exit "$result"
`, 'contract', label], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FIXTURE_OUTPUT: join(dir, 'output'),
        FIXTURE_EXIT: String(status), FIXTURE_TEE_EXIT: String(teeStatus), NATIVE_EMPTY: nativeEmpty ? '1' : '0' },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(log, { force: true });
  }
}

test('真实完成且两段 pipeline 成功才成功', () => {
  assert.equal(runWrapper().status, 0);
});

test('部分通过摘要不能洗掉真实 RPC/Unhandled 非零退出', () => {
  const result = runWrapper({ status: 1, text: 'Test Files 401 passed | 5 skipped (407)\nTests 4149 passed | 34 skipped (4277)\nErrors 2 errors\nError: Timeout calling onTaskUpdate\n' });
  assert.equal(result.status, 1, result.stdout + result.stderr);
});

test('OOM/worker 异常即使已有 passed 摘要仍失败', () => {
  const result = runWrapper({ status: 137, text: 'Tests 5 passed (5)\nWorker exited unexpectedly\n' });
  assert.equal(result.status, 137, result.stdout + result.stderr);
});

test('有 failed 的真实退出码保持原值', () => {
  assert.equal(runWrapper({ status: 7, text: 'Tests 1 failed | 4 passed (5)\n' }).status, 7);
});

test('错误输出中出现 NoTests 文本不能遮蔽非零退出', () => {
  assert.equal(runWrapper({ status: 2, text: 'No test files found\nfatal: RPC channel closed\n' }).status, 2);
});

test('合法空集合通过 Vitest 原生 passWithNoTests 成功', () => {
  const result = runWrapper({ nativeEmpty: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('tee 记录失败不能用 Vitest 成功掩盖', () => {
  assert.equal(runWrapper({ teeStatus: 74 }).status, 74);
});

test('调用者的 errexit 状态不被函数更改', () => {
  assert.equal(runWrapper({ errexit: true }).status, 0);
  assert.equal(runWrapper({ errexit: false }).status, 0);
});

function jobBlock(name) {
  return yaml.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-zA-Z][a-zA-Z0-9_-]*:|$(?![\\s\\S]))`, 'm'))?.[1];
}

function runBlock(block) {
  const literal = block?.match(/^        run: \|\n((?:^          .*\n|^\n)*)/m)?.[1];
  if (literal !== undefined) return literal.split('\n').map(line => line.slice(10)).join('\n');
  return block?.match(/^        run: (.+)$/m)?.[1];
}

function aggregate(result) {
  const block = jobBlock('ci-passed');
  const needs = block?.match(/^    needs: \[([^\]]+)\]/m)?.[1].split(',').map(value => value.trim()) ?? [];
  const script = runBlock(block).replace(/\$\{\{ needs\.([\w-]+)\.result \}\}/g, (_match, name) =>
    needs.includes(name) ? (name === guard ? result : 'success') : '');
  return spawnSync('bash', ['-c', script], { encoding: 'utf8', timeout: 10000 });
}

test('完整合并门禁在回归守卫成功时仍成功', () => {
  const result = aggregate('success');
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

for (const state of ['failure', 'cancelled', 'skipped', '']) {
  test(`完整合并门禁必须阻断守卫 ${state || '空结果'}`, () => {
    const result = aggregate(state);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
  });
}

test('现有必跑 job 真正执行本永久回归并传播失败', () => {
  const block = jobBlock(guard);
  assert.ok(block, '现有必跑 core-regression 必须存在');
  assert.doesNotMatch(block, /^    (?:if|continue-on-error):/m, '必跑 job 不得有条件或忽略错误');
  const steps = block.split(/^      - /m).slice(1);
  const matches = steps.filter(step => step.includes(`run: node --test ${testPath}`));
  assert.equal(matches.length, 1, '永久回归步骤必须唯一接入必跑 job');
  const step = matches[0];
  assert.doesNotMatch(step, /^        (?:if|continue-on-error):/m, '回归步骤不得有条件或忽略错误');
  const script = step.match(/^        run: (.+)$/m)?.[1];
  assert.equal(script, `node --test ${testPath}`);
  assert.ok(block.indexOf('actions/setup-node@v4') < block.indexOf(script), '使用固定 Node 后才执行');
  assert.ok(block.indexOf(script) < block.indexOf('sudo wget'), '回归在外部下载前执行');
  const dir = mkdtempSync(join(tmpdir(), 'brain-unit-job-'));
  try {
    executable(join(dir, 'node'), `#!/usr/bin/env bash
[[ "$1" == --test && "$2" == '${testPath}' ]] || exit 75
exit 9
`);
    const result = spawnSync('bash', ['-e', '-c', script], {
      encoding: 'utf8', timeout: 10000, env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    });
    assert.equal(result.status, 9, result.stdout + result.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
