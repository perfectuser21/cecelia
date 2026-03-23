import { describe, it, expect } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { scanMissingRci } = require('../../scripts/devgate/check-new-files-need-rci.cjs');

// ─── 降级保护 ──────────────────────────────────────────────────────────────

describe('scanMissingRci — 降级保护', () => {
  it('[PROTECT-1] 空 changedFiles → 返回空数组', () => {
    expect(scanMissingRci([], '')).toEqual([]);
  });

  it('[PROTECT-1] undefined changedFiles → 返回空数组', () => {
    expect(scanMissingRci(undefined, '')).toEqual([]);
  });

  it('[PROTECT-3] 非目标路径文件 → 返回空数组', () => {
    const files = [
      'packages/brain/src/server.js',
      'packages/engine/tests/foo.test.ts',
      'apps/dashboard/src/App.tsx',
      'README.md',
    ];
    expect(scanMissingRci(files, '')).toEqual([]);
  });

  it('[PROTECT-3] packages/engine/skills/ 下文件 → 不在目标范围，返回空数组', () => {
    expect(scanMissingRci(['packages/engine/skills/dev/SKILL.md'], '')).toEqual([]);
  });
});

// ─── 核心功能：RCI 匹配 ────────────────────────────────────────────────────

describe('scanMissingRci — 核心匹配逻辑', () => {
  const yamlWithHook = `
- id: H9-001
  name: "新 hook 测试"
  evidence:
    file: hooks/new-hook.sh
    contains: "some-pattern"
`;

  const yamlWithDevgate = `
- id: D9-001
  name: "新 devgate 工具"
  evidence:
    file: scripts/devgate/new-tool.cjs
`;

  it('[PROTECT-2] hooks/ 下文件已有 RCI evidence.file → 返回空数组', () => {
    const files = ['packages/engine/hooks/new-hook.sh'];
    expect(scanMissingRci(files, yamlWithHook)).toEqual([]);
  });

  it('[PROTECT-2] scripts/devgate/ 下文件已有 RCI evidence.file → 返回空数组', () => {
    const files = ['packages/engine/scripts/devgate/new-tool.cjs'];
    expect(scanMissingRci(files, yamlWithDevgate)).toEqual([]);
  });

  it('[CORE] hooks/ 下缺少 RCI 的文件 → 返回该文件路径', () => {
    const files = ['packages/engine/hooks/orphan.sh'];
    const result = scanMissingRci(files, '');
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('orphan.sh');
  });

  it('[CORE] scripts/devgate/ 下缺少 RCI 的 cjs 文件 → 返回该文件路径', () => {
    const files = ['packages/engine/scripts/devgate/orphan-tool.cjs'];
    const result = scanMissingRci(files, '');
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('orphan-tool.cjs');
  });

  it('[CORE] 混合文件：有 RCI 的过滤，无 RCI 的返回', () => {
    const files = [
      'packages/engine/hooks/covered.sh',     // 有 RCI
      'packages/engine/hooks/orphan.sh',       // 无 RCI
      'packages/brain/src/server.js',          // 非目标路径
    ];
    const yaml = `
- id: H1-001
  evidence:
    file: hooks/covered.sh
`;
    const result = scanMissingRci(files, yaml);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('orphan.sh');
    expect(result.every((f: string) => !f.includes('covered.sh'))).toBe(true);
    expect(result.every((f: string) => !f.includes('server.js'))).toBe(true);
  });

  it('[CORE] 多个缺少 RCI 的文件 → 全部返回', () => {
    const files = [
      'packages/engine/hooks/orphan1.sh',
      'packages/engine/hooks/orphan2.sh',
      'packages/engine/scripts/devgate/orphan3.cjs',
    ];
    const result = scanMissingRci(files, '');
    expect(result).toHaveLength(3);
  });

  it('[EDGE] contractContent 为 null → 视为无 RCI，返回目标文件', () => {
    const files = ['packages/engine/hooks/new-hook.sh'];
    const result = scanMissingRci(files, null);
    expect(result).toHaveLength(1);
  });
});

// ─── 目标路径检测 ──────────────────────────────────────────────────────────

describe('scanMissingRci — 目标路径识别', () => {
  it('packages/engine/hooks/*.sh 属于目标路径', () => {
    const result = scanMissingRci(['packages/engine/hooks/foo.sh'], '');
    expect(result).toHaveLength(1);
  });

  it('packages/engine/scripts/devgate/*.cjs 属于目标路径', () => {
    const result = scanMissingRci(['packages/engine/scripts/devgate/foo.cjs'], '');
    expect(result).toHaveLength(1);
  });

  it('packages/engine/hooks/ 下的非 .sh 文件 → 不在目标范围', () => {
    // hooks 目录下只扫 .sh 文件
    const result = scanMissingRci(['packages/engine/hooks/VERSION'], '');
    expect(result).toHaveLength(0);
  });

  it('packages/engine/scripts/devgate/ 下的非 .cjs 文件 → 不在目标范围', () => {
    // devgate 目录下只扫 .cjs 文件
    const result = scanMissingRci(['packages/engine/scripts/devgate/foo.sh'], '');
    expect(result).toHaveLength(0);
  });
});
