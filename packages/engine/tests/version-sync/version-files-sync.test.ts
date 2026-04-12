/**
 * Engine 版本文件同步性测试
 *
 * 确保 6 个版本文件（package.json / package-lock.json / VERSION /
 * .hook-core-version / hooks/VERSION / regression-contract.yaml）保持一致。
 *
 * 本测试在本地 npm test 即可发现版本不同步问题，不必等到 CI 失败。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ENGINE_ROOT = resolve(__dirname, '../..');

function readVersion(relPath: string): string | null {
  const abs = resolve(ENGINE_ROOT, relPath);
  try {
    const content = readFileSync(abs, 'utf8');
    if (relPath.endsWith('.json')) {
      return JSON.parse(content).version ?? null;
    }
    if (relPath.endsWith('.yaml') || relPath.endsWith('.yml')) {
      const m = content.match(/^version:\s*(\S+)/m);
      return m ? m[1] : null;
    }
    return content.trim();
  } catch {
    return null;
  }
}

describe('Engine 版本文件同步性', () => {
  const base = readVersion('package.json');

  it('package.json 版本可读', () => {
    expect(base).toBeTruthy();
    expect(base).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('package-lock.json 与 package.json 版本一致', () => {
    const v = readVersion('package-lock.json');
    expect(v, `package-lock.json(${v}) ≠ package.json(${base})，运行: bash packages/engine/scripts/bump-version.sh`).toBe(base);
  });

  it('VERSION 与 package.json 版本一致', () => {
    const v = readVersion('VERSION');
    expect(v, `VERSION(${v}) ≠ package.json(${base})，运行: bash packages/engine/scripts/bump-version.sh`).toBe(base);
  });

  it('.hook-core-version 与 package.json 版本一致', () => {
    const v = readVersion('.hook-core-version');
    expect(v, `.hook-core-version(${v}) ≠ package.json(${base})，运行: bash packages/engine/scripts/bump-version.sh`).toBe(base);
  });

  it('hooks/VERSION 与 package.json 版本一致', () => {
    const v = readVersion('hooks/VERSION');
    expect(v, `hooks/VERSION(${v}) ≠ package.json(${base})，运行: bash packages/engine/scripts/bump-version.sh`).toBe(base);
  });

  it('regression-contract.yaml 与 package.json 版本一致', () => {
    const v = readVersion('regression-contract.yaml');
    expect(v, `regression-contract.yaml(${v}) ≠ package.json(${base})，运行: bash packages/engine/scripts/bump-version.sh`).toBe(base);
  });
});
