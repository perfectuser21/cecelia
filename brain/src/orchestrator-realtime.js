/**
 * Orchestrator Realtime - OpenAI Realtime API 后端代理
 *
 * 提供 3 个端点：
 * 1. GET  /realtime/config — 返回 OpenAI Realtime 配置
 * 2. POST /realtime/tool   — 处理语音会话中的工具调用
 * 3. WS   /realtime/ws     — WebSocket 代理，前端 ↔ OpenAI Realtime API
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import WebSocket from 'ws';
import pool from './db.js';

// OpenAI Realtime API 配置
const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime';
const OPENAI_REALTIME_MODEL = 'gpt-4o-realtime-preview-2024-12-17';

// 加载 OpenAI API Key
let _openaiApiKey = null;

function getOpenaiApiKey() {
  if (_openaiApiKey) return _openaiApiKey;
  try {
    const envPath = join(homedir(), '.credentials', 'openai.env');
    const content = readFileSync(envPath, 'utf-8');
    const match = content.match(/OPENAI_API_KEY=(.+)/);
    if (match) {
      _openaiApiKey = match[1].trim();
      return _openaiApiKey;
    }
  } catch { /* try next */ }

  try {
    const jsonPath = join(homedir(), '.credentials', 'openai.json');
    const cred = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    _openaiApiKey = cred.api_key;
    return _openaiApiKey;
  } catch (err) {
    console.error('[orchestrator-realtime] Failed to load OpenAI credentials:', err.message);
    return null;
  }
}

// Cecelia 语音对话系统提示词
const REALTIME_INSTRUCTIONS = `你是 Cecelia，一位专业的 AI 管家。你正在通过语音与用户实时对话。

你的能力：
1. 回答关于当前系统状态、任务进展的问题
2. 帮助用户理解 OKR、项目、任务的关系
3. 接收指令并转发给大脑执行（通过工具调用）
4. 提供建议和决策支持

你的回复风格：
- 简洁自然，适合语音对话
- 用中文回复
- 语速适中，不要太啰嗦
- 遇到需要执行的操作，使用工具调用`;

// 工具定义（Realtime 会话中可调用的功能）
const REALTIME_TOOLS = [
  {
    type: 'function',
    name: 'query_system_status',
    description: '查询 Cecelia 系统状态（任务数量、目标进度等）',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'query_tasks',
    description: '查询任务列表',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: '筛选状态：queued, in_progress, completed, failed' },
        limit: { type: 'number', description: '返回数量限制，默认 5' },
      },
    },
  },
  {
    type: 'function',
    name: 'navigate_to_page',
    description: '导航到指定页面',
    parameters: {
      type: 'object',
      properties: {
        page: { type: 'string', description: '页面名称：okr, projects, tasks, brain, orchestrator, planner' },
      },
      required: ['page'],
    },
  },
];

/**
 * GET /realtime/config — 返回 Realtime API 配置
 * @returns {Object} { success, config? | error? }
 */
export function getRealtimeConfig() {
  const apiKey = getOpenaiApiKey();
  if (!apiKey) {
    return { success: false, error: 'OpenAI API key not configured' };
  }

  return {
    success: true,
    config: {
      url: `${OPENAI_REALTIME_URL}?model=${OPENAI_REALTIME_MODEL}`,
      api_key: apiKey,
      model: OPENAI_REALTIME_MODEL,
      voice: 'sage',
      instructions: REALTIME_INSTRUCTIONS,
      tools: REALTIME_TOOLS,
    },
  };
}

/**
 * POST /realtime/tool — 处理工具调用
 * @param {string} toolName - 工具名称
 * @param {Object} args - 工具参数
 * @param {Object} dbPool - 数据库连接池（可选，默认使用 import 的 pool）
 * @returns {Promise<Object>} { success, result? | error? }
 */
