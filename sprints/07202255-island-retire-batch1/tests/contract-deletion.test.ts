/**
 * contract-deletion.test.ts
 *
 * 合同测试：孤岛退役批次1 删除验收
 * Task ID: c3adb5e6-3b80-4682-8362-15ac086b06ea
 *
 * 测试三组：
 *   - 组 A：n8n archive 9 个 JSON 文件
 *   - 组 B：engine/src/harness 3 个 JS 文件
 *   - 组 C：dashboard TSX 桩 2 个文件
 *
 * 运行：cd /workspace && node --test sprints/07202255-island-retire-batch1/tests/contract-deletion.test.ts
 * 或：   cd /workspace && npx vitest run sprints/07202255-island-retire-batch1/tests/contract-deletion.test.ts
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../../');

// ─── 组 A：n8n archive JSON ───────────────────────────────────────────────────

describe('[B1] 组 A：n8n archive 9 个 JSON 文件已删除', () => {
  const archiveFiles = [
    'packages/workflows/n8n/archive/clean-task-dispatcher.json',
    'packages/workflows/n8n/archive/clean-feature-completion-sync.json',
    'packages/workflows/n8n/archive/cecelia-callback-handler-v2.1.json',
    'packages/workflows/n8n/archive/devgate-nightly-push.json',
    'packages/workflows/n8n/archive/clean-feature-entry-checker.json',
    'packages/workflows/n8n/archive/clean-feature-completion-sync-2.json',
    'packages/workflows/n8n/archive/clean-completion-sync-v1.json',
    'packages/workflows/n8n/archive/prd-executor.json',
    'packages/workflows/n8n/archive/cecelia-launcher-v2.json',
  ];

  for (const f of archiveFiles) {
    it(`文件不存在: ${f}`, () => {
      const fullPath = path.join(REPO_ROOT, f);
      expect(existsSync(fullPath), `文件应已被删除，但仍存在: ${fullPath}`).toBe(false);
    });
  }
});

describe('[B5] 组 A：n8n/archive 无 JS/TS/SH 外部引用残留', () => {
  it('grep 扫描 n8n/archive 引用为 0 命中', () => {
    let hits = '';
    try {
      hits = execSync(
        `grep -r "n8n/archive" "${REPO_ROOT}" --include="*.js" --include="*.ts" --include="*.sh" 2>/dev/null`,
        { encoding: 'utf8' }
      ).trim();
    } catch {
      // grep 无命中时 exit 1，execSync 抛出，hits 保持空字符串
      hits = '';
    }
    expect(hits, `发现 n8n/archive 外部引用:\n${hits}`).toBe('');
  });
});

// ─── 组 B：engine/src/harness 死簇 ───────────────────────────────────────────

describe('[B2] 组 B：engine harness 3 个 JS 文件已删除', () => {
  const harnessFiles = [
    'packages/engine/src/harness/runner.js',
    'packages/engine/src/harness/evaluate.js',
    'packages/engine/src/harness/e2e-judge.js',
  ];

  for (const f of harnessFiles) {
    it(`文件不存在: ${f}`, () => {
      const fullPath = path.join(REPO_ROOT, f);
      expect(existsSync(fullPath), `文件应已被删除，但仍存在: ${fullPath}`).toBe(false);
    });
  }
});

describe('[B2] 组 B：harness runner/evaluate/e2e-judge 无引用残留', () => {
  it('grep 扫描 harness/runner|harness/evaluate|harness/e2e-judge 为 0 命中', () => {
    let hits = '';
    try {
      hits = execSync(
        `grep -r "harness/runner\\|harness/evaluate\\|harness/e2e-judge" "${REPO_ROOT}" --include="*.js" --include="*.ts" 2>/dev/null`,
        { encoding: 'utf8' }
      ).trim();
    } catch {
      hits = '';
    }
    expect(hits, `发现 harness 引用残留:\n${hits}`).toBe('');
  });
});

// ─── 组 C：dashboard TSX 桩 ──────────────────────────────────────────────────

describe('[B3] 组 C：dashboard TSX 桩已删除', () => {
  it('TestPyramidPage.tsx 不存在', () => {
    const fullPath = path.join(REPO_ROOT, 'apps/dashboard/src/pages/test-pyramid/TestPyramidPage.tsx');
    expect(existsSync(fullPath), `TestPyramidPage.tsx 应已被删除，但仍存在: ${fullPath}`).toBe(false);
  });

  it('RelayProgressPage.tsx 不存在', () => {
    const fullPath = path.join(REPO_ROOT, 'apps/dashboard/src/pages/relay-progress/RelayProgressPage.tsx');
    expect(existsSync(fullPath), `RelayProgressPage.tsx 应已被删除，但仍存在: ${fullPath}`).toBe(false);
  });
});

describe('[B3] 组 C：index.ts 已更新为直接 re-export @features/core 实现', () => {
  it('test-pyramid/index.ts 不再引用已删 ./TestPyramidPage', () => {
    const idxPath = path.join(REPO_ROOT, 'apps/dashboard/src/pages/test-pyramid/index.ts');
    // index.ts 本身应存在（PRD 保留）
    expect(existsSync(idxPath), 'index.ts 应存在').toBe(true);
    const content = readFileSync(idxPath, 'utf8');
    // 不应有对已删桩文件的 relative import
    expect(content, 'index.ts 不应引用 ./TestPyramidPage 桩文件').not.toMatch(/from\s+['"]\.\/TestPyramidPage['"]/);
    // 应指向 @features/core
    expect(content, 'index.ts 应指向 @features/core 实现').toMatch(/@features\/core/);
  });

  it('relay-progress/index.ts 不再引用已删 ./RelayProgressPage', () => {
    const idxPath = path.join(REPO_ROOT, 'apps/dashboard/src/pages/relay-progress/index.ts');
    expect(existsSync(idxPath), 'index.ts 应存在').toBe(true);
    const content = readFileSync(idxPath, 'utf8');
    expect(content, 'index.ts 不应引用 ./RelayProgressPage 桩文件').not.toMatch(/from\s+['"]\.\/RelayProgressPage['"]/);
    expect(content, 'index.ts 应指向 @features/core 实现').toMatch(/@features\/core/);
  });
});

describe('[B3] 组 C：保留文件完整性验证', () => {
  it('test-pyramid/index.ts 保留（PRD 明确不删）', () => {
    expect(existsSync(path.join(REPO_ROOT, 'apps/dashboard/src/pages/test-pyramid/index.ts'))).toBe(true);
  });

  it('relay-progress/index.ts 保留（PRD 明确不删）', () => {
    expect(existsSync(path.join(REPO_ROOT, 'apps/dashboard/src/pages/relay-progress/index.ts'))).toBe(true);
  });

  it('test-pyramid/__tests__ 目录保留（PRD 明确不删）', () => {
    expect(existsSync(path.join(REPO_ROOT, 'apps/dashboard/src/pages/test-pyramid/__tests__'))).toBe(true);
  });

  it('relay-progress/__tests__ 目录保留（PRD 明确不删）', () => {
    expect(existsSync(path.join(REPO_ROOT, 'apps/dashboard/src/pages/relay-progress/__tests__'))).toBe(true);
  });

  it('@features/core 实现文件存在（TestPyramidPage 真实实现）', () => {
    expect(existsSync(path.join(REPO_ROOT, 'apps/api/features/execution/pages/TestPyramidPage.tsx'))).toBe(true);
  });

  it('@features/core 实现文件存在（RelayProgressPage 真实实现）', () => {
    expect(existsSync(path.join(REPO_ROOT, 'apps/api/features/execution/pages/RelayProgressPage.tsx'))).toBe(true);
  });
});

// ─── 组 C 补充：B7 测试文件不再直接 import 已删桩 ───────────────────────────

describe('[B7] 组 C：__tests__ 业务测试文件不再直接 import 已删桩', () => {
  it('test-pyramid/__tests__ 文件不含直接引用 ../TestPyramidPage 的 import', () => {
    const testsDir = path.join(REPO_ROOT, 'apps/dashboard/src/pages/test-pyramid/__tests__');
    if (!existsSync(testsDir)) {
      // 目录不存在则跳过（不是本批次关注点）
      return;
    }
    const files = readdirSync(testsDir).filter(f => f.endsWith('.tsx') || f.endsWith('.ts'));
    for (const file of files) {
      const content = readFileSync(path.join(testsDir, file), 'utf8');
      expect(
        content,
        `${file} 不应直接 import 已删桩 ../TestPyramidPage`
      ).not.toMatch(/from\s+['"]\.\.\\/TestPyramidPage['"]/);
    }
  });

  it('relay-progress/__tests__ 文件不含直接引用 ../RelayProgressPage 的 import', () => {
    const testsDir = path.join(REPO_ROOT, 'apps/dashboard/src/pages/relay-progress/__tests__');
    if (!existsSync(testsDir)) {
      return;
    }
    const files = readdirSync(testsDir).filter(f => f.endsWith('.tsx') || f.endsWith('.ts'));
    for (const file of files) {
      const content = readFileSync(path.join(testsDir, file), 'utf8');
      expect(
        content,
        `${file} 不应直接 import 已删桩 ../RelayProgressPage`
      ).not.toMatch(/from\s+['"]\.\.\\/RelayProgressPage['"]/);
    }
  });
});

// ─── 停手条件验证（前置扫描，实现前必须通过）────────────────────────────────

describe('[停手条件] 删除前引用扫描（本段在删除前应全部通过）', () => {
  it('[停手] n8n/archive 无任何 JS/TS/SH 外部引用（确认删除安全）', () => {
    let hits = '';
    try {
      hits = execSync(
        `grep -r "n8n/archive" "${REPO_ROOT}" --include="*.js" --include="*.ts" --include="*.sh" 2>/dev/null`,
        { encoding: 'utf8' }
      ).trim();
    } catch {
      hits = '';
    }
    expect(hits).toBe('');
  });

  it('[停手] harness runner/evaluate/e2e-judge 无 engine 外引用（确认删除安全）', () => {
    // 过滤掉组 B 三文件自身（只检查外部引用）
    let hits = '';
    try {
      const raw = execSync(
        `grep -rn "harness/runner\\|harness/evaluate\\|harness/e2e-judge" "${REPO_ROOT}" --include="*.js" --include="*.ts" 2>/dev/null`,
        { encoding: 'utf8' }
      ).trim();
      // 过滤三文件自身内部互引
      hits = raw
        .split('\n')
        .filter(line =>
          !line.includes('packages/engine/src/harness/runner.js') &&
          !line.includes('packages/engine/src/harness/evaluate.js') &&
          !line.includes('packages/engine/src/harness/e2e-judge.js')
        )
        .join('\n')
        .trim();
    } catch {
      hits = '';
    }
    expect(hits, `发现 engine 外部引用（停手！）:\n${hits}`).toBe('');
  });
});
