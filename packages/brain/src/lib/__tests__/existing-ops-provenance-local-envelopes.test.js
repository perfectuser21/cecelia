import { describe, it, expect } from 'vitest';
import { parse as acorn } from 'acorn';
import fixture from './fixtures/provenance-envelope-v2.json';
import { normalizeProvenanceBuild } from '../existing-ops-provenance-envelope.js';
import { proveBuildSources } from '../existing-ops-build-source.js';
import { REVIEWED } from '../existing-ops-provenance-local-envelopes.js';

const parse = source => acorn(source, { ecmaVersion: 'latest', sourceType: 'module' });
const sources = () => ({ ...fixture.sources });
const mutation = (key, before, after) => {
  const value = sources(); expect(value[key]).toContain(before);
  value[key] = value[key].replace(before, after); return value;
};

describe('local-envelopes 独立固定源码与拒绝合同', () => {
  it('字段全集来自独立固定 Git fixture，缺模块不降级', () => {
    expect(Object.keys(REVIEWED).sort()).toEqual(['activityProvenance', 'recordStore', 'recordRecords', 'provenancePath'].sort());
    expect(normalizeProvenanceBuild(sources(), parse)).not.toBeNull();
  });
  it.each(['activityProvenance', 'recordStore', 'recordRecords', 'provenancePath'])('%s 数据字节与固定真实模块完全一致', key => {
    expect(REVIEWED[key]).toBe(fixture.sources[key]);
    expect(parse(REVIEWED[key])).toEqual(parse(fixture.sources[key]));
  });
  it.each([
    ['非 self 不调用 handler', 'activityProvenance', 'return handler(input);', "return { status: 'completed' };"],
    ['self 闭包不调用 handler', 'activityProvenance', 'const result = await handler(input);', "const result = { status: 'completed' };"],
    ['私有同名函数', 'activityProvenance', 'export async function runRecordedActivity', 'async function runRecordedActivity'],
    ['导入期提前退出', 'activityProvenance', 'const FIXED_REPORTS =', 'process.exit(0);\nconst FIXED_REPORTS ='],
    ['导入初始化依赖早退', 'recordStore', "import fs from 'node:fs';", "import fs from 'node:fs'; process.exit(0);"],
    ['记录前置校验破坏', 'recordRecords', "import path from 'node:path';", "import path from 'node:path'; throw Error('stop');"],
    ['路径依赖提前退出', 'provenancePath', "import fs from 'node:fs';", "import fs from 'node:fs'; process.exit(0);"],
  ])('%s 既不能规范化也不能证明来源', (_name, key, before, after) => {
    const value = mutation(key, before, after);
    expect(normalizeProvenanceBuild(value, parse)).toBeNull();
    expect(proveBuildSources(value, parse)).toBe(false);
  });
  it.each(['activityProvenance', 'recordStore', 'recordRecords', 'provenancePath'])('缺失 %s 不接受候选自述', key => {
    const value = sources(); delete value[key];
    expect(normalizeProvenanceBuild(value, parse)).toBeNull();
    expect(proveBuildSources(value, parse)).toBe(false);
  });
});
