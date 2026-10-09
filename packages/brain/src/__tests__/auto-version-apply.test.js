/**
 * auto-version-apply.test.js — 并行血管P3 回归测试(RED 先行)
 *
 * 案卷:09-06 四舰队版本五连撞——PR 自带 bump(gate 逼的)与合并后 bot bump(auto-version.yml)
 * 两套机制打架,每合一舰全队 rebase,O(n²) 人肉。修法:bump 全权归 bot,
 * DEFINITION 条目走 changes/<branch>.md 碎片(文件名唯一=并行零冲突),bot 消费。
 * 顺治:bot 原版不同步根 package-lock 的 workspace 版本(npm10 edgesOut 案)。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyAutoVersion } from '../../scripts/auto-version-apply.mjs';

function seedRepo() {
  const root = mkdtempSync(join(tmpdir(), 'avp-'));
  mkdirSync(join(root, 'packages/brain'), { recursive: true });
  mkdirSync(join(root, 'changes'), { recursive: true });
  writeFileSync(join(root, 'packages/brain/package.json'),
    JSON.stringify({ name: 'cecelia-brain', version: '1.273.195' }, null, 2));
  writeFileSync(join(root, 'packages/brain/package-lock.json'),
    JSON.stringify({ name: 'cecelia-brain', version: '1.273.195', packages: { '': { version: '1.273.195' } } }, null, 2));
  writeFileSync(join(root, 'package-lock.json'),
    JSON.stringify({ name: 'cecelia', version: '0.0.0', packages: { 'packages/brain': { name: 'cecelia-brain', version: '1.273.195' } } }, null, 2));
  writeFileSync(join(root, '.brain-versions'), '1.273.195');
  writeFileSync(join(root, 'DEFINITION.md'),
    '# 定义\n\n**Brain 版本**: 1.273.195\n\n## Brain 1.273.195 — 旧条目\n\n- 旧内容\n');
  return root;
}

describe('applyAutoVersion', () => {
  let root;
  beforeEach(() => { root = seedRepo(); });

  it('patch bump:五件套全同步,含根 lock 的 workspace 版本(edgesOut 洞回归)', () => {
    const r = applyAutoVersion(root, { bumpType: 'patch' });
    expect(r.newVersion).toBe('1.273.196');
    expect(JSON.parse(readFileSync(join(root, 'packages/brain/package.json'))).version).toBe('1.273.196');
    const bl = JSON.parse(readFileSync(join(root, 'packages/brain/package-lock.json')));
    expect(bl.version).toBe('1.273.196');
    expect(bl.packages[''].version).toBe('1.273.196');
    const rl = JSON.parse(readFileSync(join(root, 'package-lock.json')));
    expect(rl.packages['packages/brain'].version).toBe('1.273.196');
    expect(readFileSync(join(root, '.brain-versions'), 'utf8').trim()).toBe('1.273.196');
    expect(readFileSync(join(root, 'DEFINITION.md'), 'utf8')).toContain('**Brain 版本**: 1.273.196');
  });

  it('消费 changes/ 碎片:内容成为 DEFINITION 新条目(置于版本行下、旧条目上),碎片删除', () => {
    writeFileSync(join(root, 'changes/cp-0906-foo.md'),
      '## Brain {VERSION} — 四格路由器(件1)\n\n- execution 永不进 kernel\n');
    const r = applyAutoVersion(root, { bumpType: 'patch' });
    const d = readFileSync(join(root, 'DEFINITION.md'), 'utf8');
    expect(d).toContain('## Brain 1.273.196 — 四格路由器(件1)');
    // 新条目在旧条目之前
    expect(d.indexOf('四格路由器')).toBeLessThan(d.indexOf('旧条目'));
    expect(existsSync(join(root, 'changes/cp-0906-foo.md'))).toBe(false);
    expect(r.fragmentsConsumed).toBe(1);
  });

  it('多碎片按文件名序各占一个版本号(两碎片=连 bump 两次,各自条目)', () => {
    writeFileSync(join(root, 'changes/cp-a.md'), '## Brain {VERSION} — A件\n\n- a\n');
    writeFileSync(join(root, 'changes/cp-b.md'), '## Brain {VERSION} — B件\n\n- b\n');
    const r = applyAutoVersion(root, { bumpType: 'patch' });
    expect(r.newVersion).toBe('1.273.197');
    const d = readFileSync(join(root, 'DEFINITION.md'), 'utf8');
    expect(d).toContain('## Brain 1.273.196 — A件');
    expect(d).toContain('## Brain 1.273.197 — B件');
    expect(d).toContain('**Brain 版本**: 1.273.197');
  });

  it('changes/README.md 不算碎片', () => {
    writeFileSync(join(root, 'changes/README.md'), '# 约定说明');
    const r = applyAutoVersion(root, { bumpType: 'patch' });
    expect(r.fragmentsConsumed).toBe(0);
    expect(existsSync(join(root, 'changes/README.md'))).toBe(true);
  });

  it('无碎片纯 bump(兼容存量流程):只动版本行,不造空条目', () => {
    const r = applyAutoVersion(root, { bumpType: 'patch' });
    expect(r.fragmentsConsumed).toBe(0);
    const d = readFileSync(join(root, 'DEFINITION.md'), 'utf8');
    expect(d.match(/## Brain 1\.273\.196/)).toBeNull();
  });

  it('幂等防线:目标版本已达且无碎片 → no-op 不再 bump', () => {
    applyAutoVersion(root, { bumpType: 'patch' });
    const r2 = applyAutoVersion(root, { bumpType: 'patch', ifFragmentsOnly: true });
    expect(r2.skipped).toBe(true);
    expect(JSON.parse(readFileSync(join(root, 'packages/brain/package.json'))).version).toBe('1.273.196');
  });
});
