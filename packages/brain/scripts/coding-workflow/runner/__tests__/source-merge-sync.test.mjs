// 真实Git及受保护来源链；网络/模型仅本地CLI替身，不mock来源核验。
import { it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../../__tests__/helpers/git.mjs';
import { withRecordProvenance } from '../../lib/record-provenance.mjs';
import { RECORD_SOURCE_MANIFEST as MANIFEST } from '../../lib/record-sources.mjs';
import { verifySourceMerges } from '../lib/source-merge-proof.mjs';
import { runCiFix } from '../lib/cifix.mjs';
import { sourceMergeFixture, BRANCH, README } from './helpers/source-merge-fixture.mjs';

const f = sourceMergeFixture(import.meta.url);
const { put, head, commit, rel, proof, editGh } = f;

it.each(['无文本冲突', '真实文本冲突'])('真实已登记任务遇上游合法manifest删除（%s）：控制器合并推送，不误拒protected_path且模型不提交manifest', async layout => {
  if (layout === '真实文本冲突') {
    git(f.sb.seed, 'checkout', '-q', 'main');
    put(MANIFEST, JSON.stringify(JSON.parse(fs.readFileSync(path.join(f.sb.seed, MANIFEST)))) + '\n');
    f.main = commit('fixture upstream manifest formatting');git(f.sb.seed, 'push', '-q', 'origin', 'main');git(f.sb.seed, 'checkout', '-q', BRANCH);
  }
  expect(proof(f.before).status).toBe('verified');expect(proof(f.before).records).toHaveLength(3);
  fs.mkdirSync(f.sb.logDir, { recursive: true });
  fs.writeFileSync(path.join(f.sb.logDir, 'qa-77.json'), JSON.stringify({ passed: true, approved: { head: f.before, round: 1 }, judge_pending: { round: 1 }, rounds: [{ round: 1, judge: 'PASS' }] }));
  const ctx = { cfg: f.cfg, log: s => f.messages.push(s), brain: { patch: async () => ({ ok: true }), postSpans: async () => ({ ok: true }) } };
  await withRecordProvenance({ ...f.context, stage: 'publish' }, () => runCiFix(ctx));
  const state = JSON.parse(fs.readFileSync(path.join(f.sb.logDir, 'cifix-77.json')));
  expect(state.attempts.at(-1).result, f.messages.join('\n')).toBe('pushed');
  expect(fs.existsSync(path.join(f.sb.root, 'model-called'))).toBe(false);
  const qa = JSON.parse(fs.readFileSync(path.join(f.sb.logDir, 'qa-77.json')));
  expect(qa.passed).toBe(false);expect(qa).not.toHaveProperty('approved');expect(qa).not.toHaveProperty('judge_pending');expect(qa.rounds).toHaveLength(1);
  expect(qa.revoked.at(-1)).toMatchObject({ automerge_disabled: true, reason: 'source_merge_new_head' });
  const merged = git(f.sb.origin, 'rev-parse', BRANCH).trim();expect(merged).not.toBe(f.before);
  expect(git(f.sb.origin, 'show', '-s', '--format=%P', merged).trim().split(' ')).toEqual([f.before, f.main]);
  git(f.sb.seed, 'fetch', '-q', 'origin');expect(proof(merged).status).toBe('verified');
  const rows = JSON.parse(git(f.sb.origin, 'show', `${merged}:${MANIFEST}`)).relations;
  expect(rows.map(r => r.path)).toEqual([rel('01-intent.md'), rel('03-build.md'), rel('04-evidence.md'), 'docs/retained.md']);
  expect(rows.some(r => r.path === 'docs/retired.md')).toBe(false);
  expect(git(f.sb.origin, 'show', `${merged}:${README}`)).toBe(git(f.sb.seed, 'show', `${f.before}:${README}`));
}, 120000);

it('self落后main也必须走可信事务，不能gh update-branch制造无凭证merge', async () => {
  expect(proof(f.before).status).toBe('verified');
  editGh(d => { d.prs[0].mergeable = 'MERGEABLE';d.required = { 77: [{ name: 'ci-passed', bucket: 'fail' }] };d.checks = { 77: [{ name: 'lint-base-fresh', bucket: 'fail' }] }; });
  await withRecordProvenance({ ...f.context, stage: 'publish' }, () => runCiFix({ cfg: f.cfg, log: s => f.messages.push(s), brain: { patch: async () => ({ ok: true }), postSpans: async () => ({ ok: true }) } }));
  const state = JSON.parse(fs.readFileSync(path.join(f.sb.logDir, 'cifix-77.json')));
  expect(state.attempts.at(-1)?.result, f.messages.join('\n')).toBe('pushed');
  expect(fs.readFileSync(f.sb.ghLog, 'utf8')).not.toContain('update-branch');
  const merged = git(f.sb.origin, 'rev-parse', BRANCH).trim();git(f.sb.seed, 'fetch', '-q', 'origin');
  expect(proof(merged).status).toBe('verified');expect(verifySourceMerges(f.sb.seed, f.context, merged)).toHaveLength(1);
}, 120000);
