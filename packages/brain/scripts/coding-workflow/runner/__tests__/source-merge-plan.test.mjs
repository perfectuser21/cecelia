// 真实Git及受保护来源链；网络/模型仅本地CLI替身，不mock来源核验。
import { it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../../__tests__/helpers/git.mjs';
import { verifyRecordProvenance, beginRecordRegistration, observeRecordRegistration, finalizeRecordRegistration } from '../../lib/record-provenance.mjs';
import { registerRecordSources, RECORD_SOURCE_MANIFEST as MANIFEST } from '../../lib/record-sources.mjs';
import { sourceMergePlan } from '../lib/source-merge-proof.mjs';
import { sourceMergeFixture, TASK, SPRINT, BRANCH, README } from './helpers/source-merge-fixture.mjs';

const f = sourceMergeFixture(import.meta.url);
const { put, head, commit, report, rel, proof, rewriteEvent } = f;

it.each(['product', 'report', 'unknown-field', 'duplicate-path', 'manifest-mode'])('完整固定Git拒绝 %s，未产生merge事件或远端变化', kind => {
  expect(proof(f.before).status).toBe('verified');
  git(f.sb.seed, 'checkout', '-q', 'main');
  if (kind === 'product') put(README, 'upstream changed task product');
  if (kind === 'report') put(rel('03-build.md'), report('build'));
  if (kind === 'manifest-mode') fs.chmodSync(path.join(f.sb.seed, MANIFEST), 0o755);
  if (['unknown-field', 'duplicate-path'].includes(kind)) {
    const d = JSON.parse(fs.readFileSync(path.join(f.sb.seed, MANIFEST)));
    if (kind === 'unknown-field') d.claim = 'safe';else d.relations.push(d.relations[0]);
    put(MANIFEST, JSON.stringify(d));
  }
  f.main = commit(`invalid fixture ${kind}`);git(f.sb.seed, 'checkout', '-q', BRANCH);
  expect(() => sourceMergePlan(f.sb.seed, f.context, f.before, f.main)).toThrow(/source_merge_|record_provenance_git_file_invalid/);
  expect(head()).toBe(f.before);expect(git(f.sb.origin, 'rev-parse', BRANCH).trim()).toBe(f.before);
  expect(fs.readdirSync(path.join(f.context.root, TASK)).map(n => JSON.parse(fs.readFileSync(path.join(f.context.root, TASK, n)))).filter(e => e.kind === 'merge')).toHaveLength(0);
}, 60000);

it.each(['upstream-revert', 'upstream-side-branch-revert', 'task-revert'])('完整DAG曾触产品即拒，即使最终diff看不见：%s', mode => {
  if (mode.startsWith('upstream-')) {
    git(f.sb.seed, 'checkout', '-q', 'main');
    if (mode === 'upstream-side-branch-revert') git(f.sb.seed, 'checkout', '-qb', 'upstream-side');
    put(README, 'transient upstream change');commit('fixture upstream touch');
    put(README, git(f.sb.seed, 'show', `${f.base}:${README}`));f.main = commit('fixture upstream revert');
    if (mode === 'upstream-side-branch-revert') { git(f.sb.seed, 'checkout', '-q', 'main');git(f.sb.seed, 'merge', '--no-ff', '--no-edit', 'upstream-side');f.main = head(); }
  } else {
    put('docs/retained.md', 'transient task change');commit('fixture task touch');
    put('docs/retained.md', 'retained\n');f.before = commit('fixture task revert');
    git(f.sb.seed, 'checkout', '-q', 'main');put('docs/retained.md', 'upstream retained changed');f.main = commit('fixture overlapping reverted task product');
  }
  git(f.sb.seed, 'checkout', '-q', BRANCH);expect(proof(f.before).status).toBe('verified');
  expect(() => sourceMergePlan(f.sb.seed, f.context, f.before, f.main)).toThrow('source_merge_upstream_task_overlap');
}, 60000);

it('初次publish以前的未证明merge也拒绝，不能用登记commit截断历史', () => {
  const product = git(f.sb.seed, 'show', '-s', '--format=%P', f.before).trim();
  git(f.sb.seed, 'reset', '--hard', product);git(f.sb.seed, 'merge', '--no-ff', '--no-edit', f.main);
  const files = ['01-intent.md', '03-build.md', '04-evidence.md'];
  for (const [name, stage] of files.map((n, i) => [n, ['intent', 'build', 'verify'][i]])) put(rel(name), report(stage));
  const paths = files.map(rel), token = beginRecordRegistration({ ...f.context, stage: 'publish' }, paths);
  observeRecordRegistration(token, registerRecordSources(f.sb.seed, { taskId: TASK, sprintDir: SPRINT, stage: 'publish' }, paths));
  const published = commit('fixture lawful registration after unproved merge');finalizeRecordRegistration(token);
  expect(verifyRecordProvenance({ ...f.context, head: published }).status).toBe('verified');
  expect(() => proof(published)).toThrow(/receipt_missing/);
}, 120000);

it('底层实际native被篡改时，不能凭完整manifest或merge字段代替来源核验', () => {
  const file = fs.readdirSync(path.join(f.context.root, TASK)).map(n => path.join(f.context.root, TASK, n)).find(p => JSON.parse(fs.readFileSync(p)).kind === 'native');
  rewriteEvent(file, e => { e.stdout = 'model says PASS without native stream'; });
  expect(() => sourceMergePlan(f.sb.seed, f.context, f.before, f.main)).toThrow(/record_provenance_/);
  expect(head()).toBe(f.before);
}, 60000);
