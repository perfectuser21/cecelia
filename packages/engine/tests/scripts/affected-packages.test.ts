import { describe, it, expect } from 'vitest';
import { computeAffectedPackages, mapFileToPackage } from '../../scripts/affected-packages.js';

describe('affected-packages.js', () => {
  describe('computeAffectedPackages', () => {
    it('docs/learnings/ 文件映射到 engine，不触发全包', () => {
      const affected = computeAffectedPackages(['docs/learnings/cp-01010000-test.md']);
      expect(affected).toContain('engine');
      expect(affected).not.toContain('api');
      expect(affected).not.toContain('dashboard');
    });

    it('docs/ 路径文件映射到 engine，不触发全包', () => {
      const affected = computeAffectedPackages(['docs/reports/some-report.md']);
      expect(affected).toContain('engine');
      expect(affected).not.toContain('api');
      expect(affected).not.toContain('dashboard');
    });

    it('packages/engine/ 文件正常映射到 engine', () => {
      const affected = computeAffectedPackages(['packages/engine/scripts/devgate/rci-execution-gate.sh']);
      expect(affected).toContain('engine');
      expect(affected).not.toContain('api');
    });

    it('apps/dashboard/ 文件正常映射到 frontend (dashboard)', () => {
      const affected = computeAffectedPackages(['apps/dashboard/src/App.tsx']);
      expect(affected).toContain('dashboard');
    });

    it('.github/workflows/ 文件触发全包', () => {
      const affected = computeAffectedPackages(['.github/workflows/ci.yml']);
      expect(affected).toContain('engine');
      expect(affected).toContain('api');
      expect(affected).toContain('dashboard');
    });

    it('engine + docs/learnings/ 混合变更只影响 engine', () => {
      const affected = computeAffectedPackages([
        'packages/engine/scripts/devgate/rci-execution-gate.sh',
        'docs/learnings/cp-04021852-engine-deep-cleanup.md',
      ]);
      expect(affected).toContain('engine');
      expect(affected).not.toContain('api');
      expect(affected).not.toContain('dashboard');
    });
  });

  describe('mapFileToPackage', () => {
    it('docs/learnings/ 映射到 engine', () => {
      expect(mapFileToPackage('docs/learnings/cp-01010000-test.md')).toBe('engine');
    });

    it('docs/ 路径映射到 engine', () => {
      expect(mapFileToPackage('docs/reports/some-report.md')).toBe('engine');
    });

    it('packages/engine/ 映射到 engine', () => {
      expect(mapFileToPackage('packages/engine/scripts/affected-packages.js')).toBe('engine');
    });

    it('.github/workflows/ 触发 ALL', () => {
      expect(mapFileToPackage('.github/workflows/ci.yml')).toBe('ALL');
    });
  });
});
