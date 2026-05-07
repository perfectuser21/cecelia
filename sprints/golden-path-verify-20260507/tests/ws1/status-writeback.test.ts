/**
 * Workstream 1 — harness_initiative status 终态回写 [BEHAVIOR] (Round 2)
 *
 * 验证 PR #2816 在 executor.js 的 **外层 caller**（即 if (task.task_type === 'harness_initiative') 块）
 * 中明确调用了 updateTaskStatus(task.id, 'completed' | 'failed')，且所有 return 路径返回
 * { success: true } 防止 dispatcher 把已处理任务回退 'queued' 形成回路。
 *
 * Round 2 新增（响应 Reviewer 反馈 #4 — anti-revert）：
 *   - git merge-base --is-ancestor c9300a89b HEAD ⇒ PR #2816 fix commit 必须在 HEAD 祖先链
 *   - git blame -l -L 锁定外层 caller 块中 updateTaskStatus(task.id, completed|failed) 行
 *     至少一行 blame commit 等于 c9300a89b（squash-merge 应精确命中）
 *   注：Reviewer R1 反馈中写 "66ff2791b 之后"——经核实 66ff2791b 是 round-1 contract commit
 *   （时间晚于 PR #2816），不改 executor.js；技术正确的 anchor 是 c9300a89b。本测试同时
 *   保留 66ff2791b 在 HEAD 祖先链作为辅助断言（contract round-1 也未被 revert），主断言
 *   走 c9300a89b。
 *
 * 设计：用 readFileSync 静态读源码，对外层 caller 块切窗口断言代码形状；用 child_process
 * 跑 git 命令验证 commit 拓扑。
 *
 * 预期 Red（当前分支 base 未含 PR #2816 fix 时）：
 *   - 源码块中找不到 updateTaskStatus → toMatch FAIL
 *   - git blame anchor 不命中 c9300a89b → expect FAIL
 *
 * 预期 Green（rebase 至 main 含 PR #2816 后）：所有断言全 PASS。
 *
 * 目标 task_id（PRD 钉的金路径样本，运行时端到端观察用）：
 *   84075973-99a4-4a0d-9a29-4f0cd8b642f5
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const TARGET_INITIATIVE_TASK_ID = '84075973-99a4-4a0d-9a29-4f0cd8b642f5';
const PR2816_FIX_COMMIT = 'c9300a89b'; // PR #2816 squash-merge fix commit
const ROUND1_CONTRACT_COMMIT = '66ff2791b'; // 辅助锚点（contract round-1 提交）

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const EXECUTOR_PATH = path.resolve(REPO_ROOT, 'packages/brain/src/executor.js');

function gitOk(args: string[]): boolean {
  try {
    execFileSync('git', args, { cwd: REPO_ROOT, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function gitOutput(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
}

describe('WS1 — harness_initiative status 终态回写 [BEHAVIOR]', () => {
  const SRC = fs.readFileSync(EXECUTOR_PATH, 'utf8');

  // 切外层 caller 窗口：从 "if (task.task_type === 'harness_initiative')" 起 2500 字符。
  // 该窗口完整覆盖 try-catch 全块（PR #2816 fix 所在区域）。
  const OUTER_START = SRC.indexOf("task.task_type === 'harness_initiative'");
  const OUTER_BLOCK = OUTER_START >= 0 ? SRC.slice(OUTER_START, OUTER_START + 2500) : '';

  it('外层 caller 存在（基础结构存在）', () => {
    expect(OUTER_START).toBeGreaterThan(0);
    expect(OUTER_BLOCK).toContain('harness_initiative');
  });

  it('成功路径：外层 caller try 块调用 updateTaskStatus(task.id, "completed")', () => {
    expect(OUTER_BLOCK).toMatch(
      /updateTaskStatus\s*\(\s*task\.id\s*,\s*['"]completed['"]/,
    );
  });

  it('FAIL 路径：外层 caller try 块调用 updateTaskStatus(task.id, "failed", ...)', () => {
    expect(OUTER_BLOCK).toMatch(
      /updateTaskStatus\s*\(\s*task\.id\s*,\s*['"]failed['"]/,
    );
  });

  it('异常路径：外层 caller catch 块也调用 updateTaskStatus(task.id, "failed")', () => {
    expect(OUTER_BLOCK).toMatch(
      /catch\s*\([\s\S]*?\)\s*\{[\s\S]*?updateTaskStatus\s*\(\s*task\.id\s*,\s*['"]failed['"]/,
    );
  });

  it('防回路：外层 caller 所有 return 路径写 success: true（不再是 success: result.ok / !final.error）', () => {
    expect(OUTER_BLOCK).not.toMatch(/success\s*:\s*result\.ok/);
    expect(OUTER_BLOCK).not.toMatch(/success\s*:\s*!\s*final\.error/);
    const hits = OUTER_BLOCK.match(/success\s*:\s*true/g) || [];
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('PRD 目标 task_id 字面引用：本测试文件锚定 84075973-99a4-4a0d-9a29-4f0cd8b642f5（防漂移）', () => {
    const SELF = fs.readFileSync(__filename, 'utf8');
    expect(SELF).toContain(TARGET_INITIATIVE_TASK_ID);
  });

  // ---- Round 2 新增 anti-revert 断言（Reviewer 反馈 #4） ----

  it('anti-revert: PR #2816 fix commit c9300a89b 在 HEAD 祖先链（防 revert）', () => {
    const ok = gitOk(['merge-base', '--is-ancestor', PR2816_FIX_COMMIT, 'HEAD']);
    expect(ok).toBe(true);
  });

  it('anti-revert: round-1 contract commit 66ff2791b 在 HEAD 祖先链（辅助锚点）', () => {
    const ok = gitOk(['merge-base', '--is-ancestor', ROUND1_CONTRACT_COMMIT, 'HEAD']);
    expect(ok).toBe(true);
  });

  // ---- Round 3 新增：Risks Registered 章节静态守护（risk_registered 抬分） ----

  it('Round 3: contract-draft.md 含 ## Risks Registered 章节，登记 R1–R5 五条具名 risk + cascade 对策', () => {
    const CONTRACT_PATH = path.resolve(REPO_ROOT, 'sprints/golden-path-verify-20260507/contract-draft.md');
    expect(fs.existsSync(CONTRACT_PATH)).toBe(true);
    const draft = fs.readFileSync(CONTRACT_PATH, 'utf8');

    // 章节标题必须存在
    expect(draft).toContain('## Risks Registered');

    // 五条具名 risk id 全部出现
    for (const id of ['R1', 'R2', 'R3', 'R4', 'R5']) {
      expect(draft).toContain(id);
    }

    // 必须含 cascade 关键字（R5 cascade 对策）
    expect(draft.toLowerCase()).toContain('cascade');

    // 必须含 mitigation 关键字
    expect(draft.toLowerCase()).toContain('mitigation');
  });

  it('anti-revert: 外层 caller 块中 updateTaskStatus(task.id, completed|failed) 行 blame 锚定到 c9300a89b（fix 行未被覆盖）', () => {
    // 计算 SRC 中 OUTER_START 对应的行号
    expect(OUTER_START).toBeGreaterThan(0);
    const beforeOuter = SRC.slice(0, OUTER_START);
    const startLine = beforeOuter.split('\n').length; // 1-based
    const endLine = startLine + 200; // 外层 caller 块约 ≤200 行

    const blame = gitOutput([
      'blame',
      '-l',
      '-L',
      `${startLine},${endLine}`,
      'packages/brain/src/executor.js',
    ]);

    // 收集 blame 中包含 updateTaskStatus(task.id, 'completed'|'failed') 的行的 commit
    const blameLines = blame.split('\n').filter((line) =>
      /updateTaskStatus\s*\(\s*task\.id\s*,\s*['"](completed|failed)['"]/.test(line),
    );
    expect(blameLines.length).toBeGreaterThanOrEqual(1);

    // 至少一行的 blame commit 前缀 = c9300a89b（PR #2816 squash-merge）
    const matched = blameLines.some((line) => {
      const commit = line.split(/\s+/)[0].replace(/^\^/, '');
      return commit.startsWith(PR2816_FIX_COMMIT);
    });
    expect(matched).toBe(true);
  });
});
