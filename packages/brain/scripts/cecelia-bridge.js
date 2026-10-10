#!/usr/bin/env node
// cecelia-bridge.js — 宿主侧 HTTP bridge（brain-deploy.sh 部署到 ~/bin 的版本；NotebookLM 等宿主 CLI 代理）
//
// Claude 无头通道已退役（任务 76a160b3，决策 067867c8，单一来源 src/lib/claude-channel.js）：
// /llm-call 与 /trigger-cecelia 曾经拉起 claude -p / cecelia-run，现一律 410，不再执行任何进程。
// 保留 /health（外部探活）与 notebook 端点。
const http = require('http');

const PORT = process.env.BRIDGE_PORT || 3457;
const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';
const RETIRED_ENDPOINTS = new Set(['/llm-call', '/trigger-cecelia']);

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && RETIRED_ENDPOINTS.has(req.url)) {
    res.writeHead(410, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'claude_channel_retired' }));
  } else if (req.method === 'POST' && req.url === '/notebook/query') {
    // NotebookLM 查询 — 容器内 Brain 通过 bridge 调用宿主机 CLI
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { query, notebook_id } = JSON.parse(body);
        if (!query) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Missing query' }));
          return;
        }

        const notebookCli = process.env.NOTEBOOKLM_BIN || '/opt/homebrew/bin/notebooklm';
        const { execFile } = require('child_process');
        const startTime = Date.now();
        const args = notebook_id ? ['ask', '-n', notebook_id, query] : ['ask', query];

        execFile(notebookCli, args, { timeout: 90000 }, (err, stdout, stderr) => {
          const elapsed = Date.now() - startTime;
          if (err) {
            console.warn(`[bridge] /notebook/query failed (${elapsed}ms): ${err.message}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: err.message, elapsed_ms: elapsed }));
            return;
          }
          const text = (stdout || '').trim();
          console.log(`[bridge] /notebook/query${notebook_id ? ` -n ${notebook_id.slice(0, 8)}` : ''} → ${text.length} chars in ${elapsed}ms`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, text, elapsed_ms: elapsed }));
        });
      } catch (err) {
        console.error(`[bridge] /notebook/query parse error: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
  } else if (req.method === 'POST' && req.url === '/notebook/add-source') {
    // NotebookLM 添加 URL 源 — 容器内 Brain 通过 bridge 调用宿主机 CLI
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { url, notebook_id } = JSON.parse(body);
        if (!url) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Missing url' }));
          return;
        }

        const notebookCli = process.env.NOTEBOOKLM_BIN || '/opt/homebrew/bin/notebooklm';
        const { execFile } = require('child_process');
        const startTime = Date.now();
        const args = notebook_id ? ['source', 'add', '-n', notebook_id, url] : ['source', 'add', url];

        execFile(notebookCli, args, { timeout: 60000 }, (err, stdout, stderr) => {
          const elapsed = Date.now() - startTime;
          if (err) {
            console.warn(`[bridge] /notebook/add-source failed (${elapsed}ms): ${err.message}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: err.message, elapsed_ms: elapsed }));
            return;
          }
          console.log(`[bridge] /notebook/add-source → ok in ${elapsed}ms`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, elapsed_ms: elapsed }));
        });
      } catch (err) {
        console.error(`[bridge] /notebook/add-source parse error: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
  } else if (req.method === 'POST' && req.url === '/notebook/add-text-source') {
    // NotebookLM 添加内联文本源 — 容器内 Brain 通过 bridge 调用宿主机 CLI
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { text, title, notebook_id } = JSON.parse(body);
        if (!text) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Missing text' }));
          return;
        }

        const notebookCli = process.env.NOTEBOOKLM_BIN || '/opt/homebrew/bin/notebooklm';
        const { execFile } = require('child_process');
        const startTime = Date.now();
        // notebooklm source add "text content" --title "title" [-n notebook_id] --json
        const args = ['source', 'add', text, '--json'];
        if (title) { args.push('--title', title); }
        if (notebook_id) { args.push('-n', notebook_id); }

        execFile(notebookCli, args, { timeout: 60000 }, (err, stdout, stderr) => {
          const elapsed = Date.now() - startTime;
          if (err) {
            console.warn(`[bridge] /notebook/add-text-source failed (${elapsed}ms): ${err.message}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: err.message, elapsed_ms: elapsed }));
            return;
          }
          let sourceId = null;
          try {
            const parsed = JSON.parse(stdout);
            sourceId = parsed?.source?.id || null;
          } catch { /* 解析失败不影响写入成功状态 */ }
          console.log(`[bridge] /notebook/add-text-source → ok in ${elapsed}ms, source_id: ${sourceId}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, sourceId, elapsed_ms: elapsed }));
        });
      } catch (err) {
        console.error(`[bridge] /notebook/add-text-source parse error: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
  } else if (req.method === 'POST' && req.url === '/notebook/auth-check') {
    // NotebookLM auth 健康检查 — 真调 API 验证 cookie 是否有效
    const notebookCli = process.env.NOTEBOOKLM_BIN || '/opt/homebrew/bin/notebooklm';
    const { execFile } = require('child_process');
    const startTime = Date.now();

    execFile(notebookCli, ['auth', 'check', '--test'], { timeout: 30000 }, (err, stdout, stderr) => {
      const elapsed = Date.now() - startTime;
      const ok = !err;
      if (ok) {
        console.log(`[bridge] /notebook/auth-check → ok in ${elapsed}ms`);
      } else {
        console.warn(`[bridge] /notebook/auth-check → failed in ${elapsed}ms: ${err.message}`);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok,
        error: err ? err.message : null,
        stdout: (stdout || '').trim().slice(0, 200),
        elapsed_ms: elapsed,
      }));
    });
  } else if (req.method === 'POST' && req.url === '/notebook/delete-source') {
    // 删除 NotebookLM source（源生命周期管理：压缩后删除下级 source）
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { source_id, notebook_id } = JSON.parse(body);
        if (!source_id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Missing source_id' }));
          return;
        }
        const notebookCli = process.env.NOTEBOOKLM_BIN || '/opt/homebrew/bin/notebooklm';
        const { execFile } = require('child_process');
        const startTime = Date.now();
        const args = ['source', 'delete', source_id, '-y'];
        if (notebook_id) { args.push('-n', notebook_id); }

        execFile(notebookCli, args, { timeout: 30000 }, (err, stdout, stderr) => {
          const elapsed = Date.now() - startTime;
          if (err) {
            console.warn(`[bridge] /notebook/delete-source ${source_id} failed (${elapsed}ms): ${err.message}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: err.message, elapsed_ms: elapsed }));
            return;
          }
          console.log(`[bridge] /notebook/delete-source ${source_id} → ok in ${elapsed}ms`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, sourceId: source_id, elapsed_ms: elapsed }));
        });
      } catch (err) {
        console.error(`[bridge] /notebook/delete-source parse error: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
  } else if (req.method === 'POST' && req.url === '/notebook/list-sources') {
    // 列出 NotebookLM notebook 的所有 sources（对账用）
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { notebook_id } = JSON.parse(body);
        const notebookCli = process.env.NOTEBOOKLM_BIN || '/opt/homebrew/bin/notebooklm';
        const { execFile } = require('child_process');
        const args = ['source', 'list', '--json'];
        if (notebook_id) { args.push('-n', notebook_id); }

        execFile(notebookCli, args, { timeout: 30000 }, (err, stdout, stderr) => {
          if (err) {
            console.warn(`[bridge] /notebook/list-sources failed: ${err.message}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: err.message }));
            return;
          }
          try {
            const parsed = JSON.parse(stdout);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, sources: parsed.sources || [], notebookId: notebook_id }));
          } catch (parseErr) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'parse failed', raw: stdout.slice(0, 200) }));
          }
        });
      } catch (err) {
        console.error(`[bridge] /notebook/list-sources parse error: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
  } else if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, status: 'healthy' }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`[bridge] cecelia-bridge listening on port ${PORT}`);
  console.log(`[bridge] Brain URL: ${BRAIN_URL}`);
});
