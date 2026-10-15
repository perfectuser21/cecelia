// 控制器生成的 CW Markdown 来源；不授权模型修改来源索引，不给任意 sprint 文件兜底归属。
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { childEnv } from './protocol.mjs';
import { parseFrontmatter } from './md-chain.mjs';

export const RECORD_SOURCE_MANIFEST = '.implementation-source-relations.json';
export const RECORD_SOURCE_OWNER = 'packages/brain/scripts/coding-workflow/runner/run-once.mjs';
const REPO = 'perfectuser21/cecelia';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const publishName = /^(?:01-(?:intent|invariants)|02-(?:spec|review|(?:review|response)-r[1-9]\d*)|03-build|04-evidence)\.md$/;
const recordName = /^(?:05-qa-report|06-judge|07-commander)-r[1-9]\d*\.md$/;
const fail = code => { throw new Error(`record_source_${code}`); };
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
function readGit(root, ref, file) {
  const spec = ref === ':' ? `:${file}` : `${ref}:${file}`;
  return git(root, 'show', spec);
}
function originEnabled(root) {
  let origin;
  try { origin = git(root, 'remote', 'get-url', 'origin').trim(); } catch { return false; }
  return /^(?:https:\/\/github\.com\/|git@github\.com:)perfectuser21\/cecelia(?:\.git)?$/.test(origin);
}
function regular(root, file, executable = false) {
  if (!/^[-A-Za-z0-9_./]+$/.test(file) || file.startsWith('/') || file.split('/').some(p => !p || p === '.' || p === '..')) fail('path_invalid');
  let current = root;
  for (const part of file.split('/')) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) fail('path_invalid');
  }
  const stat = fs.lstatSync(current);
  if (!stat.isFile() || (!executable && stat.mode & 0o111)) fail('path_invalid');
  return fs.readFileSync(current, 'utf8');
}
function manifest(text) {
  if (Buffer.byteLength(text) > 1024 * 1024) fail('manifest_invalid');
  let data;
  try { data = JSON.parse(text); } catch { fail('manifest_invalid'); }
  if (!data || Object.keys(data).sort().join(',') !== 'relations,repo,schema_version' || data.schema_version !== 1 || data.repo !== REPO || !Array.isArray(data.relations) || data.relations.length > 1024) fail('manifest_invalid');
  const seen = new Set();
  for (const row of data.relations) {
    if (!row || typeof row.path !== 'string' || typeof row.owner_path !== 'string' || seen.has(row.path) ||
      !['documentation', 'release', 'verification', 'verification_config'].includes(row.role) ||
      Object.keys(row).sort().join(',') !== (row.role === 'verification_config' ? 'ci_path,consumer_path,owner_path,path,role' : 'owner_path,path,role')) fail('manifest_invalid');
    seen.add(row.path);
  }
  return data;
}
function identity(branch, sprintDir, taskId, intent) {
  if (!uuid.test(taskId ?? '') || !/^cp-\d{8,10}-cw-[0-9a-f]{8}$/.test(branch) || !/^sprints\/\d{8}-cw-[0-9a-f]{8}$/.test(sprintDir) ||
    !branch.endsWith(`-cw-${taskId.slice(0, 8)}`) || !sprintDir.endsWith(`-cw-${taskId.slice(0, 8)}`) ||
    branch !== `cp-${sprintDir.split('/')[1]}` || parseFrontmatter(intent)?.data.task_id !== taskId || parseFrontmatter(intent)?.data.step !== 'intent') fail('identity_invalid');
}
function allowed(file, sprintDir, stage, round) {
  if (!file.startsWith(`${sprintDir}/`)) return false;
  const name = file.slice(sprintDir.length + 1);
  if (stage === 'publish') return publishName.test(name);
  if (!Number.isSafeInteger(round) || round < 1) return false;
  return stage === 'qa' ? [`05-qa-report-r${round}.md`, `06-judge-r${round}.md`].includes(name)
    : stage === 'commander' && name === `07-commander-r${round}.md`;
}
function append(text, files, sort = true) {
  const data = manifest(text), existing = new Map(data.relations.map(r => [r.path, r]));
  const additions = [];
  const paths = [...new Set(files)];
  if (sort) paths.sort();
  for (const file of paths) {
    const row = { owner_path: RECORD_SOURCE_OWNER, path: file, role: 'documentation' }, previous = existing.get(file);
    if (previous && (previous.owner_path !== row.owner_path || previous.role !== row.role || Object.keys(previous).length !== 3)) fail('relation_conflict');
    if (!previous) additions.push(row);
  }
  if (!additions.length) return text;
  if (data.relations.length + additions.length > 1024) fail('manifest_invalid');
  const match = /"relations"\s*:\s*\[/.exec(text);
  if (!match) fail('manifest_invalid');
  const offset = match.index + match[0].length;
  return text.slice(0, offset) + '\n' + additions.map(r => `    ${JSON.stringify(r)}`).join(',\n') + (data.relations.length ? ',' : '') + text.slice(offset);
}

/** 校验整组后仅原子写索引；调用者必须把返回路径与记录在同一个 Git commit 提交。 */
export function registerRecordSources(worktree, { taskId, sprintDir, stage, round }, files) {
  if (!originEnabled(worktree)) {
    if (fs.existsSync(path.join(worktree, RECORD_SOURCE_MANIFEST))) {
      const data = JSON.parse(fs.readFileSync(path.join(worktree, RECORD_SOURCE_MANIFEST), 'utf8'));
      if (data.repo === REPO) fail('repo_mismatch');
    }
    return [];
  }
  const root = fs.realpathSync(worktree), branch = git(root, 'branch', '--show-current').trim();
  identity(branch, sprintDir, taskId, regular(root, `${sprintDir}/01-intent.md`));
  regular(root, RECORD_SOURCE_OWNER, true);
  if (!Array.isArray(files) || !files.length || files.some(file => !allowed(file, sprintDir, stage, round))) fail('file_unsupported');
  for (const file of files) regular(root, file);
  const base = git(root, 'merge-base', 'origin/main', 'HEAD').trim();
  const before = readGit(root, 'HEAD', RECORD_SOURCE_MANIFEST);
  if (readGit(root, base, RECORD_SOURCE_MANIFEST) !== before && !isRecordSourceDelta(root, { from: base, to: 'HEAD', branch })) fail('committed_manifest_modified');
  const desired = append(before, files);
  const current = regular(root, RECORD_SOURCE_MANIFEST);
  // 只接受 HEAD 原文，或同一输入在写入成功/提交前中断后留下的精确字节。
  if (current !== before && current !== desired) fail('manifest_modified');
  if (readGit(root, ':', RECORD_SOURCE_MANIFEST) !== before) fail('manifest_staged');
  if (desired !== current) {
    const file = path.join(root, RECORD_SOURCE_MANIFEST), temp = `${file}.${randomUUID()}.tmp`;
    try {
      const fd = fs.openSync(temp, 'wx', fs.statSync(file).mode & 0o777);
      try { fs.writeFileSync(fd, desired); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      if (regular(root, RECORD_SOURCE_MANIFEST) !== current) fail('manifest_raced');
      fs.renameSync(temp, file);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  return desired === before ? [] : [RECORD_SOURCE_MANIFEST];
}

/** 三个 Git 视图逐层验证：完整重算可信记录增量，不能仅凭 JSON 文件名豁免。 */
export function isRecordSourceDelta(worktree, { from, to, branch }) {
  try {
    if (!originEnabled(worktree)) return false;
    const read = (ref, file) => ref === null ? regular(worktree, file) : readGit(worktree, ref, file);
    const before = read(from, RECORD_SOURCE_MANIFEST), after = read(to, RECORD_SOURCE_MANIFEST);
    const old = manifest(before), next = manifest(after), oldPaths = new Set(old.relations.map(r => r.path));
    const added = next.relations.filter(r => !oldPaths.has(r.path));
    if (!added.length || added.some(r => r.owner_path !== RECORD_SOURCE_OWNER || r.role !== 'documentation')) return false;
    for (const row of added) {
      const match = /^(sprints\/\d{8}-cw-[0-9a-f]{8})\/([^/]+)$/.exec(row.path);
      if (!match || !(publishName.test(match[2]) || recordName.test(match[2]))) return false;
      const intent = read(to, `${match[1]}/01-intent.md`), taskId = parseFrontmatter(intent)?.data.task_id;
      identity(branch, match[1], taskId, intent);
      // 引用的记录与身份文件都必须在这个精确视图中是普通文件。
      if (to !== null) for (const file of [row.path, `${match[1]}/01-intent.md`]) {
        const info = to === ':' ? git(worktree, 'ls-files', '--stage', '--', file) : git(worktree, 'ls-tree', to, '--', file);
        if (!info.startsWith('100644 ')) return false;
      }
      read(to, row.path);
    }
    return append(before, added.map(r => r.path), false) === after;
  } catch { return false; }
}
