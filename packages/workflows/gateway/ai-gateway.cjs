#!/usr/bin/env node
/**
 * AI Gateway - 统一 AI 调用网关
 *
 * 根据环境变量 AI_MODE 选择后端：
 * - claude-code: 启动 Claude Code 无头模式
 * - minimax: 调用 MiniMax API
 *
 * 端口: 9876 (兼容旧配置)
 */

const http = require('http');
const { spawn } = require('child_process');
const https = require('https');

// 配置
const PORT = process.env.GATEWAY_PORT || 9876;
const AI_MODE = process.env.AI_MODE || 'claude-code';
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || '';
const MINIMAX_GROUP_ID = process.env.MINIMAX_GROUP_ID || '';

// 存储运行中的任务
const tasks = new Map();

// 生成任务 ID
function generateTaskId() {
  return `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Claude Code 执行
async function executeClaudeCode(prompt, taskId) {
  return new Promise((resolve, reject) => {
    const logFile = `/tmp/claude-${taskId}.log`;

    const proc = spawn('claude', ['-p', prompt, '--output-format', 'json'], {
      env: { ...process.env, CLAUDE_CODE_HEADLESS: 'true' },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', data => {
      stdout += data.toString();
    });

    proc.stderr.on('data', data => {
      stderr += data.toString();
    });

    proc.on('close', code => {
      tasks.set(taskId, {
        status: code === 0 ? 'completed' : 'failed',
        result: stdout,
        error: stderr,
        exitCode: code,
        completedAt: new Date().toISOString()
      });
      resolve({ taskId, status: 'completed', exitCode: code });
    });

    proc.on('error', err => {
      tasks.set(taskId, {
        status: 'failed',
        error: err.message,
        completedAt: new Date().toISOString()
      });
      reject(err);
    });

    // 初始状态
    tasks.set(taskId, {
      status: 'running',
      startedAt: new Date().toISOString(),
      pid: proc.pid
    });
  });
}

// MiniMax API 调用
async function executeMiniMax(prompt, taskId) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      model: 'abab6.5s-chat',
      messages: [
        { role: 'user', content: prompt }
      ],
      max_tokens: 4096
    });

    const options = {
      hostname: 'api.minimax.chat',
      port: 443,
      path: `/v1/text/chatcompletion_v2?GroupId=${MINIMAX_GROUP_ID}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MINIMAX_API_KEY}`,
        'Content-Length': Buffer.byteLength(data)
      }
    };

    tasks.set(taskId, {
      status: 'running',
      startedAt: new Date().toISOString()
    });

    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          tasks.set(taskId, {
            status: 'completed',
            result: result.choices?.[0]?.message?.content || body,
            raw: result,
            completedAt: new Date().toISOString()
          });
          resolve({ taskId, status: 'completed' });
        } catch (e) {
          tasks.set(taskId, {
            status: 'failed',
            error: e.message,
            raw: body,
            completedAt: new Date().toISOString()
          });
          reject(e);
        }
      });
    });

    req.on('error', err => {
      tasks.set(taskId, {
        status: 'failed',
        error: err.message,
        completedAt: new Date().toISOString()
      });
      reject(err);
    });

    req.write(data);
    req.end();
  });
}

// HTTP 服务器
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // 健康检查
  if (url.pathname === '/health' || url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      mode: AI_MODE,
      tasks: tasks.size
    }));
    return;
  }

  // 提交任务
  if (url.pathname === '/execute' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { prompt } = JSON.parse(body);
        if (!prompt) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'prompt is required' }));
          return;
        }

        const taskId = generateTaskId();

        // 异步执行，立即返回 taskId
        if (AI_MODE === 'claude-code') {
          executeClaudeCode(prompt, taskId).catch(console.error);
        } else if (AI_MODE === 'minimax') {
          executeMiniMax(prompt, taskId).catch(console.error);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          taskId,
          status: 'submitted',
          mode: AI_MODE
        }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 查询结果
  if (url.pathname.startsWith('/result/') && req.method === 'GET') {
    const taskId = url.pathname.replace('/result/', '');
    const task = tasks.get(taskId);

    if (!task) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'task not found' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(task));
    return;
  }

  // 状态
  if (url.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      mode: AI_MODE,
      tasks: Array.from(tasks.entries()).map(([id, t]) => ({
        id,
        status: t.status,
        startedAt: t.startedAt,
        completedAt: t.completedAt
      }))
    }));
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, () => {
  console.log(`AI Gateway running on port ${PORT}`);
  console.log(`Mode: ${AI_MODE}`);
  if (AI_MODE === 'minimax') {
    console.log(`MiniMax Group ID: ${MINIMAX_GROUP_ID}`);
  }
});
