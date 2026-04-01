import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { resolve } from 'path';

const SCRIPT = resolve(__dirname, '../../scripts/affected-packages.js');

/**
 * 调用 affected-packages.js 并返回解析后的包数组
 */
function getAffected(files: string[]): string[] {
  const input = files.join('\n');
  const result = execSync(`node "${SCRIPT}"`, {
    input,
    encoding: 'utf8',
    cwd: resolve(__dirname, '../../'),
  }).trim();
  return JSON.parse(result);
}

describe('affected-packages.js', () => {
  it('docs/learnings/ 文件映射到 engine，不触发全包', () => {
    const affected = getAffected(['docs/learnings/cp-01010000-test.md']);
    expect(affected).toContain('engine');
    expect(affected).not.toContain('api');
    expect(affected).not.toContain('dashboard');
  });

  it('docs/ 路径文件映射到 engine，不触发全包', () => {
    const affected = getAffected(['docs/reports/some-report.md']);
    expect(affected).toContain('engine');
    expect(affected).not.toContain('api');
    expect(affected).not.toContain('dashboard');
  });

  it('packages/engine/ 文件正常映射到 engine', () => {
    const affected = getAffected(['packages/engine/scripts/devgate/sprint-contract-loop.sh']);
    expect(affected).toContain('engine');
    expect(affected).not.toContain('api');
  });

  it('apps/dashboard/ 文件正常映射到 frontend (dashboard)', () => {
    const affected = getAffected(['apps/dashboard/src/App.tsx']);
    expect(affected).toContain('dashboard');
  });

  it('.github/workflows/ 文件触发全包', () => {
    const affected = getAffected(['.github/workflows/ci.yml']);
    expect(affected).toContain('engine');
    expect(affected).toContain('api');
    expect(affected).toContain('dashboard');
  });

  it('engine + docs/learnings/ 混合变更只影响 engine', () => {
    const affected = getAffected([
      'packages/engine/scripts/devgate/sprint-contract-loop.sh',
      'docs/learnings/cp-04010846-sprint-contract-resume.md',
    ]);
    expect(affected).toContain('engine');
    expect(affected).not.toContain('api');
    expect(affected).not.toContain('dashboard');
  });
});
