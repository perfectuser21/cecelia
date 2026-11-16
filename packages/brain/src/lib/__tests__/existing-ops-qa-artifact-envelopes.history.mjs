import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parse as acorn } from 'acorn';
import { NATIVE_HISTORY_PROJECTION_ENVELOPES as HISTORY } from '../existing-ops-native-evidence-envelopes.js';
import { nativeEvidenceForwarding } from '../existing-ops-native-evidence-source.js';
const parse = text => acorn(text, { ecmaVersion: 'latest', sourceType: 'module' });
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const paths = { recordProvenance: 'record-provenance.mjs', recordRecords: 'record-provenance-records.mjs' };
// 固定尚未发布的产品候选；不能把本前置分支的旧运行时误当新组样本。
const candidate = () => ({ ...HISTORY.support, ...Object.fromEntries(Object.entries(paths).map(([key, name]) =>
  [key, execFileSync('git', ['show', '0a7eda551e0e127c3ebd90f9fce3f29b3f8df3e9:packages/brain/scripts/coding-workflow/lib/' + name], { cwd: root, encoding: 'utf8' })])) });
describe('受保护QA执行产物的完整已审来源组合', () => {
  it('旧历史投影组和新增完整组均保留原native/history证明', () => {
    for (const sources of [HISTORY.support, candidate()]) expect(nativeEvidenceForwarding(sources, parse)).toMatchObject({ version: 'native_evidence', historical: true });
  });
  it.each(['recordProvenance', 'recordRecords'])('旧新混配 %s 不获得已审来源', key => {
    const sources = candidate();sources[key] = HISTORY.support[key];expect(nativeEvidenceForwarding(sources, parse)).toBeNull();
  });
  it.each(['recordProvenance', 'recordRecords'])('同路径未知可执行变更 %s 仍拒绝', key => {
    const sources = candidate();sources[key] += '\nthrow Error("unreviewed initialization");\n';expect(nativeEvidenceForwarding(sources, parse)).toBeNull();
  });
});
