import { describe, it, expect } from 'vitest';
// TDD Red: 目标模块尚未实现（本 sprint 由 generator 创建）。
// 归属决议是纯函数：输入 OWNERS 声明列表（{path, capability, step?}）+ scope 的 active manifest capability keys，
// 输出 {assignments: path->capability, conflicts: [{path, capabilities|reason}]}。不碰 DB，不解析代码语义。
import {
  parseOwnersFile,
  resolveOwnership,
} from '../../../packages/brain/src/lib/owners-resolver.js';

const MANIFEST_CAPS = ['MJ5', 'F0', 'F1'];

describe('OWNERS 声明解析/作用域/冲突/合法性 [BEHAVIOR]', () => {
  it('解析合法 OWNERS YAML（capability 必填，step/steps/owner 可选）', () => {
    const decl = parseOwnersFile('packages/brain/src/map/OWNERS',
      'capability: cecelia/MJ5\nstep: step1\nowner: brain-team\n');
    expect(decl.capability).toBe('cecelia/MJ5');
    expect(decl.dir).toBe('packages/brain/src/map');
    expect(decl.error).toBeFalsy();
  });

  it('OWNERS 语法错时进冲突并带行号（不抛崩整个扫描）', () => {
    const decl = parseOwnersFile('packages/x/OWNERS', 'capability: cecelia/MJ5\n\tstep: bad-tab\n');
    expect(decl.error).toBeTruthy();
    expect(typeof decl.error.line).toBe('number');
  });

  it('子目录 OWNERS 覆盖父级（child override parent，路径只归属最深声明）', () => {
    const { assignments } = resolveOwnership([
      { dir: 'packages/brain/src', capability: 'cecelia/F0' },
      { dir: 'packages/brain/src/map', capability: 'cecelia/MJ5' },
    ], MANIFEST_CAPS);
    expect(assignments['packages/brain/src/map/projector.js']).toBe('MJ5');
    expect(assignments['packages/brain/src/tick.js']).toBe('F0');
  });

  it('同一路径双重声明报冲突不投影（不取最深、不全投影）', () => {
    const { assignments, conflicts } = resolveOwnership([
      { dir: 'packages/brain/src/map', capability: 'cecelia/MJ5' },
      { dir: 'packages/brain/src/map', capability: 'cecelia/F0' },
    ], MANIFEST_CAPS);
    const conflict = conflicts.find((c) => c.path === 'packages/brain/src/map');
    expect(conflict).toBeTruthy();
    expect(conflict.reason).toBe('multiple_declarations');
    expect(conflict.capabilities.sort()).toEqual(['F0', 'MJ5']);
    // 冲突路径不进 assignments
    expect(assignments['packages/brain/src/map/projector.js']).toBeUndefined();
  });

  it('capability key 不在 manifest 打空（unknown_capability，进 conflicts 不投影）', () => {
    const { assignments, conflicts } = resolveOwnership([
      { dir: 'packages/brain/src/map', capability: 'cecelia/ZZZ' },
    ], MANIFEST_CAPS);
    const conflict = conflicts.find((c) => c.path === 'packages/brain/src/map');
    expect(conflict.reason).toBe('unknown_capability');
    expect(Object.keys(assignments)).toHaveLength(0);
  });
});
