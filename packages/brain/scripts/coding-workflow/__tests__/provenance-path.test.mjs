import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { provenanceRoot, canonicalPath, assertProvenanceSeparation } from '../lib/provenance-path.mjs';

describe('provenance 路径的实际文件系统边界', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'provenance-path-'));
  const root = provenanceRoot(base);
  fs.mkdirSync(root, { recursive: true });
  it('最近存在祖先别名不能隐藏未创建的受保护子目录', () => {
    const alias = path.join(base, 'alias');
    fs.symlinkSync(root, alias);
    const newPath = path.join(alias, 'new', 'receipt.json');
    expect(canonicalPath(newPath)).toBe(path.join(fs.realpathSync(root), 'new', 'receipt.json'));
    expect(() => assertProvenanceSeparation(root, [newPath])).toThrow('provenance_path_overlap');
    expect(() => assertProvenanceSeparation(root, [path.dirname(alias)])).toThrow('provenance_path_overlap');
  });
  it('相邻目录不会被字符串前缀误判，真正祖先及根本身仍拒绝', () => {
    expect(assertProvenanceSeparation(root, [`${root}-logs`])).toBe(fs.realpathSync(root));
    expect(() => assertProvenanceSeparation(root, [root])).toThrow('provenance_path_overlap');
    expect(() => assertProvenanceSeparation(root, [path.dirname(root)])).toThrow('provenance_path_overlap');
  });
  it('缺失尾段可规范化，悬空链接与别名 traversal 不能当正常缺失路径', () => {
    const missing = path.join(base, 'missing', 'deeper');
    expect(canonicalPath(missing)).toBe(path.join(fs.realpathSync(base), 'missing', 'deeper'));
    const broken = path.join(base, 'broken');
    fs.symlinkSync(missing, broken);
    expect(() => canonicalPath(broken)).toThrow('provenance_path_dangling_symlink');
    expect(() => canonicalPath(`${broken}/../escape`)).toThrow('provenance_path_invalid');
    expect(() => canonicalPath('')).toThrow('provenance_path_invalid');
    expect(() => canonicalPath('bad\0path')).toThrow('provenance_path_invalid');
  });
  it('合法 HOME 别名解析到同一受保护根，根别名不能借 cwd 获取写授权', () => {
    const homeAlias = path.join(base, 'home-alias');
    fs.symlinkSync(base, homeAlias);
    const viaAlias = provenanceRoot(homeAlias);
    expect(canonicalPath(viaAlias)).toBe(fs.realpathSync(root));
    expect(() => assertProvenanceSeparation(viaAlias, [root])).toThrow('provenance_path_overlap');
  });
});
