// 启动/安装共用的严格锁：不自动删除陈旧或未知锁，避免竞争回收删掉新持有者。
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export function strictLock(root) {
  fs.mkdirSync(root, { recursive: true });
  const dir = path.join(root, 'coding-workflow-runner.lock');
  try { fs.mkdirSync(dir); } catch (error) { if (error.code === 'EEXIST') return null; throw error; }
  const token = randomUUID();
  fs.writeFileSync(path.join(dir, 'token'), token);
  fs.writeFileSync(path.join(dir, 'pid'), String(process.pid));
  fs.writeFileSync(path.join(dir, 'started_at'), String(Date.now()));
  return { release() {
    if (fs.readFileSync(path.join(dir, 'token'), 'utf8') !== token) throw new Error('runtime_lock_owner_changed');
    fs.rmSync(dir, { recursive: true });
  } };
}
