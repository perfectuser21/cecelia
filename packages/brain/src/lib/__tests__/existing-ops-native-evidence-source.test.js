// 固定Git原件仅作为惰性解析输入；不执行候选、CLI、模型、网络或数据库。
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { parse } from 'acorn';
import { BUILD_SOURCE_PATHS, proveBuildSources, provePublishSources, collectBuildSources } from '../existing-ops-build-source.js';
import { PROVENANCE_SOURCE_PATHS, provenanceSourceVersion } from '../existing-ops-provenance-envelope.js';
import { stageSourceVersion } from '../existing-ops-stage-source.js';

const P = 'packages/brain/scripts/coding-workflow/';
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/native-evidence-source-7da3.json', import.meta.url)));
const ast = text => parse(text, { ecmaVersion: 'latest', sourceType: 'module' });
const added = { recordInputs: P + 'lib/record-provenance-inputs.mjs', recordQa: P + 'lib/record-provenance-qa.mjs', nativeEvidence: P + 'lib/native-evidence.mjs' };
function support(files) {
  return Object.fromEntries(Object.entries({ ...BUILD_SOURCE_PATHS, ...PROVENANCE_SOURCE_PATHS, ...added }).map(([key, path]) => [key, files[path]]));
}
function entries(files) {
  return Object.fromEntries(['intent', 'spec', 'spec-review', 'verify', 'evaluate'].map(name => [name, files[P + `activities/${name}.mjs`]]));
}
async function collect(files = structuredClone(fixture.sources), selected = /.*/) {
  const bindings = new Set(), relations = [], gaps = [];
  await collectBuildSources({ parse: ast, paths: Object.keys(files), selectors: { include: [selected], exclude: [] },
    revision: fixture.revision, readSource: async path => { if (!(path in files)) throw Error('missing fixed source');return files[path]; },
    read: async path => { if (!(path in files)) { gaps.push({ code: 'source_unavailable', path });return null; } bindings.add(path);return files[path]; },
    relations, requireProof: (value, code) => { if (!value) gaps.push({ code });return Boolean(value); } });
  return { bindings: [...bindings], relations, gaps };
}
function mutate(path, before, after) {
  const files = structuredClone(fixture.sources);expect(files[P + path]).toContain(before);
  files[P + path] = files[P + path].replace(before, after);return files;
}

describe('native_evidence完整固定源码执行封套', () => {
  it('fixture每份原始字节来自冻结Git而非被测封套常量', () => {
    expect(fixture.revision).toBe('7da3d486c7385fe7baea72903cbb9c56ceedcd4f');
    expect(Object.keys(fixture.source_sha256).sort()).toEqual(Object.keys(fixture.sources).sort());
    for (const [path, text] of Object.entries(fixture.sources)) expect(createHash('sha256').update(text).digest('hex'), path).toBe(fixture.source_sha256[path]);
  });
  it('既有正式source_merge源码仍保持原版本和build/publish证明', () => {
    const s = support(fixture.baseline);
    expect(provenanceSourceVersion(s, ast)).toBe('source_merge');
    expect(stageSourceVersion(entries(fixture.baseline), ast)).toBe('source_merge');
    expect(proveBuildSources(s, ast)).toBe(true);
    expect(provePublishSources(fixture.baseline[P + '__tests__/publish.test.mjs'], s.helper, ast, s)).toBe(true);
  });
  it('新support原子版本不得被当成未知或投影到旧source_merge', () => {
    expect(provenanceSourceVersion(support(fixture.sources), ast)).toBe('native_evidence');
  });
  it('真实build消费者仍调用实际带native capture的CLI', () => {
    expect(proveBuildSources(support(fixture.sources), ast)).toBe(true);
  });
  it('真实publish消费者仍调用原Node入口，不因共享新core失去执行证明', () => {
    const s = support(fixture.sources);
    expect(provePublishSources(fixture.sources[P + '__tests__/publish.test.mjs'], s.helper, ast, s)).toBe(true);
  });
  it('新evaluate入口和其它固定阶段必须组成同一native_evidence版本', () => {
    expect(stageSourceVersion(entries(fixture.sources), ast)).toBe('native_evidence');
  });
  it('collector认领完整新闭包而不留下三类unknown，关系去重', async () => {
    const r = await collect();expect(r.gaps).toEqual([]);
    for (const path of Object.values(added)) expect(r.bindings).toContain(path);
    expect(new Set(r.relations.map(e => JSON.stringify(e))).size).toBe(r.relations.length);
  });
  it('仅选择spec只登记新core静态依赖，不伪称执行过evaluate编译', async () => {
    const r = await collect(undefined, /\/__tests__\/spec\.test\.mjs$/);expect(r.gaps).toEqual([]);
    expect(r.bindings).not.toContain(P + 'activities/evaluate.mjs');
    for (const path of Object.values(added)) expect(r.bindings).toContain(path);
    expect(r.relations.filter(e => e.consumer_path === P + 'activities/evaluate.mjs')).toEqual([]);
  });
  it('没有选中相关测试时不追加新模块关系', async () => {
    const r = await collect(undefined, /never-selected/);expect(r.gaps).toEqual([]);expect(r.bindings).toEqual([]);expect(r.relations).toEqual([]);
  });
  const mutations = [
    ['捕获被no-op替换', 'lib/claude.mjs', 'captureNativeExecution({ ...result, tag })', 'fakeCaptureNativeExecution({ ...result, tag })'],
    ['compile真实链被no-op替换', 'activities/evaluate.mjs', 'compileCurrentQaEvidence(rel)', 'fakeCompileCurrentQaEvidence(rel)'],
    ['实际stdin身份比较被删', 'lib/record-provenance.mjs', 'run.stdin_sha256 === c.judgeInput.stdin_sha256', 'true'],
    ['inputseal真实调用被删', 'lib/record-provenance.mjs', 'writeJudgeInput(c, materials)', 'fakeWriteJudgeInput(c, materials)'],
    ['stagepolicy验证被删', 'lib/record-provenance.mjs', 'validateJudgeStageInput(c, stage, all)', 'fakeValidateJudgeStageInput(c, stage, all)'],
    ['新policy未知body不能按marker认领', 'lib/native-evidence.mjs', "const metadata = new WeakMap();", "const metadata = new WeakMap();globalThis.__untrustedNativeExecuted = true;"],
  ];
  for (const [name, path, before, after] of mutations) it(name + '必须失败关闭', async () => {
    const r = await collect(mutate(path, before, after));expect(r.gaps.length).toBeGreaterThan(0);
    expect(r.bindings).not.toContain(P + 'activities/evaluate.mjs');
    expect(globalThis.__untrustedNativeExecuted).toBeUndefined();
  });
  it.each(Object.values(added))('新闭包缺模块%s不能降legacy', async path => {
    const files = structuredClone(fixture.sources);delete files[path];
    expect((await collect(files)).gaps.length).toBeGreaterThan(0);
  });
  it('新entry配旧core或新core配旧entry均不能独立any-match洗白', async () => {
    const a = structuredClone(fixture.sources);a[P + 'lib/record-provenance.mjs'] = fixture.baseline[P + 'lib/record-provenance.mjs'];
    const b = structuredClone(fixture.sources);b[P + 'activities/evaluate.mjs'] = fixture.baseline[P + 'activities/evaluate.mjs'];
    expect((await collect(a)).gaps.length).toBeGreaterThan(0);expect((await collect(b)).gaps.length).toBeGreaterThan(0);
  });
});
