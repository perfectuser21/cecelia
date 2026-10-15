import { describe, it, expect } from 'vitest';
import { parse as acorn } from 'acorn';
import fixture from './fixtures/provenance-envelope-v2.json';
import { normalizeProvenanceBuild, normalizeProvenancePublish } from '../existing-ops-provenance-envelope.js';
import { proveBuildSources, provePublishSources } from '../existing-ops-build-source.js';
import { REVIEWED } from '../existing-ops-provenance-entry-envelopes.js';

const parse = source => acorn(source, { ecmaVersion: 'latest', sourceType: 'module' });
const sources = () => ({ ...fixture.sources });
const mutation = (key, before, after) => {
  const value = sources(); expect(value[key]).toContain(before);
  value[key] = value[key].replace(before, after); return value;
};

describe('entry-envelopes 独立固定源码与拒绝合同', () => {
  it('4 个入口封套逐字对应独立 fixture 的完整 AST 节点', () => {
    expect(Object.keys(REVIEWED).sort()).toEqual(['entry', 'publishTest', 'runActivity', 'runClaude']);
    const functionText = (key, name) => {
      const node = parse(fixture.sources[key]).body.map(n => n.declaration ?? n)
        .find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
      return fixture.sources[key].slice(node.start, node.end);
    };
    const entry = parse(fixture.sources.activity).body.at(-1);
    expect(REVIEWED.entry).toBe(fixture.sources.activity.slice(entry.start, entry.end));
    expect(REVIEWED.runActivity).toBe(functionText('protocol', 'runActivity'));
    expect(REVIEWED.runClaude).toBe(functionText('cli', 'runClaude'));
    expect(REVIEWED.publishTest).toBe(fixture.sources.publishTest);
    expect(normalizeProvenanceBuild(sources(), parse)).not.toBeNull();
    expect(normalizeProvenancePublish(fixture.sources.publishTest, parse, sources())).not.toBeNull();
  });
  it.each([
    ['动态 import 改向', 'protocol', "import('./activity-provenance.mjs')", "import('./other.mjs')"],
    ['protocol 漏调 handler', 'protocol', 'await handler(current)', '{}'],
    ['阶段身份改变', 'activity', "stage: 'build'", "stage: 'verify'"],
    ['伪原生成功覆盖管道', 'cli', 'captureNativeExecution({ ...result, tag });', "captureNativeExecution({ ...result, code: 0, stdout: 'success', tag });"],
  ])('%s 既不能规范化也不能证明来源', (_name, key, before, after) => {
    const value = mutation(key, before, after);
    expect(normalizeProvenanceBuild(value, parse)).toBeNull();
    expect(proveBuildSources(value, parse)).toBe(false);
  });
  it('未改 V2 插桩但篡改真实 spawn，仍由保留的旧封套拒绝', () => {
    const value = mutation('cli', 'child = spawn(bin, args,', 'child = spawn("other", args,');
    expect(normalizeProvenanceBuild(value, parse)).not.toBeNull();
    expect(proveBuildSources(value, parse)).toBe(false);
  });
  it.each(['protocol', 'activity', 'cli'])('缺失 %s 不接受候选自述', key => {
    const value = sources(); delete value[key];
    expect(normalizeProvenanceBuild(value, parse)).toBeNull();
    expect(proveBuildSources(value, parse)).toBe(false);
  });
  it.each([
    ['删入口重置', 'activityEntry = ENTRY;', ''],
    ['入口重置改向', 'activityEntry = ENTRY;', "activityEntry = '/tmp/other.mjs';"],
    ['未知入口赋值', "    const r = await run('new');", "    activityEntry = '/tmp/other.mjs'; const r = await run('new');"],
    ['跳过正常 witness', "it('new：", "it.skip('new："],
    ['self wrapper 不执行入口', '() => import(${JSON.stringify(pathToFileURL(ENTRY).href)})', '() => ({})'],
  ])('publish %s 必须拒绝', (_name, before, after) => {
    const value = mutation('publishTest', before, after);
    expect(normalizeProvenancePublish(value.publishTest, parse, value)).toBeNull();
    expect(provePublishSources(value.publishTest, value.helper, parse, value)).toBe(false);
  });
});