export async function handleRealtimeTool(toolName, args = {}, dbPool = pool) {
  try {
    switch (toolName) {
      case 'query_system_status': {
        const [tasks, goals] = await Promise.all([
          dbPool.query('SELECT status, count(*)::int as cnt FROM tasks GROUP BY status'),
          dbPool.query('SELECT status, count(*)::int as cnt FROM goals GROUP BY status'),
        ]);
        return {
          success: true,
          result: {
            tasks: tasks.rows.reduce((acc, r) => { acc[r.status] = r.cnt; return acc; }, {}),
            goals: goals.rows.reduce((acc, r) => { acc[r.status] = r.cnt; return acc; }, {}),
          },
        };
      }

      case 'query_tasks': {
        let sql = 'SELECT id, title, status, priority, updated_at FROM tasks';
        const params = [];
        if (args.status) {
          sql += ' WHERE status = $1';
          params.push(args.status);
        }
        sql += ` ORDER BY updated_at DESC LIMIT $${params.length + 1}`;
        params.push(args.limit || 5);

        const result = await dbPool.query(sql, params);
        return { success: true, result: { tasks: result.rows } };
      }

      case 'navigate_to_page': {
        return { success: true, result: { navigated_to: args.page } };
      }

      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    console.error(`[orchestrator-realtime] Tool ${toolName} failed:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * WebSocket 代理：前端 ↔ OpenAI Realtime API
 * @param {WebSocket} clientWs - 前端 WebSocket 连接
 * @param {import('http').IncomingMessage} _req - HTTP 请求
 */
export function handleRealtimeWebSocket(clientWs, _req) {
  const apiKey = getOpenaiApiKey();
  if (!apiKey) {
    clientWs.close(1008, 'OpenAI API key not configured');
    return;
  }

  const openaiUrl = `${OPENAI_REALTIME_URL}?model=${OPENAI_REALTIME_MODEL}`;

  console.log('[orchestrator-realtime] Opening proxy to OpenAI Realtime...');

  const openaiWs = new WebSocket(openaiUrl, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'OpenAI-Beta': 'realtime=v1',
    },
  });

  let openaiReady = false;
  const pendingMessages = [];

  openaiWs.on('open', () => {
    console.log('[orchestrator-realtime] Connected to OpenAI Realtime API');
    openaiReady = true;

    for (const msg of pendingMessages) {
      openaiWs.send(msg);
    }
    pendingMessages.length = 0;
  });

  // 前端 → OpenAI
  clientWs.on('message', (data) => {
    const message = data.toString();
    if (openaiReady && openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.send(message);
    } else {
      pendingMessages.push(message);
    }
  });

  // OpenAI → 前端
  openaiWs.on('message', (data) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data.toString());
    }
  });

  // 错误处理
  openaiWs.on('error', (err) => {
    console.error('[orchestrator-realtime] OpenAI WS error:', err.message);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({
        type: 'error',
        error: { message: 'OpenAI connection error', code: 'proxy_error' },
      }));
    }
  });

  clientWs.on('error', (err) => {
    console.error('[orchestrator-realtime] Client WS error:', err.message);
  });

  // 关闭处理
  openaiWs.on('close', (code, reason) => {
    console.log(`[orchestrator-realtime] OpenAI WS closed: ${code} ${reason}`);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(code, reason.toString());
    }
  });

  clientWs.on('close', (code, reason) => {
    console.log(`[orchestrator-realtime] Client WS closed: ${code} ${reason}`);
    if (openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.close();
    }
  });

  // 记录会话事件（fire-and-forget）
  pool.query(
    'INSERT INTO cecelia_events (event_type, source, payload, created_at) VALUES ($1, $2, $3, NOW())',
    ['realtime_session', 'orchestrator_realtime', JSON.stringify({
      action: 'connected',
      model: OPENAI_REALTIME_MODEL,
      timestamp: new Date().toISOString(),
    })]
  ).catch(() => {});
}

// 导出用于测试
export {
  getOpenaiApiKey as _getOpenaiApiKey,
  REALTIME_INSTRUCTIONS,
  REALTIME_TOOLS,
  OPENAI_REALTIME_URL,
  OPENAI_REALTIME_MODEL,
};

export function _resetApiKey() {
  _openaiApiKey = null;
}
