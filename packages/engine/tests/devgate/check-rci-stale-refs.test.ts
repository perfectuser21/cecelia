import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { join } from 'path';
import * as path from 'path';

// 使用字符串 literal require，让覆盖率门禁识别 import 关系
// eslint-disable-next-line @typescript-eslint/no-var-requires
const staleRefsModule = require('../../scripts/devgate/check-rci-stale-refs.cjs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const detectPriorityModule = require('../../scripts/devgate/detect-priority.cjs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const scanRciModule = require('../../scripts/devgate/scan-rci-coverage.cjs');

const { extractFileRefs, findRepoRoot, findStaleRefs } = staleRefsModule;
const { detectFromChangedFiles, CORE_PATH_PATTERNS_P0 } = detectPriorityModule;
const { parseRCI, checkCoverage } = scanRciModule;

const REPO_ROOT = join(__dirname, '../../../..');
const SCRIPT = join(REPO_ROOT, 'packages/engine/scripts/devgate/check-rci-stale-refs.cjs');
const DETECT_PRIORITY = join(REPO_ROOT, 'packages/engine/scripts/devgate/detect-priority.cjs');

// ─── check-rci-stale-refs.cjs 单元测试 ──────────────────────────────────────

describe('check-rci-stale-refs.cjs — 单元测试', () => {
  it('[ARTIFACT] 脚本文件存在', () => {
    const { accessSync } = require('fs');
    expect(() => accessSync(SCRIPT)).not.toThrow();
  });

  it('[UNIT] extractFileRefs 提取 file: 字段', () => {
    const yaml = `
  - id: T-001
    evidence:
      file: hooks/stop.sh
      contains: "block"
  - id: T-002
    evidence:
      file: "scripts/devgate/check-rci-stale-refs.cjs"
    `;
    const refs = extractFileRefs(yaml);
    expect(refs.some((r: any) => r.value === 'hooks/stop.sh')).toBe(true);
    expect(refs.some((r: any) => r.value === 'scripts/devgate/check-rci-stale-refs.cjs')).toBe(true);
    expect(refs.every((r: any) => r.type === 'file')).toBe(true);
  });

  it('[UNIT] extractFileRefs 提取 test: tests/ 字段', () => {
    const yaml = `
  - id: T-003
    test: tests/devgate/check-rci-stale-refs.test.ts
    `;
    const refs = extractFileRefs(yaml);
    expect(refs.some((r: any) => r.value === 'tests/devgate/check-rci-stale-refs.test.ts')).toBe(true);
    expect(refs.some((r: any) => r.type === 'test')).toBe(true);
  });

  it('[UNIT] extractFileRefs 忽略非 tests/ 开头的 test 字段', () => {
    const yaml = `
  - id: T-004
    test: "manual:node -e 'console.log(1)'"
    `;
    const refs = extractFileRefs(yaml);
    expect(refs.length).toBe(0);
  });

  it('[UNIT] extractFileRefs 带注释的 file 行', () => {
    const yaml = `  file: hooks/stop.sh  # 注释内容\n`;
    const refs = extractFileRefs(yaml);
    expect(refs.length).toBe(1);
    expect(refs[0].value).toBe('hooks/stop.sh');
  });

  it('[UNIT] findRepoRoot 返回包含 package.json workspaces 的目录', () => {
    const root = findRepoRoot();
    const { existsSync } = require('fs');
    expect(existsSync(path.join(root, 'package.json'))).toBe(true);
  });

  it('[UNIT] findStaleRefs 已存在文件不报悬空', () => {
    const repoRoot = findRepoRoot();
    const engineDir = path.join(repoRoot, 'packages/engine');
    const refs = [{ value: 'hooks/stop.sh', lineNum: 1, type: 'file' }];
    const stale = findStaleRefs(refs, engineDir, repoRoot);
    expect(stale.length).toBe(0);
  });

  it('[UNIT] findStaleRefs 不存在的文件报悬空', () => {
    const repoRoot = findRepoRoot();
    const engineDir = path.join(repoRoot, 'packages/engine');
    const refs = [{ value: 'hooks/THIS_DOES_NOT_EXIST.sh', lineNum: 99, type: 'file' }];
    const stale = findStaleRefs(refs, engineDir, repoRoot);
    expect(stale.length).toBe(1);
    expect(stale[0].value).toBe('hooks/THIS_DOES_NOT_EXIST.sh');
  });

  it('[UNIT] findStaleRefs repo root 相대路径也有效', () => {
    const repoRoot = findRepoRoot();
    const engineDir = path.join(repoRoot, 'packages/engine');
    // .github/workflows/ 相对于 repoRoot 存在
    const refs = [{ value: '.github/workflows/ci-l1-process.yml', lineNum: 5, type: 'file' }];
    const stale = findStaleRefs(refs, engineDir, repoRoot);
    expect(stale.length).toBe(0);
  });

  it('[UNIT] findStaleRefs 空 refs 返回空数组', () => {
    const repoRoot = findRepoRoot();
    const engineDir = path.join(repoRoot, 'packages/engine');
    const stale = findStaleRefs([], engineDir, repoRoot);
    expect(stale).toEqual([]);
  });
});

// ─── check-rci-stale-refs.cjs 集成测试 ─────────────────────────────────────

describe('check-rci-stale-refs.cjs — 集成测试', () => {
  it('[BEHAVIOR] 当前 regression-contract.yaml 全部引用有效（exit 0）', () => {
    let exitCode = 0;
    try {
      execSync(`node "${SCRIPT}"`, { cwd: REPO_ROOT, stdio: 'pipe' });
    } catch (e: any) {
      exitCode = e.status ?? 1;
    }
    expect(exitCode).toBe(0);
  });

  it('[BEHAVIOR] --dry-run-fake-stale 注入假悬空引用时返回非零退出码', () => {
    let exitCode = 0;
    try {
      execSync(`node "${SCRIPT}" --dry-run-fake-stale`, { cwd: REPO_ROOT, stdio: 'pipe' });
    } catch (e: any) {
      exitCode = e.status ?? 1;
    }
    expect(exitCode).not.toBe(0);
  });

  it('[BEHAVIOR] --dry-run-fake-stale 输出包含悬空引用错误信息', () => {
    let stderr = '';
    try {
      execSync(`node "${SCRIPT}" --dry-run-fake-stale`, { cwd: REPO_ROOT, stdio: 'pipe' });
    } catch (e: any) {
      stderr = e.stderr?.toString() ?? '';
    }
    expect(stderr).toContain('悬空引用');
  });
});

// ─── detect-priority.cjs — CHANGED_FILES 单元测试 ─────────────────────────

describe('detect-priority.cjs — CHANGED_FILES 单元测试', () => {
  it('[UNIT] CORE_PATH_PATTERNS_P0 包含核心 hook 路径', () => {
    expect(Array.isArray(CORE_PATH_PATTERNS_P0)).toBe(true);
    expect(CORE_PATH_PATTERNS_P0.length).toBeGreaterThan(0);
    const matchesVerifyStep = CORE_PATH_PATTERNS_P0.some((p: RegExp) =>
      p.test('packages/engine/hooks/verify-step.sh')
    );
    expect(matchesVerifyStep).toBe(true);
  });

  it('[UNIT] detectFromChangedFiles 核心 hook 文件 → 返回 P0', () => {
    process.env.CHANGED_FILES = 'packages/engine/hooks/verify-step.sh';
    const result = detectFromChangedFiles();
    delete process.env.CHANGED_FILES;
    expect(result).toBe('P0');
  });

  it('[UNIT] detectFromChangedFiles stop-dev.sh → 返回 P0', () => {
    process.env.CHANGED_FILES = 'packages/engine/hooks/stop-dev.sh';
    const result = detectFromChangedFiles();
    delete process.env.CHANGED_FILES;
    expect(result).toBe('P0');
  });

  it('[UNIT] detectFromChangedFiles 普通文件 → 返回 null', () => {
    process.env.CHANGED_FILES = 'packages/engine/scripts/devgate/check-rci-stale-refs.cjs';
    const result = detectFromChangedFiles();
    delete process.env.CHANGED_FILES;
    expect(result).toBeNull();
  });

  it('[UNIT] detectFromChangedFiles CHANGED_FILES 未设置 → 返回 null', () => {
    delete process.env.CHANGED_FILES;
    const result = detectFromChangedFiles();
    expect(result).toBeNull();
  });

  it('[UNIT] detectFromChangedFiles 多文件换行分隔', () => {
    process.env.CHANGED_FILES = 'packages/other/file.ts\npackages/engine/hooks/verify-step.sh';
    const result = detectFromChangedFiles();
    delete process.env.CHANGED_FILES;
    expect(result).toBe('P0');
  });
});

// ─── detect-priority.cjs — CHANGED_FILES 集成测试 ─────────────────────────

describe('detect-priority.cjs — 集成测试', () => {
  it('[BEHAVIOR] 改动 hooks/verify-step.sh 时自动返回 P0', () => {
    const result = execSync(`node "${DETECT_PRIORITY}"`, {
      cwd: REPO_ROOT,
      env: { ...process.env, CHANGED_FILES: 'packages/engine/hooks/verify-step.sh', SKIP_GIT_DETECTION: '1' },
      stdio: 'pipe',
    }).toString().trim();
    expect(result).toBe('P0');
  });

  it('[BEHAVIOR] 改动 hooks/stop-dev.sh 时自动返回 P0', () => {
    const result = execSync(`node "${DETECT_PRIORITY}"`, {
      cwd: REPO_ROOT,
      env: { ...process.env, CHANGED_FILES: 'packages/engine/hooks/stop-dev.sh', SKIP_GIT_DETECTION: '1' },
      stdio: 'pipe',
    }).toString().trim();
    expect(result).toBe('P0');
  });

  it('[BEHAVIOR] 改动 lib/devloop-check.sh 时自动返回 P0', () => {
    const result = execSync(`node "${DETECT_PRIORITY}"`, {
      cwd: REPO_ROOT,
      env: { ...process.env, CHANGED_FILES: 'packages/engine/lib/devloop-check.sh', SKIP_GIT_DETECTION: '1' },
      stdio: 'pipe',
    }).toString().trim();
    expect(result).toBe('P0');
  });

  it('[BEHAVIOR] 改动普通文件时不触发路径自动识别', () => {
    const result = execSync(`node "${DETECT_PRIORITY}"`, {
      cwd: REPO_ROOT,
      env: { ...process.env, CHANGED_FILES: 'packages/engine/scripts/devgate/check-rci-stale-refs.cjs', SKIP_GIT_DETECTION: '1' },
      stdio: 'pipe',
    }).toString().trim();
    expect(result).toBe('unknown');
  });

  it('[PRESERVE] CHANGED_FILES 优先级高于 PR_PRIORITY', () => {
    const result = execSync(`node "${DETECT_PRIORITY}"`, {
      cwd: REPO_ROOT,
      env: { ...process.env, CHANGED_FILES: 'packages/engine/hooks/verify-step.sh', PR_PRIORITY: 'P2', SKIP_GIT_DETECTION: '1' },
      stdio: 'pipe',
    }).toString().trim();
    expect(result).toBe('P0');
  });
});

// ─── scan-rci-coverage.cjs — file: 解析单元测试 ───────────────────────────

describe('scan-rci-coverage.cjs — file: 解析单元测试', () => {
  it('[UNIT] parseRCI 返回合约列表', () => {
    const contracts = parseRCI();
    expect(Array.isArray(contracts)).toBe(true);
    expect(contracts.length).toBeGreaterThan(0);
  });

  it('[UNIT] parseRCI evidence.file 路径被纳入 contract.paths', () => {
    const contracts = parseRCI();
    const s4002 = contracts.find((c: any) => c.id === 'S4-002');
    expect(s4002).toBeDefined();
    expect(s4002.paths).toContain('skills/intent-expand/SKILL.md');
  });

  it('[UNIT] checkCoverage 对有 file: 路径的条目返回 covered=true', () => {
    const contracts = parseRCI();
    const entry = { type: 'skill', path: 'skills/intent-expand/SKILL.md', name: '/intent-expand' };
    const result = checkCoverage(entry, contracts);
    expect(result.covered).toBe(true);
  });
});
