#!/usr/bin/env node
// cecelia-bridge.cjs — 宿主侧 HTTP bridge（NotebookLM 等宿主 CLI 代理）
//
// Claude 无头通道已退役（任务 76a160b3，决策 067867c8，单一来源 src/lib/claude-channel.js）：
// /llm-call 与 /trigger-cecelia 曾经拉起 claude -p / cecelia-run，现一律 410，不再执行任何进程。
// 保留 /health（外部探活）与 notebook 端点。
const http = require('http');
const { safeRespond } = require('./lib/bridge-lifecycle.cjs');

const PORT = process.env.BRIDGE_PORT || 3457;
const CLAUDE_CHANNEL_RETIRED = { ok: false, error: 'claude_channel_retired' };
const RETIRED_ENDPOINTS = new Set(['/llm-call', '/trigger-cecelia']);

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && RETIRED_ENDPOINTS.has(req.url)) {
    safeRespond(res, 410, CLAUDE_CHANNEL_RETIRED);
  } else if (req.method === 'POST' && req.url === '/notebook/query') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { query, notebook_id } = JSON.parse(body);
        if (!query) {
          safeRespond(res, 400, { ok: false, error: 'Missing query' });
          return;
        }

        const notebookCli = process.env.NOTEBOOKLM_BIN || '/opt/homebrew/bin/notebooklm';
        const { execFile } = require('child_process');
        const startTime = Date.now();
        const args = notebook_id ? ['ask', '-n', notebook_id, query] : ['ask', query];

        execFile(notebookCli, args, { timeout: 90000 }, (err, stdout, stderr) => {
          const elapsed = Date.now() - startTime;
          if (err) {
            console.error(`[bridge] /notebook/query error (${elapsed}ms): ${err.message}`);
            safeRespond(res, 500, { ok: false, error: err.message, elapsed_ms: elapsed });
            return;
          }
          const text = stdout.trim();
          console.log(`[bridge] /notebook/query → ${text.length} chars in ${elapsed}ms`);
          safeRespond(res, 200, { ok: true, text, elapsed_ms: elapsed });
        });
      } catch (err) {
        console.error(`[bridge] /notebook/query parse error: ${err.message}`);
        safeRespond(res, 500, { ok: false, error: err.message });
      }
    });
  } else if (req.method === 'GET' && req.url === '/health') {
    safeRespond(res, 200, { ok: true, status: 'healthy' });
  } else {
    safeRespond(res, 404, { ok: false, error: 'Not found' });
  }
});

// Catch uncaught errors to prevent crash
process.on('uncaughtException', (err) => {
  console.error(`[bridge] Uncaught exception (recovered): ${err.message}`);
});

server.listen(PORT, () => {
  console.log(`[bridge] Listening on port ${PORT}`);
});
