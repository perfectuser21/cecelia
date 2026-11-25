// 真实Git及受保护来源链；网络/模型仅本地CLI替身，不mock来源核验。
import { it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../../__tests__/helpers/git.mjs';
import { RECORD_SOURCE_MANIFEST as MANIFEST } from '../../lib/record-sources.mjs';
import { consumeSourceMerge } from '../lib/source-merge.mjs';
import { verifySourceMerges } from '../lib/source-merge-proof.mjs';
import { checkFixCommits } from '../lib/pr-branch.mjs';
import { hash } from '../../lib/record-provenance-store.mjs';
import { sourceMergeFixture, README } from './helpers/source-merge-fixture.mjs';

const f = sourceMergeFixture(import.meta.url);
const { commit, proof, mergeLocally, eventFile, rewriteEvent } = f;

it('持久merge凭证实际读回；missing/tampered/cross-task/unknown/duplicate/parents/tree/main/input IDs/controller逐一拒绝', async () => {
  const t = await mergeLocally(), file = eventFile(t.eventId), original = fs.readFileSync(file);
  expect(proof(t.commit).status).toBe('verified');
  expect(verifySourceMerges(f.sb.seed, f.context, t.commit)[0]).toMatchObject({ before: f.before, main: f.main, base: f.base, commit: t.commit, parents: [f.before, f.main], evidence_scope: 'local_controller_merge_only' });
  fs.unlinkSync(file);expect(() => proof(t.commit)).toThrow(/receipt_missing/);fs.writeFileSync(file, original);
  for (const edit of [e => { e.digest = '0'.repeat(64); }, e => { e.task_id = '188c3431-57ca-4f2a-8a50-14601518e2a2'; }]) {
    const e = JSON.parse(original);edit(e);fs.writeFileSync(file, JSON.stringify(e));expect(() => proof(t.commit)).toThrow(/event_invalid/);fs.writeFileSync(file, original);
  }
  for (const edit of [e => { e.unknown = true; }, e => { e.parents.reverse(); }, e => { e.tree = f.base; }, e => { e.main = f.base; }, e => { e.input_ids.registration = []; }, e => { e.controller.modules[0].sha256 = '0'.repeat(64); }, e => { e.controller.revision = f.main; },
    e => { e.remote_before.unknown = true; }, e => { e.remote_after_commit.pr.argv.push('--unsafe'); },
    e => { e.remote_before.refs.stdout = e.remote_before.refs.stdout.replace(f.main, f.base);e.remote_before.refs.stdout_sha256 = hash(e.remote_before.refs.stdout); },
    e => { const pr = JSON.parse(e.remote_before.pr.stdout);pr.baseRefName = 'other';e.remote_before.pr.stdout = JSON.stringify(pr);e.remote_before.pr.stdout_sha256 = hash(e.remote_before.pr.stdout); }]) {
    rewriteEvent(file, edit);expect(() => proof(t.commit)).toThrow(/source_merge_/);fs.writeFileSync(file, original);
  }
  const copy = eventFile('11111111-2222-4333-8444-555555555555');fs.writeFileSync(copy, original);rewriteEvent(copy, e => { e.id = path.basename(copy, '.json'); });
  expect(() => proof(t.commit)).toThrow(/duplicate/);fs.unlinkSync(copy);
  expect(proof(t.commit).status).toBe('verified');
}, 180000);

it('manifest字符串allow和假token无权；真token严格绑定index/head/main且仅单次消费', async () => {
  const t = await mergeLocally();
  await expect(checkFixCommits(f.sb.seed, f.before, { mainRef: f.main, allow: [MANIFEST] })).rejects.toThrow('protected_path');
  await expect(checkFixCommits(f.sb.seed, f.before, { mainRef: f.main, sourceMergeToken: {} })).rejects.toThrow('source_merge_token');
  expect(consumeSourceMerge(t.token, f.sb.seed, f.before, f.main)).toBe(MANIFEST);
  expect(() => consumeSourceMerge(t.token, f.sb.seed, f.before, f.main)).toThrow('source_merge_token');
}, 120000);

it('merge持久凭证包含控制器原生远端ref/PR观测，不只main自述SHA', async () => {
  const t = await mergeLocally(), e = JSON.parse(fs.readFileSync(eventFile(t.eventId)));
  expect(e.remote_before).toMatchObject({ repo: 'perfectuser21/cecelia', before: f.before, main: f.main });
  expect(e.remote_after_commit).toMatchObject({ repo: 'perfectuser21/cecelia', before: f.before, main: f.main });
  expect(e.remote_before.pr.stdout_sha256).toBe(hash(e.remote_before.pr.stdout));
  expect(e.remote_before.refs.stdout_sha256).toBe(hash(e.remote_before.refs.stdout));
}, 120000);

it('真token在index被更改后不能豁免保护路径，失败后不能重复消费', async () => {
  const t = await mergeLocally();
  git(f.sb.seed, 'update-index', '--force-remove', '--', README);
  expect(() => consumeSourceMerge(t.token, f.sb.seed, f.before, f.main)).toThrow('source_merge_token_binding');
  git(f.sb.seed, 'reset', '--hard', t.commit);
  expect(() => consumeSourceMerge(t.token, f.sb.seed, f.before, f.main)).toThrow('source_merge_token');
}, 120000);
