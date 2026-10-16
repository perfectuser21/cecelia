// 本机受保护证据存储；权限边界由所有模型 profile 的 sandbox deny 提供，不声称抵抗宿主代码。
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
export const REPO = 'perfectuser21/cecelia';
export const MANIFEST = '.implementation-source-relations.json';
export const OWNER = 'packages/brain/scripts/coding-workflow/runner/run-once.mjs';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SHA = /^[0-9a-f]{40}$/;
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function fail(code) { throw Error(`record_provenance_${code}`); }
export function git(root, ...args) {
  const env = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[key];
  env.GIT_NO_REPLACE_OBJECTS = '1';env.GIT_GRAFT_FILE = '/dev/null';
  const call = extra => execFileSync('git', ['--no-replace-objects', '-C', root, '-c', 'core.hooksPath=/dev/null', ...extra], { env, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
  const graft = path.join(path.resolve(root, call(['rev-parse', '--git-common-dir']).toString('utf8').trim()), 'info', 'grafts');
  try { fs.lstatSync(graft);fail('git_grafts_forbidden'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return call(args);
}
export const gitText = (root, ...args) => git(root, ...args).toString('utf8').trim();
export function fixedHead(worktree, head) {
  if (!SHA.test(head ?? '') || gitText(worktree, 'rev-parse', `${head}^{commit}`) !== head) fail('head_invalid');
  return head;
}
export function ancestor(worktree, from, to) {
  try { git(worktree, 'merge-base', '--is-ancestor', fixedHead(worktree, from), fixedHead(worktree, to));return true; } catch { return false; }
}
export function safeRelative(file) {
  if (typeof file !== 'string' || !file || (file.includes('\\') || [...file].some(ch => ch.charCodeAt(0) <= 31 || ch.charCodeAt(0) === 127)) || path.isAbsolute(file) || file.split('/').some(p => !p || p === '.' || p === '..' || p.toLowerCase() === '.git')) fail('path_invalid');
  return file;
}
export function noLinks(file, create = false) {
  const abs = path.resolve(file), parts = abs.split(path.sep).filter(Boolean);
  let current = path.parse(abs).root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    if (!fs.existsSync(current)) {
      // existsSync follows symlinks, including broken links; lstat must reject those too.
      try { fs.lstatSync(current);fail('symlink'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (create) fs.mkdirSync(current, { mode: 0o700 });else fail('missing');
    }
    const s = fs.lstatSync(current);
    if (s.isSymbolicLink() || (i < parts.length - 1 && !s.isDirectory())) fail('symlink');
  }
  return abs;
}
export function executableAttachment(file) { return /\/qa-r[1-9]\d*\//.test(file); }
export function workingMode(worktree, file) {
  const s = fs.lstatSync(noLinks(path.join(worktree, safeRelative(file))));
  if (!s.isFile() || ((s.mode & 0o111) && !executableAttachment(file))) fail('file_invalid');
  return (s.mode & 0o111) ? '100755' : '100644';
}
export function workingBytes(worktree, file) {
  const abs = noLinks(path.join(worktree, safeRelative(file))), s = fs.lstatSync(abs);
  if (!s.isFile() || ((s.mode & 0o111) && !executableAttachment(file))) fail('file_invalid');
  return fs.readFileSync(abs);
}
export function gitMode(worktree, head, file) {
  fixedHead(worktree, head);safeRelative(file);
  const info = git(worktree, 'ls-tree', '-z', head, '--', file).toString('utf8');
  const mode = info.slice(0, 6);
  if (!info.startsWith(`${mode} blob `) || !info.endsWith(`\t${file}\0`) || !['100644', ...(executableAttachment(file) ? ['100755'] : [])].includes(mode)) fail('git_file_invalid');
  return mode;
}
export function gitBytes(worktree, head, file) {
  gitMode(worktree, head, file);
  return git(worktree, 'show', `${head}:${file}`);
}
export function sourceManifest(bytes) {
  let d;try { d = JSON.parse(bytes.toString('utf8')); } catch { fail('manifest_invalid'); }
  if (d?.schema_version !== 1 || d.repo !== REPO || !Array.isArray(d.relations)) fail('manifest_invalid');
  const paths = new Set();
  for (const r of d.relations) { if (!r || typeof r.path !== 'string' || paths.has(r.path)) fail('manifest_invalid');paths.add(r.path); }
  return d;
}
export function taskDir(root, taskId, create = false) {
  if (!UUID.test(taskId ?? '')) fail('identity_invalid');
  noLinks(root, create);const dir = path.join(root, taskId);noLinks(dir, create);return dir;
}
export function writeEvent(root, taskId, data) {
  const dir = taskDir(root, taskId, true), id = randomUUID();
  const payload = { schema_version: 1, repo: REPO, task_id: taskId, id, ...data };
  const event = { ...payload, digest: hash(JSON.stringify(payload)) }, bytes = JSON.stringify(event) + '\n';
  const tmp = path.join(dir, `.${id}.tmp`), file = path.join(dir, `${id}.json`);
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);fs.writeFileSync(fd, bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd = undefined;
    noLinks(dir);fs.linkSync(tmp, file); // atomic publish without overwriting an existing receipt
    const dfd = fs.openSync(dir, 'r');try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
    if (workingBytes(dir, `${id}.json`).toString('utf8') !== bytes) fail('write_readback');
    return event;
  } finally { if (fd !== undefined) fs.closeSync(fd);if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
export function events(root, taskId) {
  const dir = taskDir(root, taskId), names = fs.readdirSync(dir).filter(n => n.endsWith('.json'));
  if (names.length > 5000) fail('store_limit');
  return names.map(name => {
    if (!UUID.test(name.slice(0, -5))) fail('event_name_invalid');
    const bytes = workingBytes(dir, name);if (bytes.length > 32 * 1024 * 1024) fail('event_size');
    let event;try { event = JSON.parse(bytes.toString('utf8')); } catch { fail('event_invalid'); }
    const { digest, ...data } = event;
    if (event.id !== name.slice(0, -5) || event.schema_version !== 1 || event.repo !== REPO || event.task_id !== taskId || digest !== hash(JSON.stringify(data))) fail('event_invalid');
    if (!['native', 'stage', 'registration', 'isolation'].includes(event.kind)) fail('event_kind');
    return event;
  });
}
