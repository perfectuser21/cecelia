import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { opsChecks } from './ops-checks.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function commandsFor(component, shard) {
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
          'src/__tests__/integration/native-agent-resource-lease.pg.integration.test.js',
          'src/__tests__/integration/native-agent-api-control.pg.integration.test.js',
          'src/__tests__/integration/native-agent-flow.pg.integration.test.js',
          'src/__tests__/integration/native-agent-notion-flow.pg.integration.test.js',
          'src/__tests__/integration/task-intake.pg.integration.test.js',
          'src/__tests__/integration/native-agent-scheduler.pg.integration.test.js',
          'src/__tests__/integration/external-exec-orphan-liveness.integration.test.js',
          'src/__tests__/integration/staging-native-business.pg.integration.test.js',
          'src/__tests__/integration/drain-process-scope.pg.integration.test.js',
          'src/__tests__/integration/executor-startup-headed-owner.pg.integration.test.js',
          'src/__tests__/integration/suggestion-plan-callback.pg.integration.test.js',
          'src/__tests__/integration/managed-script-profile.pg.integration.test.js',
          'src/__tests__/integration/workflow-common-terminal.pg.integration.test.js',
          'src/__tests__/integration/device-job-foundation.pg.integration.test.js',
          'src/__tests__/integration/graph-multi-repo-current.pg.integration.test.js',
          'src/__tests__/integration/org-map-current-contracts.pg.integration.test.js',
          'src/__tests__/integration/task-ability-compatibility.pg.integration.test.js',
          'src/__tests__/integration/reasoning-governance-contract.pg.integration.test.js', '--reporter=dot'), ciScratchDatabase: true },
        step('.', 'node', 'scripts/ci/run-debt-pg.mjs', '--file', 'packages/brain/src/__tests__/execution-strategy-session-kr-link.test.js'),
        step('.', 'node', '--test', 'scripts/ci/__tests__/runtime-signal.integration.test.mjs'),
        step('.', 'node', 'scripts/ci/basic-runtime-smoke.mjs'),
      ];
    case 'image':
      return [
        step('.', 'docker', 'build', '-f', 'packages/brain/Dockerfile', '-t', 'cecelia-brain:ci-basic', '.'),
        step('.', 'docker', 'run', '--rm', '--entrypoint', 'docker', 'cecelia-brain:ci-basic', 'buildx', 'version'),
        step('.', 'docker', 'run', '--rm', '--entrypoint', 'node', 'cecelia-brain:ci-basic', '--input-type=module', '-e',
          'import {computeBundleDigest} from "./scripts/native-agent/bundle.mjs";if(!/^[a-f0-9]{64}$/.test(computeBundleDigest("/app")))process.exit(1);await import("./scripts/native-agent/staging-business.mjs");await import("./src/__tests__/helpers/native-agent-host-fixture.js")'),
        step('.', 'docker', 'run', '--rm', '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,size=256m', '-e', 'CANDIDATE_NOEXEC_CONTRACT=1', '--entrypoint', 'node', 'cecelia-brain:ci-basic', '--test', 'scripts/native-agent/__tests__/candidate-fixture.node-test.mjs'),
      ];
    case 'dashboard':
      return [vitest('apps/api'), vitest('apps/dashboard'), step('apps/dashboard', 'npm', 'run', 'build')];
    case 'mcp': return [vitest('packages/mcp-readonly')];
    case 'ops': return opsChecks(root);
    case 'scripts': {
      const tests = readdirSync(resolve(root, 'scripts/ci/__tests__'), { withFileTypes: true })
        .filter(entry => /^(basic-.*|run-basic-check|brain-source-only-deploy)\.test\.mjs$/.test(entry.name))
        .map(entry => {
          if (!entry.isFile()) throw new Error(`Node测试入口必须是普通文件：${entry.name}`);
          return entry.name;
        }).sort().map(name => `scripts/ci/__tests__/${name}`);
      if (!tests.length) throw new Error('Node测试集合为空');
      return [
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
    const steps = commandsFor(args[0], args[1]);
    if (list) process.stdout.write(`${JSON.stringify(steps)}\n`);
    else process.exitCode = runSteps(steps);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
