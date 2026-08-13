import { spawnSync } from 'child_process';

/**
 * 同步执行固定命令与 argv；从不启用 shell。
 * 非零退出、超时或 spawn 错误统一抛出，调用方决定降级或中止。
 */
export function runSyncCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf-8',
    ...options,
    shell: false,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || `${command} exited with status ${result.status}`);
  }

  return String(result.stdout || '').trim();
}
