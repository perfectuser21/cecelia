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
  switch (component) {
    case 'brain-unit':
      if (!/^[1-6]$/.test(String(shard))) throw new Error('Brain 分片必须为 1–6');
      return [
        ...(String(shard) === '1' ? [step('packages/brain', 'npm', 'run', 'lint'), ...shellTests('packages/brain/scripts/fleet-worker')] : []),
        step('packages/brain', 'npx', '--no-install', 'vitest', 'run', `--shard=${shard}/6`, '--reporter=dot', '--silent'),
      ];
    case 'brain-integration':
      return [
        step('.', 'node', 'scripts/ci/basic-runtime-smoke.mjs', '--validate-only'),
        step('packages/brain', 'node', 'src/migrate.js'),
        step('.', 'node', '--test', 'scripts/ci/__tests__/runtime-signal.integration.test.mjs'),
        step('.', 'node', 'scripts/ci/basic-runtime-smoke.mjs'),
      ];
    case 'image':
      return [step('.', 'docker', 'build', '-f', 'packages/brain/Dockerfile', '-t', 'cecelia-brain:ci-basic', '.')];
    case 'engine':
      return [
        step('packages/engine', 'npm', 'run', 'typecheck'), vitest('packages/engine'),
        ...['unit', 'integration', 'integrity'].flatMap(kind => shellTests(`packages/engine/tests/${kind}`)),
        step('packages/engine', 'npm', 'run', 'build'),
      ];
    case 'api':
      return [step('apps/api', 'npm', 'run', 'typecheck'), vitest('apps/api'), step('apps/api', 'npm', 'run', 'build')];
    case 'api-integration':
      return [step('apps/api', 'npx', '--no-install', 'vitest', 'run', '--config', 'vitest.integration.config.ts')];
    case 'dashboard':
      return [vitest('apps/dashboard'), step('apps/dashboard', 'npm', 'run', 'build')];
    case 'frontend':
      return [step('frontend', 'npm', 'run', 'build'), step('frontend', 'npx', '--no-install', 'playwright', 'install', 'chromium', '--with-deps'), step('frontend', 'npm', 'run', 'e2e')];
    case 'android':
      return [step('apps/android-agent', './gradlew', ':app:testDebugUnitTest', '--no-daemon')];
    case 'quality': return [vitest('packages/quality')];
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
        step('.', 'node', 'scripts/facts-check.mjs'),
        step('.', 'bash', 'scripts/check-version-sync.sh'),
        step('.', 'node', '.github/workflows/scripts/lint-migration-unique-version.cjs'),
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
    const result = spawnSync(step.command, step.args, { cwd: step.cwd || cwd, env, stdio });
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
