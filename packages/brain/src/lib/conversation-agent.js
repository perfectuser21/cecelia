/**
 * conversation-agent.js — PR2/4 主理人对话回路：claude spawn/resume 实际调用层
 *
 * ⚠️ Claude 无头通道已退役（任务 76a160b3，决策 067867c8）：invokeAgent 不再 spawn claude，
 * 一律抛 claude_channel_retired；路由层按既有 catch 返回 500 + 错误信息。输出解析函数保留。
 *
 * Task 264b8c8d-aad6-4f1c-84d1-274880beb3da PR2：在 PR1（conversations 表 + API 骨架）
 * 之上接入真实 headless claude 调用。
 *
 * 首条消息（sessionId 为空）：spawn 新会话，prompt 内嵌 journey_id/gp_id 锚点 +
 * 只读工具约束 + 协议标记要求（decision d33bb636 / task 264b8c8d 设计⑧a）。
 * 续接消息（sessionId 已存在）：`--resume <sessionId>`，只传用户原始内容——
 * 锚点与协议要求已在首轮 system 上下文里，不重复注入。
 */

import { ClaudeChannelRetiredError } from './claude-channel.js';

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

/**
 * 原：调用 headless claude（首条 spawn 新会话，续接 --resume）。
 * 通道已退役：直接抛 ClaudeChannelRetiredError，不启动任何进程。
 */
export function invokeAgent() {
  throw new ClaudeChannelRetiredError('conversation-agent');
}
