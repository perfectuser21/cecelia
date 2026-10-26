// 权威正文仅从任务仓库的固定 Git commit 读取；绝不执行正文。
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-z][a-z0-9_-]{0,63}$/;
const KINDS = new Set(['spec', 'rule', 'sample', 'implementation']);
const INDEX = JSON.parse(fs.readFileSync(new URL('../../../../../docs/registry/coding-workflow-authority.json', import.meta.url), 'utf8'));
const external = (s) => typeof s === 'string' && /^[a-z][a-z0-9+.-]*:\/\//i.test(s);
const validPath = (s) => typeof s === 'string' && s.length > 0 && s.length <= 512
  && !s.startsWith('/') && !s.includes('\\') && !s.includes('\0')
  && s.split('/').every((part) => part && part !== '.' && part !== '..' && part !== '.git')
  && !/^[a-z]:/i.test(s);
const git = (repo, args, encoding = 'utf8') => execFileSync('git', ['-C', repo, ...args], {
  encoding, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 8 * 1024 * 1024,
  env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'].includes(key))),
});

export function validateAuthority(authority) {
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)
    || !ID.test(authority.object_id ?? '')) return ['authority_object_invalid'];
  if (!Array.isArray(authority.refs) || authority.refs.length < 1 || authority.refs.length > 32) return ['authority_refs_invalid'];
  const errors = [];
  const seen = new Set();
  for (const ref of authority.refs) {
    if (!ref || typeof ref !== 'object' || Array.isArray(ref)) { errors.push('authority_ref_invalid'); continue; }
    if (!ID.test(ref.ref_id ?? '')) errors.push('authority_ref_id_invalid');
    if (seen.has(ref.ref_id)) errors.push('authority_ref_duplicate');
    seen.add(ref.ref_id);
    if (!KINDS.has(ref.kind)) errors.push('authority_kind_invalid');
    if (typeof ref.path !== 'string' || ref.path.length > 512
      || !external(ref.path) && !validPath(ref.path)) errors.push('authority_path_invalid');
    if (!SHA.test(ref.revision ?? '')) errors.push('authority_revision_invalid');
    if (!DIGEST.test(ref.digest ?? '')) errors.push('authority_digest_invalid');
    if (typeof ref.required !== 'boolean') errors.push('authority_required_invalid');
  }
  if (authority.object_id !== INDEX.object_id) errors.push('authority_object_unsupported');
  else {
    for (const known of INDEX.refs) {
      const ref = authority.refs.find((item) => item?.ref_id === known.ref_id);
      if (known.required && (!ref || ref.required !== true)) errors.push('authority_required_missing');
      if (ref && ref.kind !== known.kind) errors.push('authority_kind_mismatch');
    }
    if (authority.refs.some((ref) => !INDEX.refs.some((known) => known.ref_id === ref?.ref_id))) errors.push('authority_ref_unknown');
  }
  return [...new Set(errors)];
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

export function sameAuthority(a, b) { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)); }

export function commitAvailable(repo, revision) {
  if (!SHA.test(revision ?? '')) return false;
  try { return git(repo, ['rev-parse', '--verify', `${revision}^{commit}`]).trim() === revision; }
  catch { return false; }
}

export function resolveAuthority(repo, refs) {
  return refs.map((ref) => {
    const fact = { ...ref, status: 'missing', reason: null };
    if (external(ref.path)) { fact.reason = 'authority_source_unsupported'; return fact; }
    if (!validPath(ref.path)) { fact.reason = 'authority_path_invalid'; return fact; }
    if (!commitAvailable(repo, ref.revision)) { fact.reason = 'authority_revision_unavailable'; return fact; }
    const parts = ref.path.split('/');
    for (let n = 1; n < parts.length; n += 1) {
      const prefix = parts.slice(0, n).join('/');
      let parent;
      try { parent = git(repo, ['ls-tree', '-z', ref.revision, '--', prefix], 'buffer').toString('utf8').split('\0')[0]; }
      catch { parent = ''; }
      if (!parent) { fact.reason = 'authority_file_missing'; return fact; }
      if (!parent.startsWith('040000 tree ')) { fact.reason = 'authority_non_regular_file'; return fact; }
    }
    let line;
    try { line = git(repo, ['ls-tree', '-z', ref.revision, '--', ref.path], 'buffer').toString('utf8').split('\0')[0]; }
    catch { fact.reason = 'authority_file_missing'; return fact; }
    if (!line) { fact.reason = 'authority_file_missing'; return fact; }
    const match = /^(\d{6}) (\w+) ([a-f0-9]{40})\t(.+)$/.exec(line);
    if (!match || match[4] !== ref.path || !['100644', '100755'].includes(match[1]) || match[2] !== 'blob') {
      fact.reason = 'authority_non_regular_file'; return fact;
    }
    try {
      const bytes = git(repo, ['cat-file', 'blob', match[3]], 'buffer');
      const digest = crypto.createHash('sha256').update(bytes).digest('hex');
      fact.actual_digest = digest;
      if (digest !== ref.digest) { fact.reason = 'authority_digest_mismatch'; return fact; }
      fact.status = 'found';
      return fact;
    } catch { fact.reason = 'authority_file_unreadable'; return fact; }
  });
}
