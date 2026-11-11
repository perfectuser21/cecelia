import { spawnSync, execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { opsChecks } from './ops-checks.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function commandsFor(component, shard, context = {}) {
  const step = (directory, command, ...args) => ({ cwd: resolve(root, directory), command, args });
  const vitest = directory => step(directory, 'npx', '--no-install', 'vitest', 'run', '--reporter=dot', '--silent');
  const shellTests = directory => {
    const files = readdirSync(resolve(root, directory)).filter(name => name.endsWith('.test.sh')).sort();
    if (!files.length) throw new Error(`Shell 回归集合为空：${directory}`);
    return files.map(name => step('.', 'bash', `${directory}/${name}`));
  };
  const smokeSafetyTests = () => {
    const directory = 'packages/brain/scripts/smoke/__tests__';
    const files = readdirSync(resolve(root, directory), { withFileTypes: true })
      .filter(entry => entry.name.endsWith('.node-test.mjs'))
      .map(entry => {
        if (!entry.isFile()) throw new Error(`Smoke安全测试入口必须是普通文件：${entry.name}`);
        return `${directory}/${entry.name}`;
      }).sort();
    if (!files.length) throw new Error(`Smoke安全测试集合为空：${directory}`);
    return step('.', 'node', '--test', ...files);
  };
  switch (component) {
    case 'brain-unit':
      if (!/^[1-6]$/.test(String(shard))) throw new Error('Brain 分片必须为 1–6');
      return [
        ...(String(shard) === '3' ? [step('packages/brain', 'npm', 'run', 'lint'), ...shellTests('packages/brain/scripts/fleet-worker'), smokeSafetyTests()] : []),
        step('packages/brain', 'npx', '--no-install', 'vitest', 'run', `--shard=${shard}/6`, '--reporter=dot', '--silent'),
      ];
    case 'brain-integration':
      return [
        step('.', 'node', 'scripts/ci/basic-runtime-smoke.mjs', '--validate-only'),
        step('packages/brain', 'node', 'src/migrate.js'),
        { ...step('packages/brain', 'npx', '--no-install', 'vitest', 'run', '--config', '../../scripts/ci/deep-integration.config.mjs',
          'src/__tests__/integration/task-lease-device-pool.pg.integration.test.js',
          'src/__tests__/integration/executor-startup-headed-owner.pg.integration.test.js',
          'src/__tests__/integration/suggestion-plan-callback.pg.integration.test.js',
          'src/__tests__/integration/managed-script-profile.pg.integration.test.js',
          'src/__tests__/integration/workflow-common-terminal.pg.integration.test.js', '--reporter=dot'), ciScratchDatabase: true },
        step('.', 'node', '--test', 'scripts/ci/__tests__/runtime-signal.integration.test.mjs'),
        step('.', 'node', 'scripts/ci/basic-runtime-smoke.mjs'),
      ];
    case 'image':
      return [step('.', 'docker', 'build', '-f', 'packages/brain/Dockerfile', '-t', 'cecelia-brain:ci-basic', '.')];
    case 'dashboard':
      return [vitest('apps/api'), vitest('apps/dashboard'), step('apps/dashboard', 'npm', 'run', 'build')];
    case 'android':
      return [step('apps/android-agent', './gradlew', ':app:testDebugUnitTest', '--no-daemon')];
    case 'mcp': return [vitest('packages/mcp-readonly')];
    case 'ops': return opsChecks(root, {paths: context.paths ?? null});
    case 'scripts': {
      const tests = readdirSync(resolve(root, 'scripts/ci/__tests__'), { withFileTypes: true })
        .filter(entry => /^(basic-.*|run-basic-check|brain-source-only-deploy)\.test\.mjs$/.test(entry.name))
        .map(entry => {
          if (!entry.isFile()) throw new Error(`Node测试入口必须是普通文件：${entry.name}`);
          return entry.name;
        }).sort().map(name => `scripts/ci/__tests__/${name}`);
      if (!tests.length) throw new Error('Node测试集合为空');
      return [
        step('.', 'node', 'scripts/ci/check-w19-frozen.mjs'),
        step('.', 'node', '--test', ...tests),
        step('.', 'node', 'scripts/dev/check.mjs'),
        step('.', 'node', 'scripts/facts-check.mjs'),
        step('.', 'bash', 'scripts/check-version-sync.sh'),
        step('.', 'node', '.github/workflows/scripts/lint-migration-unique-version.cjs'),
        step('.', 'python3', '-m', 'unittest', 'discover', '-s', 'scripts', '-p', 'test_skill_source_ownership.py'),
        step('.', 'python3', 'scripts/skill_source_ownership.py'),
      ];
    }
    default: throw new Error(`未知 CI 组件：${component}`);
  }
}

// 仅固定事件SHA可决定PR裁剪；未知模式、缺失对象或Git失败不能当作无变更。
export function readCheckContext(env = process.env, cwd = root) {
  if (env.CI_CHECK_SCOPE === undefined || env.CI_CHECK_SCOPE === 'full') return {};
  if (env.CI_CHECK_SCOPE !== 'changed') throw new Error('Invalid CI check scope');
  const {CI_BASE_SHA: base, CI_HEAD_SHA: head} = env;
  if (![base, head].every(value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value))) {
    throw new Error('CI scope requires fixed BASE/HEAD SHA');
  }
  const raw = execFileSync('git', ['--no-replace-objects', 'diff', '--no-ext-diff', '--no-textconv', '--name-only', '--no-renames', '-z', base, head, '--'],
    {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024});
  const paths = raw ? raw.slice(0, -1).split('\0') : [];
  if (!paths.length) throw new Error('CI scope has no changed paths');
  return {paths};
}

// 只使用真实退出状态；日志中的 passed/OOM/No tests 都不是成功凭据。
export function runSteps(steps, { cwd = process.cwd(), stdio = 'inherit', env = process.env } = {}) {
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('检查集合不能为空');
  for (const step of steps) {
    if (!step?.command || !Array.isArray(step.args)) throw new Error('检查命令无效');
    const stepEnv = step.ciScratchDatabase && env.CI === 'true' && env.POSTGRES_INTEGRATION === '1'
      ? { ...env, TEST_DATABASE_URL: env.DATABASE_URL }
      : env;
    const result = spawnSync(step.command, step.args, { cwd: step.cwd || cwd, env: stepEnv, stdio });
    if (stdio === 'pipe') {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    if (result.error) {
      process.stderr.write(`${result.error.message}\n`);
      return 1;
    }
    if (result.signal) {
      process.stderr.write(`检查进程被 ${result.signal} 终止\n`);
      return 1;
    }
    if (result.status !== 0) return result.status || 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const list = args[0] === '--list';
    if (list) args.shift();
    if (args.length < 1 || args.length > 2) throw new Error('用法：run-basic-check.mjs [--list] component [shard]');
    const steps = commandsFor(args[0], args[1], readCheckContext());
    if (list) process.stdout.write(`${JSON.stringify(steps)}\n`);
    else {
      const env = {...process.env};
      // 范围只约束本次顶层执行，不污染测试自己创建的私有CLI/Git进程。
      for (const key of ['CI_CHECK_SCOPE','CI_BASE_SHA','CI_HEAD_SHA']) delete env[key];
      process.exitCode = runSteps(steps, {env});
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
