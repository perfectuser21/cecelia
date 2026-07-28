/**
 * stop-conversation-hook.test.ts
 * Contract Test — PR4/4 Stop Hook 硬闸
 *
 * [BEHAVIOR] B-01: decision_saved fake UUID → exit 2（Brain DB miss）
 * [BEHAVIOR] B-02: pending_user 标记 → exit 2 + stdout 含阻断提示（D3 新增）
 * [BEHAVIOR] B-06: stop.sh 含 .conversation-mode 路由分支
 * [BEHAVIOR] B-07: 无 .conversation-mode 时 exit 0（不阻断普通会话）
 *
 * 注意：B-02 依赖 D3 实现，实现前测试将 FAIL（TDD Red 阶段）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const HOOK_PATH = '/workspace/packages/engine/hooks/stop-conversation.sh';
const STOP_SH_PATH = '/workspace/packages/engine/hooks/stop.sh';

/** 构造临时目录，包含 transcript JSONL 文件，可选创建 .conversation-mode */
function setupTempDir(opts: {
  transcriptLines: string[];
  withConversationMode?: boolean;
}): string {
  const dir = mkdtempSync(join(tmpdir(), 'pr4-test-'));
  const transcript = join(dir, 'transcript.jsonl');
  writeFileSync(transcript, opts.transcriptLines.join('\n') + '\n', 'utf-8');
  if (opts.withConversationMode) {
    writeFileSync(join(dir, '.conversation-mode'), 'test-conversation-id\n', 'utf-8');
  }
  return dir;
}

/** 运行 stop-conversation.sh，返回 { exitCode, stdout, stderr } */
function runHook(dir: string): { exitCode: number; stdout: string; stderr: string } {
  const transcript = join(dir, 'transcript.jsonl');
  const result = spawnSync(
    'bash',
    ['-c', `cd '${dir}' && bash '${HOOK_PATH}'`],
    {
      encoding: 'utf-8',
      env: {
        ...process.env,
        CLAUDE_HOOK_TRANSCRIPT_PATH: transcript,
      },
      timeout: 15_000,
    }
  );
  return {
    exitCode: result.status ?? -1,
    stdout: (result.stdout || '') + (result.stderr || ''),
    stderr: result.stderr || '',
  };
}

describe('stop-conversation.sh — PR4/4 合同测试', () => {
  let tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    tmpDirs = [];
  });

  function makeDir(opts: Parameters<typeof setupTempDir>[0]): string {
    const dir = setupTempDir(opts);
    tmpDirs.push(dir);
    return dir;
  }

  it('[B-01] decision_saved fake UUID + .conversation-mode → exit 2（Brain DB miss）', () => {
    const dir = makeDir({
      transcriptLines: [
        '{"role":"assistant","content":"已分析，[TURN: decision_saved=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee]"}',
      ],
      withConversationMode: true,
    });
    const { exitCode } = runHook(dir);
    // Brain 本地不可达时 curl 返回 000，视为未落库 → exit 2
    // Brain 可达时 fake uuid 不存在 → 404 → exit 2
    // 两种情况都应 exit 2（合同要求：宁可误 block 不放行未落库决策）
    expect(exitCode).toBe(2);
  });

  it('[B-02] pending_user 标记 + .conversation-mode → exit 2（D3 新增 block，TDD Red）', () => {
    const dir = makeDir({
      transcriptLines: [
        '{"role":"assistant","content":"请确认方案，[TURN: pending_user]"}',
      ],
      withConversationMode: true,
    });
    const { exitCode, stdout } = runHook(dir);
    // D3 实现前：当前代码无 pending_user block，exit 0（放行）
    // D3 实现后：exit 2 + stdout 含 "等待用户确认" 或 "pending_user"
    // 此测试在 D3 实现前故意 FAIL（TDD Red）
    expect(exitCode).toBe(2); // D3 实现前此断言 FAIL
    const combinedOutput = stdout;
    expect(combinedOutput).toMatch(/等待用户确认|pending_user/);
  });

  it('[B-07] 无 .conversation-mode 文件时 → exit 0（不阻断普通会话）', () => {
    const dir = makeDir({
      transcriptLines: [
        '{"role":"assistant","content":"普通回复，[TURN: pending_user]"}',
      ],
      withConversationMode: false, // 无锁文件
    });
    const { exitCode } = runHook(dir);
    expect(exitCode).toBe(0);
  });

  it('[B-06] stop.sh 含 .conversation-mode 路由分支', () => {
    const stopSh = execSync(`cat '${STOP_SH_PATH}'`, { encoding: 'utf-8' });
    expect(stopSh).toMatch(/\.conversation-mode/);
    expect(stopSh).toMatch(/stop-conversation\.sh/);
  });

  it('[B-07b] transcript 文件不存在时 exit 0（已有兜底逻辑）', () => {
    const dir = makeDir({
      transcriptLines: [],
      withConversationMode: true,
    });
    // 删除 transcript 文件，让 CLAUDE_HOOK_TRANSCRIPT_PATH 指向不存在的路径
    const nonexistent = join(dir, 'nonexistent.jsonl');
    const result = spawnSync(
      'bash',
      ['-c', `cd '${dir}' && bash '${HOOK_PATH}'`],
      {
        encoding: 'utf-8',
        env: {
          ...process.env,
          CLAUDE_HOOK_TRANSCRIPT_PATH: nonexistent,
        },
        timeout: 15_000,
      }
    );
    expect(result.status ?? -1).toBe(0);
  });
});
