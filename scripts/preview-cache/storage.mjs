import { mkdir, lstat, realpath, open, rename, readFile, unlink, rmdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const ROOT = '/Users/administrator/worktrees/cecelia-previews';
export const POLICY = 'preview-owned-npm-cache-expiry-v1';
export const REPO = 'perfectuser21/cecelia';
export const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
export const PR = /^[1-9][0-9]{0,8}$/;
export function fail(code, status = 409) { return Object.assign(new Error(code), { code, status }); }
export async function stat(path) {
  try { return await lstat(path); } catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}
export async function directory(path, { create = false, privateMode = false } = {}) {
  if (create) {
    const created = await mkdir(path, { mode: 0o700 }).then(() => true).catch(err => { if (err.code !== 'EEXIST') throw err; return false; });
    if (created) await syncDirectory(dirname(path));
  }
  const s = await stat(path);
  if (!s?.isDirectory() || s.isSymbolicLink() || await realpath(path) !== path
      || s.uid !== process.getuid() || (s.mode & (privateMode ? 0o077 : 0o022))) throw fail('UNTRUSTED_DIRECTORY');
  return s;
}
export async function syncDirectory(path) { const fd = await open(path, 'r'); try { await fd.sync(); } finally { await fd.close(); } }
export async function save(path, data) {
  const temp = `${path}.${randomUUID()}.tmp`;
  const fd = await open(temp, 'wx', 0o600);
  try { await fd.writeFile(JSON.stringify(data)); await fd.sync(); } finally { await fd.close(); }
  await rename(temp, path); await syncDirectory(dirname(path));
}
export async function read(path) {
  const s = await stat(path); if (!s) return null;
  if (!s.isFile() || s.isSymbolicLink() || s.uid !== process.getuid() || (s.mode & 0o077)) throw fail('UNTRUSTED_JOURNAL');
  return JSON.parse(await readFile(path, 'utf8'));
}
export function createStore(root) {
  const state = join(root, '.preview-cache-owners');
  const owners = join(state, 'owners'); const intents = join(state, 'intents'); const locks = join(state, 'locks');
  async function prepare(create = false) {
    await directory(root);
    if (!create && !(await stat(state))) return false;
    for (const path of [state, owners, intents, locks]) await directory(path, { create, privateMode: true });
    return true;
  }
  async function lock(pr, fn) {
    if (!PR.test(pr) && !(pr.startsWith('intent-') && UUID.test(pr.slice(7)))) throw fail('INVALID_LOCK', 400);
    await prepare(true);
    const path = join(locks, pr); const token = randomUUID();
    try { await mkdir(path, { mode: 0o700 }); } catch (err) {
      if (err.code === 'EEXIST') throw fail('RESOURCE_LOCKED', 423); throw err;
    }
    // 崩溃若留下空锁或owner，均不抢占；没有按mtime删锁或杀PID路径。
    await save(join(path, 'owner.json'), { token });
    try { return await fn(); } finally {
      const owner = await read(join(path, 'owner.json'));
      if (owner?.token !== token) throw fail('LOCK_IDENTITY_CHANGED');
      await unlink(join(path, 'owner.json')); await rmdir(path); await syncDirectory(locks);
    }
  }
  return { root, state, owners, intents, locks, prepare, lock,
    cache: pr => { if (!PR.test(pr)) throw fail('INVALID_PR', 400); return join(root, `.npm-cache-preview-${pr}`); },
    ownerPath: pr => join(owners, `${pr}.json`),
    intentPath: id => { if (!UUID.test(id)) throw fail('INVALID_INTENT', 400); return join(intents, `${id}.json`); } };
}
