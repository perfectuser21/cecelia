/**
 * conversation-agent-lock.test.ts
 * Contract Test — PR4/4 D2 .conversation-mode 锁文件机制
 *
 * [BEHAVIOR] B-08: conversation-agent.js spawn 路径写入 .conversation-mode，
 *                   resolve/archive 路径删除该文件
 *
 * ⚠️  TDD Red — 当前 packages/brain/src/lib/conversation-agent.js 无
 *   .conversation-mode 写/删逻辑，此测试在 D2 实现前故意 FAIL。
 *   D2 由 generator 在当前 sprint 实现后，此测试应转为 Green。
 *
 * 接缝：conversation-agent.js ↔ 文件系统（.conversation-mode 锁文件）
 * 禁 mock 边：文件系统操作必须真实写/删/检查，不得 mock fs
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// 动态导入 conversation-agent.js，避免因路径问题导致 import 失败时阻塞其他测试
const AGENT_PATH = '/workspace/packages/brain/src/lib/conversation-agent.js';

describe('conversation-agent.js — .conversation-mode 锁文件机制（B-08，TDD Red）', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'conv-agent-lock-'));
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('[B-08a] spawn 路径：.conversation-mode 文件在 conversation 目录下被创建（TDD Red）', async () => {
    // 此测试预期在 D2 实现后通过
    // 当前 conversation-agent.js 无此逻辑，故意 FAIL
    let agent: Record<string, unknown>;
    try {
      agent = await import(AGENT_PATH) as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        `[TDD Red] conversation-agent.js 导入失败（D2 未实现或路径变更）: ${err}`
      );
    }

    // conversation-agent.js 应导出 spawnConversationAgent 或 createConversation 函数
    const spawnFn =
      (agent.spawnConversationAgent ?? agent.createConversation ?? agent.startConversation) as
        | ((opts: { conversationId: string; workDir: string }) => Promise<unknown>)
        | undefined;

    if (!spawnFn) {
      throw new Error(
        '[TDD Red] conversation-agent.js 未导出 spawnConversationAgent / createConversation / startConversation（D2 待实现）'
      );
    }

    // 调用 spawn，期望在 tmpDir 下创建 .conversation-mode
    try {
      await spawnFn({ conversationId: 'test-conv-id-001', workDir: tmpDir });
    } catch {
      // spawn 内部可能因无真实 claude 而报错，但文件写入应在报错前完成
    }

    const lockFile = join(tmpDir, '.conversation-mode');
    expect(
      existsSync(lockFile),
      `[TDD Red] spawn 后 .conversation-mode 应存在于 ${tmpDir}，但未找到（D2 未实现写入逻辑）`
    ).toBe(true);
  });

  it('[B-08b] resolve/archive 路径：.conversation-mode 文件被删除（TDD Red）', async () => {
    // 预先写入 .conversation-mode，模拟 spawn 后的状态
    const lockFile = join(tmpDir, '.conversation-mode');
    writeFileSync(lockFile, 'test-conv-id-001\n', 'utf-8');
    expect(existsSync(lockFile)).toBe(true);

    let agent: Record<string, unknown>;
    try {
      agent = await import(AGENT_PATH) as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        `[TDD Red] conversation-agent.js 导入失败（D2 未实现或路径变更）: ${err}`
      );
    }

    // conversation-agent.js 应导出 resolveConversation 或 archiveConversation 函数
    const resolveFn =
      (agent.resolveConversation ?? agent.archiveConversation ?? agent.endConversation) as
        | ((opts: { conversationId: string; workDir: string }) => Promise<unknown>)
        | undefined;

    if (!resolveFn) {
      throw new Error(
        '[TDD Red] conversation-agent.js 未导出 resolveConversation / archiveConversation / endConversation（D2 待实现）'
      );
    }

    try {
      await resolveFn({ conversationId: 'test-conv-id-001', workDir: tmpDir });
    } catch {
      // 内部错误不影响文件删除验证
    }

    expect(
      existsSync(lockFile),
      `[TDD Red] resolve/archive 后 .conversation-mode 应被删除，但仍存在于 ${tmpDir}（D2 未实现删除逻辑）`
    ).toBe(false);
  });

  it('[B-08c] spawn 时 .conversation-mode 内含 conversation_id（TDD Red）', async () => {
    let agent: Record<string, unknown>;
    try {
      agent = await import(AGENT_PATH) as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        `[TDD Red] conversation-agent.js 导入失败: ${err}`
      );
    }

    const spawnFn =
      (agent.spawnConversationAgent ?? agent.createConversation ?? agent.startConversation) as
        | ((opts: { conversationId: string; workDir: string }) => Promise<unknown>)
        | undefined;

    if (!spawnFn) {
      throw new Error('[TDD Red] spawn 函数未导出（D2 待实现）');
    }

    const testConvId = 'test-conv-id-lock-content-check';
    try {
      await spawnFn({ conversationId: testConvId, workDir: tmpDir });
    } catch { /* ignore */ }

    const lockFile = join(tmpDir, '.conversation-mode');
    if (!existsSync(lockFile)) {
      throw new Error('[TDD Red] .conversation-mode 未创建（D2 未实现）');
    }

    const { readFileSync } = await import('node:fs');
    const content = readFileSync(lockFile, 'utf-8').trim();
    expect(
      content,
      `[TDD Red] .conversation-mode 内容应含 conversation_id（${testConvId}），实际内容：${content}`
    ).toContain(testConvId);
  });
});
