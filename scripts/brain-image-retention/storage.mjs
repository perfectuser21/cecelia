import { constants } from 'node:fs';
import { lstat, realpath, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { fail, UUID } from './policy.mjs';
const LIMIT = 1024 * 1024;
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function createStore(root) {
  async function directory() {
    const s = await lstat(root);
    if (!s.isDirectory() || s.isSymbolicLink() || await realpath(root) !== root || s.uid !== process.getuid() || (s.mode & 0o077)) throw fail('UNTRUSTED_STORE');
    return s;
  }
  const path = name => {
    if (!/^(ledger|config|intent-[a-f0-9-]{36}|deployment-[a-f0-9-]{36}|plan-[a-f0-9-]{36})\.json$/.test(name)) throw fail('INVALID_JOURNAL_NAME');
    return join(root, name);
  };
  async function read(name) {
    await directory(); let fd;
    try {
      fd = await open(path(name), constants.O_RDONLY | constants.O_NOFOLLOW);
      const s = await fd.stat();
      if (!s.isFile() || s.uid !== process.getuid() || (s.mode & 0o077) || s.nlink !== 1) throw fail('UNTRUSTED_JOURNAL');
      if (s.size > LIMIT) throw fail('JOURNAL_TOO_LARGE');
      // 一次有界读取，不能因并发增长而全缓冲。
      const buffer = Buffer.alloc(LIMIT + 1); const { bytesRead } = await fd.read(buffer, 0, buffer.length, 0);
      if (bytesRead > LIMIT) throw fail('JOURNAL_TOO_LARGE');
      return JSON.parse(buffer.subarray(0, bytesRead).toString());
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      if (error.code === 'ELOOP') throw fail('UNTRUSTED_JOURNAL'); throw error;
    } finally { await fd?.close(); }
  }
  async function save(name, value, lease) {
    await lease.assertHeld(); const data = Buffer.from(JSON.stringify(value));
    if (data.length > LIMIT) throw fail('JOURNAL_TOO_LARGE');
    const destination = path(name), temporary = `${destination}.${randomUUID()}.tmp`;
    const fd = await open(temporary, 'wx', 0o600);
    try { await fd.writeFile(data); await fd.sync(); } finally { await fd.close(); }
    try {
      await lease.assertHeld(); await rename(temporary, destination);
      const dir = await open(root, 'r'); try { await dir.sync(); } finally { await dir.close(); }
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  async function withLock(callback) {
    const dir = await directory(), lockPath = join(root, 'operation.lock');
    const fd = await open(lockPath, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
    let held = false;
    try {
      const identity = await fd.stat();
      if (!identity.isFile() || identity.uid !== process.getuid() || (identity.mode & 0o077) || identity.nlink !== 1) throw fail('UNTRUSTED_LOCK');
      // flock(2)绑定共享open-file-description；helper退出后由本进程fd持锁。
      await new Promise((resolve, reject) => {
        const child = spawn('flock', ['-n', '-E', '75', '3'], { stdio: ['ignore', 'ignore', 'ignore', fd.fd] });
        child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(fail(code === 75 ? 'IMAGE_RETENTION_BUSY' : 'LOCK_UNAVAILABLE')));
      });
      held = true;
      const lease = Object.freeze({ fd: fd.fd, assertHeld: async () => {
        const current = await lstat(lockPath), currentDir = await directory();
        if (!held || !current.isFile() || current.uid !== process.getuid() || (current.mode & 0o077) || current.dev !== identity.dev || current.ino !== identity.ino || current.nlink !== 1
            || currentDir.dev !== dir.dev || currentDir.ino !== dir.ino) throw fail('LOCK_IDENTITY_CHANGED');
      } });
      await lease.assertHeld(); return await callback(lease);
    } finally { held = false; await fd.close(); }
  }
  const intentName = id => { if (!UUID.test(id)) throw fail('INVALID_INTENT'); return `intent-${id}.json`; };
  const intent = id => read(intentName(id));
  async function claim(request, lease) {
    const name = intentName(request.intent_id), old = await read(name), hash = digest(request);
    if (old) { if (old.digest !== hash) throw fail('INTENT_CONFLICT'); return old; }
    const row = { schema_version: 1, request, digest: hash, receipt: null };
    await save(name, row, lease); return row;
  }
  async function complete(id, receipt, lease) {
    const old = await intent(id); if (!old) throw fail('INTENT_MISSING');
    if (old.receipt && digest(old.receipt) !== digest(receipt)) throw fail('RECEIPT_CONFLICT');
    await save(intentName(id), { ...old, receipt }, lease); return receipt;
  }
  return Object.freeze({ root, directory, read, save, withLock, claim, intent, complete });
}
