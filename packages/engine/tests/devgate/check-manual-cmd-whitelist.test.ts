import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { accessSync } from 'fs';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ALLOWED_TOOLS, scanManualCmdViolations } = require('../../scripts/devgate/check-manual-cmd-whitelist.cjs');

const REPO_ROOT = join(__dirname, '../../../..');
const SCRIPT = join(REPO_ROOT, 'packages/engine/scripts/devgate/check-manual-cmd-whitelist.cjs');

// ─── 文件存在性 ──────────────────────────────────────────────────────────────

describe('check-manual-cmd-whitelist.cjs — 文件存在', () => {
  it('[ARTIFACT] 脚本文件存在', () => {
    expect(() => accessSync(SCRIPT)).not.toThrow();
  });
});

// ─── 白名单定义 ──────────────────────────────────────────────────────────────

describe('check-manual-cmd-whitelist.cjs — 白名单定义', () => {
  it('[UNIT] ALLOWED_TOOLS 包含 node', () => {
    expect(ALLOWED_TOOLS).toContain('node');
  });

  it('[UNIT] ALLOWED_TOOLS 包含 npm', () => {
    expect(ALLOWED_TOOLS).toContain('npm');
  });

  it('[UNIT] ALLOWED_TOOLS 包含 curl', () => {
    expect(ALLOWED_TOOLS).toContain('curl');
  });

  it('[UNIT] ALLOWED_TOOLS 包含 bash', () => {
    expect(ALLOWED_TOOLS).toContain('bash');
  });

  it('[UNIT] ALLOWED_TOOLS 包含 psql', () => {
    expect(ALLOWED_TOOLS).toContain('psql');
  });

  it('[UNIT] ALLOWED_TOOLS 不包含 grep', () => {
    expect(ALLOWED_TOOLS).not.toContain('grep');
  });

  it('[UNIT] ALLOWED_TOOLS 不包含 ls', () => {
    expect(ALLOWED_TOOLS).not.toContain('ls');
  });

  it('[UNIT] ALLOWED_TOOLS 不包含 cat', () => {
    expect(ALLOWED_TOOLS).not.toContain('cat');
  });
});

// ─── 扫描逻辑 ────────────────────────────────────────────────────────────────

describe('check-manual-cmd-whitelist.cjs — scanManualCmdViolations()', () => {
  it('[BEHAVIOR] 对 manual:grep 返回 violations 非空', () => {
    const content = `
- [ ] [BEHAVIOR] 文件包含关键字
  Test: manual:grep -c "pattern" file.txt
`;
    const violations = scanManualCmdViolations(content);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].tool).toBe('grep');
  });

  it('[BEHAVIOR] 对 manual:node 返回 violations 为空', () => {
    const content = `
- [ ] [ARTIFACT] 文件存在
  Test: manual:node -e "require('fs').accessSync('file')"
`;
    const violations = scanManualCmdViolations(content);
    expect(violations.length).toBe(0);
  });

  it('[BEHAVIOR] 对 manual:npm 返回 violations 为空', () => {
    const content = `
- [ ] [GATE] 测试通过
  Test: manual:npm test
`;
    const violations = scanManualCmdViolations(content);
    expect(violations.length).toBe(0);
  });

  it('[BEHAVIOR] 对 manual:bash 返回 violations 为空', () => {
    const content = `
- [ ] [BEHAVIOR] 行为正确
  Test: manual:bash -c 'R=$(node script.js);[[ "$R" == "ok" ]]'
`;
    const violations = scanManualCmdViolations(content);
    expect(violations.length).toBe(0);
  });

  it('[BEHAVIOR] 对 manual:curl 返回 violations 为空', () => {
    const content = `
- [ ] [BEHAVIOR] API 响应正确
  Test: manual:curl -s localhost:5221/api/health
`;
    const violations = scanManualCmdViolations(content);
    expect(violations.length).toBe(0);
  });

  it('[BEHAVIOR] 对 manual:ls 返回 violations 非空', () => {
    const content = `
- [ ] [ARTIFACT] 目录存在
  Test: manual:ls packages/engine/scripts/
`;
    const violations = scanManualCmdViolations(content);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].tool).toBe('ls');
  });

  it('[BEHAVIOR] 对 manual:cat 返回 violations 非空', () => {
    const content = `
- [ ] [ARTIFACT] 文件内容
  Test: manual:cat packages/engine/hooks/verify-step.sh
`;
    const violations = scanManualCmdViolations(content);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].tool).toBe('cat');
  });

  it('[BEHAVIOR] 对 manual:find 返回 violations 非空', () => {
    const content = `
- [ ] [ARTIFACT] 文件可找到
  Test: manual:find . -name "*.sh"
`;
    const violations = scanManualCmdViolations(content);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].tool).toBe('find');
  });

  it('[BEHAVIOR] 多条混合命令，只报非白名单条目', () => {
    const content = `
- [ ] [ARTIFACT] 脚本存在
  Test: manual:node -e "require('fs').accessSync('file')"

- [ ] [BEHAVIOR] 包含关键字
  Test: manual:grep -c "pattern" file.txt

- [ ] [GATE] 测试通过
  Test: manual:npm test
`;
    const violations = scanManualCmdViolations(content);
    expect(violations.length).toBe(1);
    expect(violations[0].tool).toBe('grep');
  });

  it('[BEHAVIOR] 空内容返回 violations 为空', () => {
    const violations = scanManualCmdViolations('');
    expect(violations.length).toBe(0);
  });

  it('[BEHAVIOR] 没有 Test: 行返回 violations 为空', () => {
    const content = `
- [ ] [ARTIFACT] 某条件
  Description: 没有 Test 字段的条目
`;
    const violations = scanManualCmdViolations(content);
    expect(violations.length).toBe(0);
  });

  it('[BEHAVIOR] violations 记录正确的行号', () => {
    const content = `line1
line2
- [ ] [BEHAVIOR] 测试
  Test: manual:grep pattern file.txt
line5`;
    const violations = scanManualCmdViolations(content);
    expect(violations.length).toBe(1);
    expect(violations[0].lineNum).toBe(4);
  });

  it('[BEHAVIOR] manual:psql 返回 violations 为空', () => {
    const content = `
- [ ] [BEHAVIOR] 数据库查询
  Test: manual:psql -c "SELECT 1"
`;
    const violations = scanManualCmdViolations(content);
    expect(violations.length).toBe(0);
  });
});
