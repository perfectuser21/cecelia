#!/usr/bin/env node
// cecelia-bridge.js — HTTP bridge between Brain and cecelia-run
const http = require('http');
const fs = require('fs');
const { execSync, exec } = require('child_process');

const PORT = process.env.BRIDGE_PORT || 3457;
const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/trigger-cecelia') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { task_id, checkpoint_id, prompt, task_type, permission_mode, repo_path, model, provider, extra_env } = JSON.parse(body);

        if (!task_id || !checkpoint_id || !prompt) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Missing required fields' }));
          return;
        }

        const promptDir = '/tmp/cecelia-prompts';
        execSync(`mkdir -p ${promptDir}`);
        const promptFile = `${promptDir}/${task_id}-${checkpoint_id}.prompt`;
        fs.writeFileSync(promptFile, prompt);

        const webhookUrl = `${BRAIN_URL}/api/brain/execution-callback`;
        const ceceliaBin = '/home/xx/bin/cecelia-run';
        const mode = permission_mode || 'bypassPermissions';
        const type = task_type || 'dev';

        let envVars = `WEBHOOK_URL="${webhookUrl}" CECELIA_CORE_API="${BRAIN_URL}" CECELIA_WEBHOOK_TOKEN="" CECELIA_PERMISSION_MODE="${mode}" CECELIA_TASK_TYPE="${type}"`;
        if (repo_path) envVars += ` CECELIA_WORK_DIR="${repo_path}"`;
        if (model) envVars += ` CECELIA_MODEL="${model}"`;
        if (provider) envVars += ` CECELIA_PROVIDER="${provider}"`;
        // extra_env: 逐键注入为 CECELIA_XXX 形式，供 cecelia-run 透传给 claude
        if (extra_env && typeof extra_env === 'object') {
          for (const [k, v] of Object.entries(extra_env)) {
            const safeKey = String(k).replace(/[^a-zA-Z0-9_]/g, '_');
            const safeVal = String(v).replace(/['"]/g, '');
            envVars += ` CECELIA_SKILLENV_${safeKey}="${safeVal}"`;
          }
        }

        const cmd = `${envVars} ${ceceliaBin} "${task_id}" "${checkpoint_id}" "${promptFile}" > /tmp/cecelia-${task_id}.log 2>&1 &`;
        console.log(`[bridge] Dispatching task=${task_id} type=${type} mode=${mode}${model ? ` model=${model}` : ''}${provider ? ` provider=${provider}` : ''}`);
        execSync(cmd, { shell: '/bin/bash' });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, task_id, checkpoint_id, pid: 'async' }));
      } catch (err) {
        console.error(`[bridge] Error: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
  } else if (req.method === 'POST' && req.url === '/llm-call') {
    // 轻量同步 LLM 调用 — Brain 的思考用（不是任务执行）
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { prompt, model, timeout, accountId } = JSON.parse(body);
        if (!prompt) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Missing prompt' }));
          return;
        }

        const modelArg = model || 'haiku';
        const timeoutMs = Math.min(timeout || 90000, 180000);
        const claudeBin = '/home/xx/.local/bin/claude';
        const args = ['-p', prompt, '--model', modelArg, '--output-format', 'text'];

        const startTime = Date.now();
        const { spawn } = require('child_process');
        const env = Object.assign({}, process.env);
        delete env.CLAUDECODE;
        // 账号轮换：如果传入 accountId，用宿主机侧 homedir 拼出正确路径
        // Brain 运行在容器内（homedir=/home/cecelia），必须由 bridge 在宿主机侧拼路径
        if (accountId) {
          const { homedir } = require('os');
          const { join } = require('path');
          env.CLAUDE_CONFIG_DIR = join(homedir(), '.claude-' + accountId);
        }

        const child = spawn(claudeBin, args, {
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: timeoutMs,
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', d => stdout += d);
        child.stderr.on('data', d => stderr += d);

        const timer = setTimeout(() => {
          child.kill('SIGTERM');
        }, timeoutMs);

        child.on('close', (code) => {
          clearTimeout(timer);
          const elapsed = Date.now() - startTime;

          if (code !== 0) {
            console.error(`[bridge] /llm-call error (${elapsed}ms) code=${code}: ${stderr.slice(0, 200)}`);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: stderr.slice(0, 500) || `exit code ${code}`, elapsed_ms: elapsed }));
            return;
          }

          const text = stdout.trim();
          console.log(`[bridge] /llm-call ${modelArg}${accountId ? ` [${accountId}]` : ''} → ${text.length} chars in ${elapsed}ms`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, text, model: modelArg, elapsed_ms: elapsed }));
        });

        child.on('error', (err) => {
          clearTimeout(timer);
          const elapsed = Date.now() - startTime;
          console.error(`[bridge] /llm-call spawn error (${elapsed}ms): ${err.message}`);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err.message, elapsed_ms: elapsed }));
        });
      } catch (err) {
        console.error(`[bridge] /llm-call parse error: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
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

        const notebookCli = '/home/xx/.local/bin/notebooklm';
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

        const notebookCli = '/home/xx/.local/bin/notebooklm';
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

        const notebookCli = '/home/xx/.local/bin/notebooklm';
        const { execFile } = require('child_process');
        const startTime = Date.now();
        // notebooklm source add "text content" --title "title" [-n notebook_id]
        const args = ['source', 'add', text];
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
          console.log(`[bridge] /notebook/add-text-source → ok in ${elapsed}ms`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, elapsed_ms: elapsed }));
        });
      } catch (err) {
        console.error(`[bridge] /notebook/add-text-source parse error: ${err.message}`);
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
