// 单实例锁：mkdir 原子建锁目录 + 写 pid；持锁进程已死则回收。
import fs from 'node:fs';
import path from 'node:path';

const LOCK_NAME = 'coding-workflow-runner.lock';
// 刚 mkdir、还没来得及写 pid 的锁：这段时间内视为有人持有
const PID_WRITE_GRACE_MS = 60000;

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/** 已存在的锁是否陈旧（持锁进程已死、持锁超过 maxHoldMs（防 pid 复用），或长时间没写 pid）。 */
function isStale(dir, maxHoldMs) {
  const startedAt = Number(readOr(path.join(dir, 'started_at'), ''));
  if (maxHoldMs && Number.isFinite(startedAt) && startedAt > 0 && Date.now() - startedAt > maxHoldMs) return true;
  let pid;
  try {
    pid = Number(fs.readFileSync(path.join(dir, 'pid'), 'utf8').trim());
  } catch {
    try {
      return Date.now() - fs.statSync(dir).mtimeMs > PID_WRITE_GRACE_MS;
    } catch {
      return true;
    }
  }
  return !(Number.isInteger(pid) && pid > 0 && alive(pid));
}

function readOr(file, fallback) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return fallback;
  }
}

function tryMkdir(dir) {
  try {
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'started_at'), String(Date.now()));
    fs.writeFileSync(path.join(dir, 'pid'), String(process.pid));
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

/**
 * 取锁：成功返回 { path, release }，被存活进程持有（且未超 maxHoldMs）返回 null。
 * 锁内记录 pid 与启动时间；release 只删自己 pid 的锁。
 */
export function acquireLock(lockDir, { maxHoldMs } = {}) {
  fs.mkdirSync(lockDir, { recursive: true });
  const dir = path.join(lockDir, LOCK_NAME);
  let ok = tryMkdir(dir);
  if (!ok && isStale(dir, maxHoldMs)) {
    fs.rmSync(dir, { recursive: true, force: true });
    ok = tryMkdir(dir);
  }
  if (!ok) return null;
  return {
    path: dir,
    release() {
      try {
        if (fs.readFileSync(path.join(dir, 'pid'), 'utf8').trim() === String(process.pid)) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      } catch {
        // 锁已不在：无需处理
      }
    },
  };
}
