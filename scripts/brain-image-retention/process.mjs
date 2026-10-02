import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fail } from './policy.mjs';
const LIMIT = 2 * 1024 * 1024;
export async function runDockerProcess(executable, args, lease, timeoutMs) {
  await lease.assertHeld();
  return new Promise((resolve, reject) => {
    let text = '', size = 0, failure, result, killTimer, settled = false;
    const child = spawn(process.execPath, [fileURLToPath(new URL('./process-supervisor.mjs', import.meta.url)), executable, ...args], {
      detached: true, stdio: ['ignore', 'pipe', 'pipe', lease.fd, 'ipc'],
      env: { ...process.env, DOCKER_HOST: 'unix:///var/run/docker.sock', DOCKER_CONTEXT: '', DOCKER_TLS_VERIFY: '', DOCKER_CERT_PATH: '' },
    });
    const finish = error => {
      if (settled) return; settled = true; clearTimeout(timer); clearTimeout(killTimer);
      if (error) reject(error); else resolve(text);
    };
    const stop = code => {
      if (code) failure ??= fail(code);
      if (killTimer) return;
      // 由仍存活的supervisor杀自身session，调用方不猜测/复用已退出CLI的PGID。
      if (child.connected) child.send({ type: 'terminate' }, () => {});
      killTimer = setTimeout(() => {
        // 终止无法确认时保留unknown；仍活着的supervisor/CLI继承fd3，锁不能被新任务拿走。
        if (child.connected) child.disconnect();
        child.stdout.destroy(); child.stderr.destroy();
        finish(fail('DOCKER_TERMINATION_UNCONFIRMED'));
      }, 1000);
    };
    const timer = setTimeout(() => stop('DOCKER_TIMEOUT'), timeoutMs);
    child.stdout.on('data', data => { size += data.length; if (size > LIMIT) stop('DOCKER_OUTPUT_LIMIT'); else text += data.toString(); });
    child.stderr.on('data', data => { size += data.length; if (size > LIMIT) stop('DOCKER_OUTPUT_LIMIT'); });
    child.on('message', message => {
      if (message?.type !== 'result' || !Number.isInteger(message.code) || result !== undefined) return;
      result = message.code; stop(result === 0 ? null : 'DOCKER_UNCONFIRMED');
    });
    child.once('error', () => { failure = fail('DOCKER_UNCONFIRMED'); });
    child.once('exit', () => { if (result === undefined) stop('DOCKER_UNCONFIRMED'); });
    child.once('close', () => finish(failure ?? (result === 0 ? null : fail('DOCKER_UNCONFIRMED'))));
  });
}
