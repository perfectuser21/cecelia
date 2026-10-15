import { describe, it, expect } from 'vitest';
import { parse as acorn } from 'acorn';
import fixture from './fixtures/provenance-envelope-v2.json';
import { normalizeProvenanceBuild } from '../existing-ops-provenance-envelope.js';
import { proveBuildSources } from '../existing-ops-build-source.js';
import { REVIEWED } from '../existing-ops-provenance-core-envelope.js';

const parse = source => acorn(source, { ecmaVersion: 'latest', sourceType: 'module' });
const sources = () => ({ ...fixture.sources });
const mutation = (key, before, after) => {
  const value = sources(); expect(value[key]).toContain(before);
  value[key] = value[key].replace(before, after); return value;
};

describe('core-envelope 独立固定源码与拒绝合同', () => {
  it('字段全集来自独立固定 Git fixture，缺模块不降级', () => {
    expect(Object.keys(REVIEWED).sort()).toEqual(['recordProvenance'].sort());
    expect(normalizeProvenanceBuild(sources(), parse)).not.toBeNull();
  });
  it.each(['recordProvenance'])('%s 数据字节与固定真实模块完全一致', key => {
    expect(REVIEWED[key]).toBe(fixture.sources[key]);
    expect(parse(REVIEWED[key])).toEqual(parse(fixture.sources[key]));
  });
  it.each([
    ['前置 config 无条件 throw', 'recordProvenance', 'function config(options, writing = false) {', "function config(options, writing = false) { throw Error('stop');"],
    ['前置 controller 校验退出', 'recordProvenance', 'function controllerValid(c) {', 'function controllerValid(c) { process.exit(0);'],
    ['原生存储替身', 'recordProvenance', 'new AsyncLocalStorage()', 'new FakeStorage()'],
    ['存储闭包不转发', 'recordProvenance', 'return storage.run(c, fn);', 'return storage.run(c, () => ({}));'],
    ['修改存储方法', 'recordProvenance', 'return storage.run(c, fn);', 'storage.run = () => ({}); return storage.run(c, fn);'],
  ])('%s 既不能规范化也不能证明来源', (_name, key, before, after) => {
    const value = mutation(key, before, after);
    expect(normalizeProvenanceBuild(value, parse)).toBeNull();
    expect(proveBuildSources(value, parse)).toBe(false);
  });
  it.each(['recordProvenance'])('缺失 %s 不接受候选自述', key => {
    const value = sources(); delete value[key];
    expect(normalizeProvenanceBuild(value, parse)).toBeNull();
    expect(proveBuildSources(value, parse)).toBe(false);
  });
});
