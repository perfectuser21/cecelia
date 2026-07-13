/**
 * 回归测试：fire-learnings-event.sh 游标机制
 *
 * 根因：extract_next_steps() 全文扫描 LEARNINGS.md 里所有 ### 下次预防 节，
 * 无游标导致同一分支多次触发时历史条目重复 POST。
 * 修复后：仅提取本次 commit 新增的 ### 下次预防 条目（git diff 游标）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolve } from 'path';

const SCRIPT_PATH = resolve(__dirname, '../../skills/dev/scripts/fire-learnings-event.sh');

function setupGitRepo(dir: string) {
  execSync('git init', { cwd: dir });
  execSync('git config user.email "test@example.com"', { cwd: dir });
  execSync('git config user.name "Test User"', { cwd: dir });
}

function gitAddCommit(dir: string, msg: string) {
  execSync('git add -A', { cwd: dir });
  execSync(`git commit -m "${msg}"`, { cwd: dir });
}

function runDryRun(dir: string, learningsFile: string): string {
  return execSync(
    `bash "${SCRIPT_PATH}" --branch test-branch --dry-run`,
    {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, LEARNINGS_FILE: learningsFile },
    }
  );
}

function extractPayload(output: string): { next_steps_suggested: string[] } {
  const match = output.match(/=== DRY RUN payload ===\n([\s\S]+?)\n========================/);
  if (!match) throw new Error(`无法从输出解析 payload：\n${output}`);
  return JSON.parse(match[1]);
}

describe('fire-learnings-event.sh — 游标机制（防重复发送）', () => {
  let testDir: string;
  let learningsFile: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'fire-learnings-test-'));
    mkdirSync(join(testDir, 'docs'), { recursive: true });
    learningsFile = join(testDir, 'docs', 'LEARNINGS.md');
    setupGitRepo(testDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('第二次触发不重复发送第一次 commit 已有的 ### 下次预防 条目', () => {
    // Commit 1：写入历史小节
    writeFileSync(
      learningsFile,
      [
        '## T1 任务学习',
        '',
        '### 下次预防',
        '- 历史条目A',
        '- 历史条目B',
        '',
      ].join('\n')
    );
    gitAddCommit(testDir, 'feat: T1 完成');

    // Commit 2：追加新小节
    writeFileSync(
      learningsFile,
      [
        '## T1 任务学习',
        '',
        '### 下次预防',
        '- 历史条目A',
        '- 历史条目B',
        '',
        '## T2 任务学习',
        '',
        '### 下次预防',
        '- 新条目X',
        '- 新条目Y',
        '',
      ].join('\n')
    );
    gitAddCommit(testDir, 'feat: T2 完成');

    // 第二次触发：只应发送 Commit 2 新增的条目
    const output = runDryRun(testDir, learningsFile);
    const payload = extractPayload(output);

    expect(payload.next_steps_suggested).toContain('新条目X');
    expect(payload.next_steps_suggested).toContain('新条目Y');
    expect(payload.next_steps_suggested).not.toContain('历史条目A');
    expect(payload.next_steps_suggested).not.toContain('历史条目B');
  });

  it('多个历史小节+新小节：只发送新小节条目', () => {
    // Commit 1：多个历史小节
    writeFileSync(
      learningsFile,
      [
        '## T1',
        '### 下次预防',
        '- 老条目1',
        '',
        '## T2',
        '### 下次预防',
        '- 老条目2',
        '- 老条目3',
        '',
      ].join('\n')
    );
    gitAddCommit(testDir, 'feat: T1+T2');

    // Commit 2：再追加一节
    writeFileSync(
      learningsFile,
      [
        '## T1',
        '### 下次预防',
        '- 老条目1',
        '',
        '## T2',
        '### 下次预防',
        '- 老条目2',
        '- 老条目3',
        '',
        '## T3',
        '### 下次预防',
        '- 最新条目',
        '',
      ].join('\n')
    );
    gitAddCommit(testDir, 'feat: T3');

    const output = runDryRun(testDir, learningsFile);
    const payload = extractPayload(output);

    expect(payload.next_steps_suggested).toContain('最新条目');
    expect(payload.next_steps_suggested).not.toContain('老条目1');
    expect(payload.next_steps_suggested).not.toContain('老条目2');
    expect(payload.next_steps_suggested).not.toContain('老条目3');
  });

  it('LEARNINGS 文件无变化时输出为空数组', () => {
    // 一次 commit 写入内容
    writeFileSync(learningsFile, '## T1\n### 下次预防\n- 条目\n');
    gitAddCommit(testDir, 'feat: T1');

    // 再次 commit 但不改 LEARNINGS 文件
    writeFileSync(join(testDir, 'other.txt'), 'change');
    gitAddCommit(testDir, 'chore: 其他文件变更');

    // 运行脚本（因为 LEARNINGS 无变化，步骤数=0 会直接 exit 0）
    const output = execSync(
      `bash "${SCRIPT_PATH}" --branch test-branch --dry-run`,
      {
        cwd: testDir,
        encoding: 'utf8',
        env: { ...process.env, LEARNINGS_FILE: learningsFile },
      }
    );

    // 无条目时脚本会打印"无内容，跳过发送"而不会输出 DRY RUN payload
    expect(output).toContain('无内容');
  });

  it('首次 commit（无 HEAD~1）应正常提取当前文件内容', () => {
    writeFileSync(
      learningsFile,
      '## T1\n### 下次预防\n- 首次条目\n'
    );
    gitAddCommit(testDir, 'feat: 初始');

    const output = runDryRun(testDir, learningsFile);
    const payload = extractPayload(output);

    expect(payload.next_steps_suggested).toContain('首次条目');
  });
});
