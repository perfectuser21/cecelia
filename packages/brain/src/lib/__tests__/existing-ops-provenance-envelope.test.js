import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse as acorn } from 'acorn';
import { proveBuildSources, provePublishSources } from '../existing-ops-build-source.js';
import { buildExistingOpsSources } from '../existing-ops-source.js';
import fixture from './fixtures/provenance-envelope-v2.json';

// 固定真实候选仅作 AST 数据；CI 不依赖未合并 commit，不 import/执行 fixture。
const parse = source => acorn(source, { ecmaVersion: 'latest', sourceType: 'module' });
const base = '52a9476e014f540d418014e7062ca66a72f38709';
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const fixed = path => execFileSync('git', ['--no-replace-objects', 'show', `${base}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const sources = () => ({ ...fixture.sources });


describe('已审 provenance V2 封套的真实闭包转发', () => {
  it('固定正式旧版本仍通过，不要求新 provenance 模块存在', () => {
    const old = Object.fromEntries(['test', 'helper', 'activity', 'cli', 'protocol'].map(k => [k, fixed(fixture.paths[k])]));
    expect(proveBuildSources(old, parse)).toBe(true);
    expect(provePublishSources(fixed(fixture.paths.publishTest), old.helper, parse)).toBe(true);
  });
  it('真实 V2 经 runRecordedActivity 与 storage.run 调用原 handler', () => {
    expect(proveBuildSources(sources(), parse)).toBe(true);
  });
  it('按 AST 与真实调用边证明，注释和字面量引号改变不依赖文件 hash', () => {
    const value = sources();
    value.activityProvenance = '// 只改格式\n' + value.activityProvenance.replace("stage === 'evaluate'", 'stage === "evaluate"');
    expect(proveBuildSources(value, parse)).toBe(true);
  });
  it('真实 publish V2 的正常 witness 重置并调用原 ENTRY', () => {
    expect(provePublishSources(fixture.sources.publishTest, fixture.sources.helper, parse, sources())).toBe(true);
  });
  it.each(['activity', 'protocol', 'cli'])('不接受 %s 新旧封套混配', key => {
    const value = sources(); value[key] = fixed(fixture.paths[key]);
    expect(proveBuildSources(value, parse)).toBe(false);
  });
  it('全 collector 读取新增5模块并记录真实闭包调用依赖，原 runner 关系不丢', async () => {
    const basePaths = execFileSync('git', ['ls-tree', '-rz', '--name-only', base], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\0').filter(Boolean);
    const overrides = Object.fromEntries(Object.entries(fixture.paths).map(([key, path]) => [path, fixture.sources[key]]));
    const readPaths = new Set();
    const result = await buildExistingOpsSources({ scope: 'cecelia-factory', repo: 'perfectuser21/cecelia', revision: base,
      paths: [...new Set([...basePaths, ...Object.values(fixture.paths)])],
      readSource: async path => { readPaths.add(path); return overrides[path] ?? fixed(path); } });
    const f3 = result.consumers[1]; expect(f3.status, JSON.stringify(f3.gaps)).toBe('verified');
    expect(new Set(f3.input_relations.map(r => JSON.stringify(r))).size).toBe(f3.input_relations.length);
    for (const key of ['activityProvenance', 'recordProvenance', 'recordStore', 'recordRecords', 'provenancePath']) {
      expect(readPaths.has(fixture.paths[key])).toBe(true);
      expect(f3.bindings.map(b => b.path)).toContain(fixture.paths[key]);
      expect(f3.input_relations.some(r => r.input_path === fixture.paths[key])).toBe(true);
    }
    expect(f3.input_relations.some(r => r.kind === 'native_node_runner_spawn')).toBe(true);
  }, 30000);
  it('只选择 publish 时不把未证明消费的 activity helper 记入绑定', async () => {
    const { collectBuildSources } = await import('../existing-ops-build-source.js');
    const bindings = [], relations = [], gaps = [];
    await collectBuildSources({ parse, paths: Object.values(fixture.paths), revision: base,
      selectors: { include: [/__tests__\/publish\.test\.mjs$/], exclude: [] }, relations,
      read: async path => { bindings.push(path); return fixture.sources[Object.keys(fixture.paths).find(k => fixture.paths[k] === path)] ?? 'unused'; },
      readSource: async path => fixture.sources[Object.keys(fixture.paths).find(k => fixture.paths[k] === path)],
      requireProof: (ok, code) => { if (!ok) gaps.push(code); return ok; } });
    expect(gaps).toEqual([]);
    expect(bindings).not.toContain(fixture.paths.activityProvenance);
    expect(relations.some(r => r.input_path === fixture.paths.activityProvenance)).toBe(false);
    expect(bindings).toContain(fixture.paths.recordProvenance);
  });
});
