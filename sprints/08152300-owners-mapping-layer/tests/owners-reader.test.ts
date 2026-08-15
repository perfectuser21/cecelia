import { describe, it, expect } from 'vitest';

// TDD Red: owners-reader.js 尚未实现，import 即失败 → 全部 red。
import {
  parseOwnersDeclaration,
  resolveEffectiveDeclarations,
  detectOwnersConflicts,
  projectFactsByOwners,
} from '../../../packages/brain/src/lib/owners-reader.js';

describe('OWNERS 读取器 [BEHAVIOR]', () => {
  it('解析合法 OWNERS 声明为 scope/capability', () => {
    const r = parseOwnersDeclaration(
      'capability: cecelia/MJ5\nowner: cecelia-brain\n',
      'packages/brain/src/map/OWNERS',
    );
    expect(r.ok).toBe(true);
    expect(r.scope).toBe('cecelia');
    expect(r.capabilityKey).toBe('MJ5');
    expect(r.dir).toBe('packages/brain/src/map');
  });

  it('YAML 解析失败带行号（不使整仓扫描失败）', () => {
    const r = parseOwnersDeclaration('capability: [unclosed\n\t: : :\n', 'a/OWNERS');
    expect(r.ok).toBe(false);
    expect(r.reason_code).toBe('owners_parse_error');
    expect(typeof r.line).toBe('number');
  });

  it('子目录覆盖父级（Meta 语义，deepest wins）', () => {
    const decls = [
      { dir: 'packages/brain/src/map', scope: 'cecelia', capabilityKey: 'MJ5' },
      { dir: 'packages/brain/src/map/__tests__', scope: 'cecelia', capabilityKey: 'F1' },
    ];
    const eff = resolveEffectiveDeclarations(decls);
    expect(eff.resolve('packages/brain/src/map/__tests__/projector.test.js').capabilityKey).toBe('F1');
    expect(eff.resolve('packages/brain/src/map/radius.test.js').capabilityKey).toBe('MJ5');
  });

  it('capability 不在 manifest 判冲突', () => {
    const decls = [{ dir: 'x', scope: 'cecelia', capabilityKey: '__NOPE__' }];
    const conflicts = detectOwnersConflicts(decls, { validCapabilityKeys: ['MJ5'], validSteps: [] });
    expect(conflicts.some(
      (c) => c.reason_code === 'capability_not_in_manifest' && c.path === 'x',
    )).toBe(true);
  });

  it('同一路径重复声明判冲突', () => {
    const decls = [
      { dir: 'x', scope: 'cecelia', capabilityKey: 'MJ5' },
      { dir: 'x', scope: 'cecelia', capabilityKey: 'F1' },
    ];
    const conflicts = detectOwnersConflicts(decls, { validCapabilityKeys: ['MJ5', 'F1'], validSteps: [] });
    expect(conflicts.some(
      (c) => c.reason_code === 'duplicate_capability_declaration' && c.path === 'x',
    )).toBe(true);
  });

  it('按前缀投影事实到 capability（文件级归属）', () => {
    const decls = [{ dir: 'packages/brain/src/map', scope: 'cecelia', capabilityKey: 'MJ5' }];
    const facts = [
      { repo: 'cecelia', fact_kind: 'test', stable_ref: 'packages/brain/src/map/radius.test.js' },
      { repo: 'cecelia', fact_kind: 'test', stable_ref: 'packages/brain/src/other/foo.test.js' },
    ];
    const owned = projectFactsByOwners(facts, resolveEffectiveDeclarations(decls));
    expect(owned.some(
      (o) => o.stable_ref === 'packages/brain/src/map/radius.test.js'
        && o.capability_key === 'MJ5' && o.source === 'owners',
    )).toBe(true);
    expect(owned.some((o) => o.stable_ref === 'packages/brain/src/other/foo.test.js')).toBe(false);
  });
});
