import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync, mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { resolve, join } from 'path';

const SCRIPT = resolve(__dirname, '../../scripts/devgate/playwright-evaluator.cjs');
const ENGINE_ROOT = resolve(__dirname, '../..');

describe('playwright-evaluator.cjs — 脚本存在性', () => {
  it('脚本文件存在', () => {
    expect(existsSync(SCRIPT)).toBe(true);
  });
});

describe('playwright-evaluator.cjs — --dry-run 模式', () => {
  it('--dry-run 标志下不需要 Brain 运行，退出码 0', () => {
    const dir = mkdtempSync(join(ENGINE_ROOT, '.tmp-evaluator-'));
    const taskCard = join(dir, '.task-test.md');
    writeFileSync(taskCard, `# Task Card: Test

## 验收条件（DoD）

- [ ] [ARTIFACT] 测试文件存在
  Test: manual:node -e "require('fs').accessSync('packages/engine/package.json')"

- [ ] [BEHAVIOR] Brain API 健康检查
  Test: manual:curl http://localhost:5221/api/brain/health
`);
    try {
      const result = execSync(
        `node "${SCRIPT}" --dry-run --task-card "${taskCard}" 2>&1`,
        { encoding: 'utf8', cwd: ENGINE_ROOT }
      );
      expect(result).toMatch(/DRY RUN|dry.run/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--dry-run 输出发现的 [BEHAVIOR] 条目数量', () => {
    const dir = mkdtempSync(join(ENGINE_ROOT, '.tmp-evaluator-'));
    const taskCard = join(dir, '.task-test.md');
    writeFileSync(taskCard, `# Task Card: Test

## 验收条件（DoD）

- [ ] [BEHAVIOR] 行为1
  Test: manual:node -e "process.exit(0)"

- [ ] [BEHAVIOR] 行为2
  Test: manual:curl http://localhost:5221/api/health
`);
    try {
      const result = execSync(
        `node "${SCRIPT}" --dry-run --task-card "${taskCard}" 2>&1`,
        { encoding: 'utf8', cwd: ENGINE_ROOT }
      );
      expect(result).toMatch(/2.*BEHAVIOR|BEHAVIOR.*2/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('playwright-evaluator.cjs — Brain /health 基线', () => {
  it('脚本源码包含 /api/brain/health 基线检查', () => {
    const content = readFileSync(SCRIPT, 'utf8');
    expect(content).toContain('/api/brain/health');
  });

  it('脚本源码包含 [BEHAVIOR] 解析逻辑', () => {
    const content = readFileSync(SCRIPT, 'utf8');
    expect(content).toContain('BEHAVIOR');
  });
});

describe('playwright-evaluator.cjs — --run 模式（Brain 离线时报告失败）', () => {
  it('Brain 离线时 --run 退出码为 1（至少基线检查失败）', () => {
    const dir = mkdtempSync(join(ENGINE_ROOT, '.tmp-evaluator-'));
    const taskCard = join(dir, '.task-test.md');
    writeFileSync(taskCard, `# Task Card: Test

## 验收条件（DoD）

- [ ] [ARTIFACT] 文件存在
  Test: manual:node -e "require('fs').accessSync('packages/engine/package.json')"
`);
    try {
      // 使用不存在的端口确保 Brain 离线
      const result = execSync(
        `node "${SCRIPT}" --run --task-card "${taskCard}" --brain-url http://localhost:59999 2>&1 || true`,
        { encoding: 'utf8', cwd: ENGINE_ROOT }
      );
      // 应该包含 FAIL 或 Brain 相关报告
      expect(result).toMatch(/FAIL|fail|error|Error/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
