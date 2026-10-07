// 活动子进程测试 helper：异步 spawn（同进程内有本地假服务，不能用 spawnSync 阻塞事件循环）。
import { spawn } from 'node:child_process';

const GIT_ENV_KEYS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'];

/** 从 git 钩子（如 pre-push 跑全量测试）里继承来的 GIT_* 会让测试仓的 git 命令指向错误仓库，先剥掉再叠加显式 env。 */
function baseEnv() {
  const env = { ...process.env };
  for (const key of GIT_ENV_KEYS) delete env[key];
  return env;
}

/**
 * 以子进程运行活动脚本：stdin 写 JSON，收集 stdout/stderr。
 * result 为 JSON.parse(stdout)；stdout 不是合法 JSON 时 result 为 null。
 */
export function runActivityProcess(entry, input, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], {
      env: { ...baseEnv(), ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      let result = null;
      try {
        result = JSON.parse(stdout);
      } catch {
        result = null;
      }
      resolve({ exitCode: code, stdout, stderr, result });
    });
    child.stdin.end(JSON.stringify(input));
  });
}
