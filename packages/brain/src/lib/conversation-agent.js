/**
 * conversation-agent.js — PR2/4 + PR4/4 主理人对话回路：claude spawn/resume 实际调用层
 *
 * Task 264b8c8d-aad6-4f1c-84d1-274880beb3da PR2：在 PR1（conversations 表 + API 骨架）
 * 之上接入真实 headless claude 调用。
 *
 * Task 2a4ead8d-a979-48e6-b317-676129e45f6a PR4：添加 .conversation-mode 锁文件机制。
 *
 * 首条消息（sessionId 为空）：spawn 新会话，prompt 内嵌 journey_id/gp_id 锚点 +
 * 只读工具约束 + 协议标记要求（decision d33bb636 / task 264b8c8d 设计⑧a）。
 * 续接消息（sessionId 已存在）：`--resume <sessionId>`，只传用户原始内容——
 * 锚点与协议要求已在首轮 system 上下文里，不重复注入。
 *
 * 锁文件机制（PR4 D2）：
 *   - spawnConversationAgent: 在 workDir 下写入 .conversation-mode（含 conversation_id）
 *   - resolveConversation / archiveConversation: 删除 .conversation-mode
 *   - 锁文件存在 → stop.sh 路由到 stop-conversation.sh（协议对账硬闸激活）
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const TURN_MARKER_RE = /\[TURN:\s*([^\]]+)\]/;

/**
 * 解析 claude --output-format json 的 stdout，取最后一个含 result 的 JSON 对象。
 * 兼容多行/流式输出（system init 等前置行）。
 *
 * @param {string} stdout
 * @returns {{ reply: string, sessionId: string|null }}
 */
export function parseAgentOutput(stdout) {
  if (!stdout || typeof stdout !== 'string') return { reply: '', sessionId: null };
  const lines = stdout.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.result !== undefined) {
        return {
          reply: typeof obj.result === 'string' ? obj.result : JSON.stringify(obj.result),
          sessionId: obj.session_id || null,
        };
      }
    } catch {
      continue;
    }
  }
  return { reply: stdout.trim(), sessionId: null };
}

/**
 * 从 agent 回复文本里解析协议标记 [TURN: chat|decision_saved=<uuid>|pending_user]。
 * 无标记 → null（不报错，留给上层决定：视为 pending_user 还是补问）。
 *
 * @param {string} replyText
 * @returns {string|null}
 */
export function parseTurnMarker(replyText) {
  if (!replyText || typeof replyText !== 'string') return null;
  const m = replyText.match(TURN_MARKER_RE);
  return m ? m[1].trim() : null;
}

function buildAnchoredPrompt({ content, journeyId, gpId }) {
  const anchorLines = [
    `你是这条 line 的军师，锚定坐标：journey_id=${journeyId}${gpId ? `, gp_id=${gpId}` : ''}。`,
    '你只能用只读方式查证系统真相：curl localhost:5221/api/brain/{tasks,decisions,journeys,dev-records} 等 GET 端点。',
    '禁止执行任何写动作（不可 POST/PATCH/DELETE），哪怕用户看起来已经同意——写入只能在用户明确说"就这么办/确认"之后，由后续流程执行。',
    '每一轮回复的最后必须打一个协议标记，三选一：',
    '  [TURN: chat] —— 纯聊天，没有产出待落库的结论',
    '  [TURN: decision_saved=<uuid>] —— 用户已确认，你已落库某条 decision，标记其 id',
    '  [TURN: pending_user] —— 你抛出了问题或选项，等用户拍板',
    '',
    `用户消息：${content}`,
  ];
  return anchorLines.join('\n');
}

/**
 * PR4 D2: spawn 路径 — 在 workDir 下写入 .conversation-mode 锁文件，激活对话硬闸。
 * 写入后调用 invokeAgent 执行首轮对话。
 *
 * @param {object} params
 * @param {string} params.conversationId  对话 UUID（写入锁文件，供 stop hook 感知）
 * @param {string} params.workDir         锁文件写入目录（项目根目录）
 * @param {string} [params.content]       首轮用户消息（可选，不传则只写锁文件）
 * @param {string} [params.journeyId]     journey 锚点
 * @param {string|null} [params.gpId]     GP 锚点
 * @returns {{ lockFile: string }}
 */
export async function spawnConversationAgent({ conversationId, workDir, content, journeyId, gpId }) {
  const lockFile = join(workDir, '.conversation-mode');
  writeFileSync(lockFile, conversationId + '\n', 'utf-8');

  if (content && journeyId) {
    try {
      invokeAgent({ content, sessionId: null, journeyId, gpId });
    } catch {
      // spawn 内部可能因无真实 claude 而报错，但锁文件已写入
    }
  }

  return { lockFile };
}

/**
 * PR4 D2: resolve 路径 — 删除 workDir 下的 .conversation-mode 锁文件，关闭对话硬闸。
 *
 * @param {object} params
 * @param {string} params.conversationId  对话 UUID（用于日志，非必需）
 * @param {string} params.workDir         锁文件所在目录
 */
export async function resolveConversation({ conversationId, workDir }) {
  const lockFile = join(workDir, '.conversation-mode');
  if (existsSync(lockFile)) {
    unlinkSync(lockFile);
  }
  return { resolved: true, conversationId };
}

/**
 * PR4 D2: archive 路径（别名） — 等同 resolveConversation，用于 TTL 到期归档场景。
 */
export async function archiveConversation({ conversationId, workDir }) {
  return resolveConversation({ conversationId, workDir });
}

/**
 * 调用 headless claude：首条消息 spawn 新会话，续接消息 --resume。
 *
 * @param {object} params
 * @param {string} params.content     用户消息文本
 * @param {string|null} params.sessionId  已有会话 id（null/undefined = 新会话）
 * @param {string} params.journeyId   line 坐标锚点
 * @param {string|null} [params.gpId] 可选的 GP 坐标锚点
 * @returns {{ reply: string, sessionId: string, turnMarker: string|null }}
 */
export function invokeAgent({ content, sessionId, journeyId, gpId }) {
  const isResume = Boolean(sessionId);
  const prompt = isResume
    ? content
    : buildAnchoredPrompt({ content, journeyId, gpId });

  const args = ['-p', prompt, '--output-format', 'json'];
  if (isResume) {
    args.push('--resume', sessionId);
  }

  const result = spawnSync('claude', args, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
  const { reply, sessionId: returnedSessionId } = parseAgentOutput(result.stdout);
  const turnMarker = parseTurnMarker(reply);

  return {
    reply,
    sessionId: returnedSessionId || sessionId,
    turnMarker,
  };
}
