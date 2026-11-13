// 仅显式执行旧镜像/attempt兼容回归；不接入现役Ops或Brain测试发现。
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {legacyRunnerChecks} from './ops-checks.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
for (const step of legacyRunnerChecks(root)) {
  const result = spawnSync(step.command, step.args, {cwd: step.cwd, stdio: 'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
