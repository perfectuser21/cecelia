// 真实Git及受保护来源链；网络/模型仅本地CLI替身，不mock来源核验。
import { it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../../__tests__/helpers/git.mjs';
import { verifyRecordProvenance, verifyRegisteredQaEvidence } from '../../lib/record-provenance.mjs';
import { verifySourceMerges } from '../lib/source-merge-proof.mjs';
import { verifySourceHead } from '../lib/source-provenance.mjs';
import { sourceMergeFixture, BRANCH } from './helpers/source-merge-fixture.mjs';

const f = sourceMergeFixture(import.meta.url);
const { put, head, commit, proof, editGh, mergeLocally, freshQa } = f;

it('连续两次可信同步完整链可读；每次必须新HEAD新QA，旧approved与registered重试都不能跨merge', async () => {
  const first = await mergeLocally();expect(proof(first.commit).status).toBe('verified');
  const qa1 = freshQa(1);expect(verifySourceHead(f.cfg, f.sb.seed, f.context, qa1.head, 1).status).toBe('verified');
  f.before = qa1.head;git(f.sb.seed, 'push', '-q', 'origin', BRANCH);
  editGh(d => { d.prs[0].headRefOid = f.before; });
  git(f.sb.seed, 'checkout', '-q', 'main');put('upstream-next.txt', 'second unrelated upstream commit');f.main = commit('fixture second main');
  git(f.sb.seed, 'push', '-q', 'origin', 'main');git(f.sb.seed, 'checkout', '-q', BRANCH);
  const second = await mergeLocally();expect(verifySourceMerges(f.sb.seed, f.context, second.commit)).toHaveLength(2);
  // 旧core仅ancestor判据还成立，完整sync链必须额外拒绝旧QA。
  expect(verifyRecordProvenance({ ...f.context, head: second.commit, requiredQaRound: 1 }).status).toBe('verified');
  expect(() => verifySourceHead(f.cfg, f.sb.seed, f.context, second.commit, 1)).toThrow('source_merge_qa_before_sync');
  expect(() => verifyRegisteredQaEvidence({ ...f.context, ...qa1, head: second.commit }, qa1.reportRel)).toThrow(/qa_retry_history/);
  const qa2 = freshQa(2);
  expect(verifySourceHead(f.cfg, f.sb.seed, f.context, qa2.head, 2).status).toBe('verified');
  expect(verifySourceMerges(f.sb.seed, f.context, qa2.head, 2).map(e => e.commit)).toEqual([first.commit, second.commit]);
  expect(fs.existsSync(path.join(f.sb.root, 'model-called'))).toBe(false);
}, 300000);
