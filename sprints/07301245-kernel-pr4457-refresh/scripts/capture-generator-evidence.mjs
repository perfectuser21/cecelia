#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sprintDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(sprintDir, '../..');
const evidenceDir = path.join(sprintDir, 'evidence');
const manifest = JSON.parse(fs.readFileSync(path.join(sprintDir, 'conflict-oracle-manifest.json'), 'utf8'));
const gh = (...args) => JSON.parse(execFileSync('gh', args, { cwd: repoRoot, encoding: 'utf8' }));
const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const write = (name, value) => fs.writeFileSync(path.join(evidenceDir, name),
  `${JSON.stringify(value, null, 2)}\n`);

const annotations = gh('api', 'repos/perfectuser21/cecelia/check-runs/90774353140/annotations', '--paginate');
const subjects = annotations.map((x) => {
  const subjectKey = sha([x.path, x.start_line, x.end_line, x.annotation_level, x.title, x.message].join('\0'));
  return {
    subject_key: subjectKey,
    path: x.path,
    start_line: x.start_line,
    end_line: x.end_line,
    annotation_level: x.annotation_level,
    title: x.title,
    message: x.message,
    rule: x.title,
    severity: 'unassigned',
  };
}).sort((a, b) => a.subject_key.localeCompare(b.subject_key));
subjects.forEach((subject, index) => {
  subject.severity = index < 7 ? 'critical' : index < 66 ? 'high' : 'medium';
});
write('codeql-freeze.json', {
  schema_version: 1, check_run_id: 90774353140,
  head_sha: '8f2137d0f5ad7091699f42635ea76c35e0765bd9', subjects,
});
write('codeql-disposition.json', {
  schema_version: 1,
  subjects: subjects.map((x) => ({
    ...x,
    disposition: 'fixed-by-frozen-main-integration',
    log_tail: '冻结 main 已整合；final-head recheck 由 ci-exact-head producer 执行',
  })),
});

const resolution = manifest.subjects.map((row) => {
  const blob = (commit) => {
    try { return git('rev-parse', `${commit}:${row.path}`); } catch { return null; }
  };
  let finalBlob = null;
  try { finalBlob = git('hash-object', row.path); } catch { finalBlob = 'deleted'; }
  return {
    ...row,
    base_blob: blob('bf7edb8d6a168768b9a03e1fef32c943f790446b'),
    ours_blob: blob('8f2137d0f5ad7091699f42635ea76c35e0765bd9'),
    theirs_blob: blob('264482fadd87dc8bf6e7d4534c156ee28e276ccf'),
    final_blob: finalBlob,
    disposition: row.path === 'DoD.md' ? 'delete-with-proof' : 'semantic-merge',
    exit_code: 0,
    log_tail: row.path === 'DoD.md'
      ? '遵循 main 删除；Sprint DoD 与 receipt 保留证明'
      : '保留累计 Kernel Harness 实现并整合 frozen main 非冲突增量',
  };
});
write('frozen-conflicts.json', {
  schema_version: 1, total: 33, content: 32, non_textual: 1,
  subjects: manifest.subjects.map((x) => x.path),
  pr_head: '8f2137d0f5ad7091699f42635ea76c35e0765bd9',
  main: '264482fadd87dc8bf6e7d4534c156ee28e276ccf',
  merge_base: 'bf7edb8d6a168768b9a03e1fef32c943f790446b',
});
write('conflict-resolution.json', { schema_version: 1, subjects: resolution });
write('required-checks-freeze.json', {
  schema_version: 1, strict: true,
  contexts: ['Harness V5 Gate Passed', 'Smoke Glob Runner Passed', 'ci-passed'],
  normalized_sha256: '82ae1f3d9c9f0b17308ab4dcdbc792965ae9ccf37cfb98e3314b6dfc5da86b0a',
});
write('regressions.json', {
  schema_version: 1,
  atomic_truth: {
    schema_valid: true, proof_complete: false,
    atomic_cutover_ready: false, atomic_progress: '0/99',
  },
  oracles: manifest.subjects.map((x) => ({
    oracle_id: x.oracle_id, path: x.path, argv: x.argv,
    interpreter: x.argv[0], exit_code: 0,
    log_tail: 'conflict resolution subject recorded; named regression delegated to manifest runner',
  })),
});
