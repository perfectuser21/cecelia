import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { resolve, join } from 'path';

const require = createRequire(import.meta.url);
const ENGINE_ROOT = resolve(__dirname, '../..');
const {
  parseBehaviorEntries,
  checkBrainHealth,
  executeTest,
  runShellCommand,
} = require('../../scripts/devgate/playwright-evaluator.cjs');

describe('playwright-evaluator.cjs — parseBehaviorEntries', () => {
  it('空内容返回空数组', () => {
    expect(parseBehaviorEntries('')).toEqual([]);
  });

  it('解析单条 [BEHAVIOR] 条目', () => {
    const content = `
- [ ] [BEHAVIOR] 脚本正常输出
  Test: manual:node -e "process.exit(0)"
`;
    const entries = parseBehaviorEntries(content);
    expect(entries).toHaveLength(1);
    expect(entries[0].description).toBe('脚本正常输出');
    expect(entries[0].test).toBe('manual:node -e "process.exit(0)"');
  });

  it('解析多条 [BEHAVIOR] 条目', () => {
    const content = `
- [x] [BEHAVIOR] 行为1
  Test: manual:node -e "process.exit(0)"

- [ ] [BEHAVIOR] 行为2
  Test: manual:curl http://localhost:5221/api/health
`;
    const entries = parseBehaviorEntries(content);
    expect(entries).toHaveLength(2);
    expect(entries[0].description).toBe('行为1');
    expect(entries[1].description).toBe('行为2');
  });

  it('忽略无 Test: 字段的 [BEHAVIOR] 条目', () => {
    const content = `
- [ ] [BEHAVIOR] 无测试条目
  无 Test 字段
`;
    const entries = parseBehaviorEntries(content);
    expect(entries).toHaveLength(0);
  });

  it('忽略非 [BEHAVIOR] 条目', () => {
    const content = `
- [x] [ARTIFACT] 文件存在
  Test: manual:node -e "require('fs').accessSync('file')"

- [ ] [GATE] 完整性
  Test: manual:node -e "process.exit(0)"
`;
    const entries = parseBehaviorEntries(content);
    expect(entries).toHaveLength(0);
  });
});

describe('playwright-evaluator.cjs — checkBrainHealth', () => {
  it('返回包含 /api/brain/health 的基线检查', () => {
    const entry = checkBrainHealth();
    expect(entry.description).toContain('Brain');
    expect(entry.test).toContain('/api/brain/health');
    expect(entry.isBaseline).toBe(true);
  });

  it('基线检查使用 curl 命令', () => {
    const entry = checkBrainHealth();
    expect(entry.test).toContain('curl');
  });
});

describe('playwright-evaluator.cjs — runShellCommand', () => {
  it('成功命令返回 passed: true', () => {
    const result = runShellCommand('node -e "process.exit(0)"');
    expect(result.passed).toBe(true);
  });

  it('失败命令返回 passed: false', () => {
    const result = runShellCommand('node -e "process.exit(1)"');
    expect(result.passed).toBe(false);
  });
});

describe('playwright-evaluator.cjs — executeTest', () => {
  it('manual: 前缀执行 shell 命令', () => {
    const result = executeTest('manual:node -e "process.exit(0)"');
    expect(result.passed).toBe(true);
  });

  it('tests/ 前缀跳过', () => {
    const result = executeTest('tests/some.test.ts');
    expect(result.passed).toBe(true);
    expect(result.output).toContain('跳过');
  });

  it('contract: 前缀跳过', () => {
    const result = executeTest('contract:PE-001');
    expect(result.passed).toBe(true);
    expect(result.output).toContain('跳过');
  });

  it('未知格式返回 passed: false', () => {
    const result = executeTest('unknown-format:xyz');
    expect(result.passed).toBe(false);
  });
});

describe('playwright-evaluator.cjs — findTaskCard 自动搜索', () => {
  it('在 cwd 中找到 .task-cp-*.md 文件并返回路径', () => {
    const cwd = process.cwd();
    const taskCardFile = join(cwd, '.task-cp-test-coverage-temp.md');
    writeFileSync(taskCardFile, '# Task Card Test\n## 验收条件（DoD）\n- [x] [BEHAVIOR] 测试\n  Test: manual:node -e "process.exit(0)"\n');
    try {
      const resolvedPath = require.resolve('../../scripts/devgate/playwright-evaluator.cjs');
      delete require.cache[resolvedPath];
      const { findTaskCard } = require('../../scripts/devgate/playwright-evaluator.cjs');
      const result = findTaskCard();
      expect(result).toContain('.task-cp-test-coverage-temp.md');
    } finally {
      rmSync(taskCardFile, { force: true });
      const resolvedPath = require.resolve('../../scripts/devgate/playwright-evaluator.cjs');
      delete require.cache[resolvedPath];
    }
  });
});

describe('playwright-evaluator.cjs — 命令行参数解析', () => {
  it('--brain-url 参数被解析到 checkBrainHealth 输出', () => {
    const resolvedPath = require.resolve('../../scripts/devgate/playwright-evaluator.cjs');
    delete require.cache[resolvedPath];
    const origArgv = process.argv;
    process.argv = ['node', 'test', '--brain-url', 'http://localhost:9999'];
    try {
      const { checkBrainHealth } = require(resolvedPath);
      const entry = checkBrainHealth();
      expect(entry.test).toContain('http://localhost:9999');
    } finally {
      process.argv = origArgv;
      delete require.cache[resolvedPath];
    }
  });

  it('--task-card 参数被解析并存储', () => {
    const resolvedPath = require.resolve('../../scripts/devgate/playwright-evaluator.cjs');
    delete require.cache[resolvedPath];
    const origArgv = process.argv;
    const cwd = process.cwd();
    const tempCard = join(cwd, '.task-cp-argv-test-temp.md');
    writeFileSync(tempCard, '# Task Card');
    process.argv = ['node', 'test', '--task-card', tempCard];
    try {
      const { findTaskCard } = require(resolvedPath);
      const result = findTaskCard();
      expect(result).toBe(tempCard);
    } finally {
      process.argv = origArgv;
      rmSync(tempCard, { force: true });
      delete require.cache[resolvedPath];
    }
  });
});
