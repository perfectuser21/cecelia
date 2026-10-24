// 固定Git原文仅作静态输入；不执行候选源码、CLI、网络或数据库。
import { createHash } from 'node:crypto';
import { parse } from 'acorn';
import { describe, it, expect } from 'vitest';
import * as envelopes from '../existing-ops-native-evidence-envelopes.js';
import { nativeEvidenceForwarding, nativeBuildSources, nativeEvidenceStages, nativeStageTest, nativeCompatibleCli } from '../existing-ops-native-evidence-source.js';

const old = envelopes.NATIVE_EVIDENCE_ENVELOPES;
const ast = text => parse(text, { ecmaVersion: 'latest', sourceType: 'module' });
const sha = text => createHash('sha256').update(text).digest('hex');
// 独立固定5624733f原文的精确行配方；期望SHA不从被测新封套计算。
const qaReport = old.support.qaReport
  .replace("    const lines = String(i.command ?? '').split('\\n').map((l) => l.trim()).filter(Boolean);",
    "    const command = unwrapShellCommand(i.command ?? '') ?? String(i.command ?? '');\n    const lines = command.split('\\n').map((l) => l.trim()).filter(Boolean);")
  .replace('DRY_RUN_RE.test(i.command) && !isReadonlyDocAssertion(i.command)', 'DRY_RUN_RE.test(command) && !isReadonlyDocAssertion(command)');
const support = () => ({ ...old.support, qaReport });

describe('原生报告守卫的完整已审组合兼容', () => {
  it('固定旧/新qaReport原文均匹配独立Git SHA', () => {
    expect(sha(old.support.qaReport)).toBe('73dbc417e01a9e0b1a6b819f2d960fd252dc11e8b82e90282efdebd2f7ae9960');
    expect(sha(qaReport)).toBe('3d7fa3b2a5452841fc8cc788183c6134495228db9a2cf2be210fc78d88669493');
  });

  it('新增完整冻结组合只更换已审qaReport，所有其它原文保持逐字相同', () => {
    const next = envelopes.NATIVE_REPORT_ROUNDTRIP_ENVELOPES;
    expect(next).toBeDefined();
    expect(next.revision).toBe('5624733fe0161fb9d497f70b56ed0fd9f7b5ca3b');
    expect(Object.keys(next).sort()).toEqual(Object.keys(old).sort());
    expect(Object.keys(next.support).sort()).toEqual(Object.keys(old.support).sort());
    for (const key of Object.keys(old.support)) expect(sha(next.support[key])).toBe(sha(key === 'qaReport' ? qaReport : old.support[key]));
    expect(next.entries).toEqual(old.entries);
    expect(next.tests).toEqual(old.tests);
    expect(next.legacyCli).toBe(old.legacyCli);
  });

  it('旧完整组合继续证明相同源码版本和build/entry/test/CLI', () => {
    expect(nativeEvidenceForwarding(old.support, ast)?.version).toBe('native_evidence');
    expect(nativeBuildSources(old.support, ast)).toBe(true);
    expect(nativeEvidenceStages(old.entries, ast)).toBe(true);
    expect(nativeStageTest('evaluate')).toBe(old.tests.evaluate);
    expect(nativeCompatibleCli()).toBe(old.legacyCli);
  });

  it('新完整组合须经过全部AST及真实nativeLinks证明', () => {
    expect(nativeEvidenceForwarding(support(), ast)?.version).toBe('native_evidence');
    expect(nativeBuildSources(support(), ast)).toBe(true);
  });

  it.each(['qaReport', 'recordQa', 'recordInputs', 'nativeEvidence'])('新组合缺少%s不能默认回退', key => {
    const files = support(); delete files[key];
    expect(nativeEvidenceForwarding(files, ast)).toBeNull();
  });

  it.each(['qaReport', 'recordQa', 'recordInputs', 'nativeEvidence'])('新组合混入未审%s正文必须拒绝且不执行', key => {
    const files = support(); files[key] += '\nglobalThis.__unknownNativeSupportExecuted = true;\n';
    expect(nativeEvidenceForwarding(files, ast)).toBeNull();
    expect(globalThis.__unknownNativeSupportExecuted).toBeUndefined();
  });

  it('新qaReport不能豁免真实编译调用链', () => {
    const files = support();
    files.recordQa = files.recordQa.replaceAll('compileQaReport(', 'fakeCompileQaReport(');
    expect(nativeEvidenceForwarding(files, ast)).toBeNull();
  });
});
