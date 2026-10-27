import path from 'node:path';
import { parseFrontmatter } from './md-chain.mjs';
import { fail, safeRelative, hash, git, gitText, UUID, workingBytes, workingMode } from './record-provenance-store.mjs';
export const isQaExecutionArtifact = file => /^sprints\/\d{8}-cw-[0-9a-f]{8}\/qa-r[1-9]\d*\/qa-playwright\.cjs$/.test(file);
export function identity({ taskId, sprintDir }) {
  if (!UUID.test(taskId ?? '') || !/^sprints\/\d{8}-cw-[0-9a-f]{8}$/.test(sprintDir ?? '') || !sprintDir.endsWith(`-cw-${taskId.slice(0, 8)}`)) fail('identity_invalid');
}
export function recordType(file, sprintDir) {
  safeRelative(file);if (!file.startsWith(`${sprintDir}/`)) fail('path_scope');
  const name = file.slice(sprintDir.length + 1), round = Number(/-r([1-9]\d*)(?:\.md|\/)/.exec(name)?.[1] ?? 0);
  const rows = [
    [/^01-intent\.md$/, ['intent'], 'intent'], [/^01-invariants\.md$/, ['intent'], null],
    [/^02-spec\.md$/, ['spec', 'spec_review', 'commander'], 'spec'],
    [/^02-review(?:-r[1-9]\d*)?\.md$/, ['spec_review'], 'spec_review'],
    [/^02-response-r[1-9]\d*\.md$/, ['spec_review'], null],
    [/^03-build\.md$/, ['build'], 'build'], [/^04-evidence\.md$/, ['verify'], 'verify'],
    [/^05-qa-report-r[1-9]\d*\.md$/, ['evaluate'], 'evaluate'],
    [/^06-judge-r[1-9]\d*\.md$/, ['judge'], null], [/^07-commander-r[1-9]\d*\.md$/, ['commander'], null],
    [/^qa-r[1-9]\d*\/.+$/, ['evaluate'], null],
  ];
  const row = rows.find(([re]) => re.test(name));if (!row) fail('file_unsupported');
  return { stages: row[1], step: row[2], round, markdown: !name.startsWith('qa-r') };
}
export function inspectRecord(c, file, bytes, stage = null, round = null, mode = '100644') {
  const type = recordType(file, c.sprintDir);
  if (stage !== null && !type.stages.includes(stage)) fail('stage_file_mismatch');
  if (round !== null && type.round && type.round !== round) fail('round_mismatch');
  let frontmatter = null;
  if (type.step) {
    frontmatter = parseFrontmatter(bytes.toString('utf8'))?.data;
    if (!frontmatter || frontmatter.task_id !== c.taskId || frontmatter.step !== type.step) fail('report_identity_invalid');
    if (frontmatter.upstream.some(ref => !/^[^/\\#\s]+\.md#[A-Z]+-\d+$/.test(ref))) fail('upstream_invalid');
  }
  return { path: file, mode, sha256: hash(bytes), step: type.step, round: type.round || round || 0, frontmatter, markdown: type.markdown };
}
export function listRecords(c, head) {
  return git(c.worktree, 'ls-tree', '-r', '-z', '--name-only', head, '--', c.sprintDir).toString('utf8').split('\0').filter(Boolean).map(file => { recordType(file, c.sprintDir);return file; });
}
export function workingRecord(c, file, stage, round) { return inspectRecord(c, file, workingBytes(c.worktree, file), stage, round, workingMode(c.worktree, file)); }
export function branchIdentity(c) {
  if (gitText(c.worktree, 'branch', '--show-current') !== `cp-${path.basename(c.sprintDir)}`) fail('branch_invalid');
}
