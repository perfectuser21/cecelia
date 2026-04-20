#!/usr/bin/env node
// cecelia-bridge.cjs — HTTP bridge between Brain and cecelia-run
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, spawn } = require('child_process');

// MIME → 文件扩展名（/llm-call 图片临时文件使用）
const MIME_TO_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
const BRIDGE_IMAGE_DIR = '/tmp/cecelia-bridge-images';
try { fs.mkdirSync(BRIDGE_IMAGE_DIR, { recursive: true }); } catch {}

const PORT = process.env.BRIDGE_PORT || 3457;
const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';
const BRIDGE_TIMEOUT_MS = parseInt(process.env.CECELIA_BRIDGE_TIMEOUT_MS || '120000', 10);

/**
 * 自动发现 claude 二进制文件路径。
 * 优先级：CLAUDE_BIN 环境变量 → 候选路径列表 → which claude 兜底。
 * 修复 spawn ENOENT：当 CLAUDE_BIN 指向不存在路径时自动搜索。
 */
function discoverClaudeBin() {
  const explicit = process.env.CLAUDE_BIN;
  if (explicit) {
    try { fs.accessSync(explicit, fs.constants.X_OK); return explicit; } catch {}
    console.warn(`[bridge] CLAUDE_BIN=${explicit} 不可执行，自动搜索 claude 路径...`);
  }
  const candidates = [
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    `${process.env.HOME || '/Users/administrator'}/.local/bin/claude`,
    `${process.env.HOME || '/Users/administrator'}/.npm-global/bin/claude`,
  ];
  for (const p of candidates) {
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {}
  }
  try {
    const found = execSync('which claude 2>/dev/null', { encoding: 'utf8' }).trim();
    if (found) return found;
  } catch {}
  return 'claude';
}
const CLAUDE_BIN = discoverClaudeBin();

/**
 * Safe response helper — prevents ERR_HTTP_HEADERS_SENT crash.
 * Once res.end() is called, subsequent calls are no-ops.
 */
function safeRespond(res, statusCode, body) {
  if (res.writableEnded || res.headersSent) return;
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/trigger-cecelia') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { task_id, checkpoint_id, prompt, task_type, permission_mode, repo_path, model, provider, extra_env } = JSON.parse(body);

        if (!task_id || !checkpoint_id || !prompt) {
          safeRespond(res, 400, { ok: false, error: 'Missing required fields' });
          return;
        }

        const promptDir = '/tmp/cecelia-prompts';
        try { fs.mkdirSync(promptDir, { recursive: true }); } catch {}
        const promptFile = `${promptDir}/${task_id}-${checkpoint_id}.prompt`;
        fs.writeFileSync(promptFile, prompt);

        const webhookUrl = `${BRAIN_URL}/api/brain/execution-callback`;
        const ceceliaBin = '/Users/administrator/bin/cecelia-run';
        const mode = permission_mode || 'bypassPermissions';
        const type = task_type || 'dev';

        let envVars = `WEBHOOK_URL="${webhookUrl}" CECELIA_CORE_API="${BRAIN_URL}" CECELIA_WEBHOOK_TOKEN="" CECELIA_PERMISSION_MODE="${mode}" CECELIA_TASK_TYPE="${type}"`;
        if (repo_path) envVars += ` CECELIA_WORK_DIR="${repo_path}"`;
        if (model) envVars += ` CECELIA_MODEL="${model}"`;
        if (provider) envVars += ` CECELIA_PROVIDER="${provider}"`;
        if (extra_env && typeof extra_env === 'object') {
          for (const [k, v] of Object.entries(extra_env)) {
            const safeKey = String(k).replace(/[^a-zA-Z0-9_]/g, '_');
            const safeVal = String(v).replace(/['"]/g, '');
            envVars += ` CECELIA_SKILLENV_${safeKey}="${safeVal}"`;
          }
        }

        const cmd = `${envVars} ${ceceliaBin} "${task_id}" "${checkpoint_id}" "${promptFile}" > /tmp/cecelia-${task_id}.log 2>&1 &`;
        console.log(`[bridge] Dispatching task=${task_id} type=${type} mode=${mode}${model ? ` model=${model}` : ''}${provider ? ` provider=${provider}` : ''}`);
        // exec (非阻塞) 代替 execSync — 防止阻塞事件循环导致其他请求超时
        const { exec } = require('child_process');
        exec(cmd, { shell: '/bin/bash' }, (err) => {
          if (err) console.error(`[bridge] exec error: ${err.message}`);
        });

        safeRespond(res, 200, { ok: true, task_id, checkpoint_id, pid: 'async' });
      } catch (err) {
        console.error(`[bridge] Error: ${err.message}`);
        safeRespond(res, 500, { ok: false, error: err.message });
      }
    });
  } else if (req.method === 'POST' && req.url === '/llm-call') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      // 图片临时文件路径（多模态），需要在 close/error 回调里清理
      let imageTmpPath = null;
      const cleanupImage = () => {
        if (imageTmpPath) {
          try { fs.unlinkSync(imageTmpPath); } catch {}
          imageTmpPath = null;
        }
      };

      try {
        const { prompt, model, timeout, accountId, image_base64, image_mime } = JSON.parse(body);
        if (!prompt) {
          safeRespond(res, 400, { ok: false, error: 'Missing prompt' });
          return;
        }

        const modelArg = model || 'haiku';
        const MAX_BRIDGE_LLM_TIMEOUT_MS = parseInt(process.env.CECELIA_BRIDGE_MAX_TIMEOUT_MS || '600000', 10);
        const timeoutMs = Math.min(timeout || BRIDGE_TIMEOUT_MS, MAX_BRIDGE_LLM_TIMEOUT_MS);

        // ──────── 多模态：image_base64 支持 ────────
        // claude CLI 本身没有 --image 参数，但支持 Read 工具读取本地文件。
        // 做法：写图片到 /tmp/cecelia-bridge-images/<uuid>.<ext>，
        // prompt 末尾追加"请用 Read 工具读取 <path>"，
        // 再用 --allowedTools Read 放行 Read 工具调用。
        let finalPrompt = prompt;
        const extraArgs = [];
        if (image_base64 && typeof image_base64 === 'string' && image_base64.length > 0) {
          const mime = typeof image_mime === 'string' && image_mime ? image_mime : 'image/png';
          const ext = MIME_TO_EXT[mime] || 'png';
          const filename = `bridge-image-${crypto.randomUUID()}.${ext}`;
          imageTmpPath = path.join(BRIDGE_IMAGE_DIR, filename);
          try {
            fs.writeFileSync(imageTmpPath, Buffer.from(image_base64, 'base64'));
          } catch (writeErr) {
            console.error(`[bridge] /llm-call image write failed: ${writeErr.message}`);
            safeRespond(res, 500, { ok: false, error: `image write failed: ${writeErr.message}` });
            return;
          }
          finalPrompt = `${prompt}\n\n请先用 Read 工具读取本地图片文件 ${imageTmpPath}（这是一张 ${mime} 图片），然后严格按上面的指令完成分析与评审。只输出最终结果文本，不要解释 Read 过程。`;
          // 放行 Read 工具（claude -p 默认不会使用工具，需显式 allow）
          extraArgs.push('--allowedTools', 'Read');
        }

        const args = ['-p', finalPrompt, '--model', modelArg, '--output-format', 'text', ...extraArgs];

        const startTime = Date.now();
        let timedOut = false;
        const env = Object.assign({}, process.env);
        delete env.CLAUDECODE;
        const { homedir } = require('os');
        const { join } = require('path');
        if (accountId) {
          env.CLAUDE_CONFIG_DIR = join(homedir(), '.claude-' + accountId);
        } else {
          // 无 accountId 时用默认账号，防止 claude -p 因 CLAUDE_CONFIG_DIR 未设置而报 "Not logged in"
          const DEFAULT_CLAUDE_CONFIG_DIR = process.env.DEFAULT_CLAUDE_CONFIG_DIR
            || join(homedir(), '.claude-account1');
          if (!env.CLAUDE_CONFIG_DIR) {
            env.CLAUDE_CONFIG_DIR = DEFAULT_CLAUDE_CONFIG_DIR;
            console.log(`[bridge] /llm-call 无 accountId，使用默认 CLAUDE_CONFIG_DIR=${DEFAULT_CLAUDE_CONFIG_DIR}`);
          }
        }

        const llmWorkDir = '/tmp/cecelia-llm';
        try { fs.mkdirSync(llmWorkDir, { recursive: true }); } catch {}
        const child = spawn(CLAUDE_BIN, args, {
          env,
          cwd: llmWorkDir,
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: timeoutMs,
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', d => stdout += d);
        child.stderr.on('data', d => stderr += d);

        const timer = setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, timeoutMs);

        child.on('close', (code) => {
          clearTimeout(timer);
          cleanupImage();
          const elapsed = Date.now() - startTime;

          if (timedOut) {
            console.warn(`[bridge] /llm-call timeout after ${elapsed}ms model=${modelArg}`);
            safeRespond(res, 200, { ok: false, status: 'timeout', degraded: true, message: 'LLM call timed out', elapsed_ms: elapsed });
            return;
          }

          if (code !== 0) {
            console.error(`[bridge] /llm-call error (${elapsed}ms) code=${code}: ${stderr.slice(0, 200)}`);
            safeRespond(res, 500, { ok: false, error: stderr.slice(0, 500) || `exit code ${code}`, elapsed_ms: elapsed });
            return;
          }

          const text = stdout.trim();
          const imgTag = imageTmpPath === null && image_base64 ? ' +image' : '';
          console.log(`[bridge] /llm-call ${modelArg}${accountId ? ` [${accountId}]` : ''}${image_base64 ? ' +image' : ''} → ${text.length} chars in ${elapsed}ms`);
          safeRespond(res, 200, { ok: true, text, model: modelArg, elapsed_ms: elapsed });
        });

        child.on('error', (err) => {
          clearTimeout(timer);
          cleanupImage();
          const elapsed = Date.now() - startTime;
          console.error(`[bridge] /llm-call spawn error (${elapsed}ms): ${err.message}`);
          safeRespond(res, 500, { ok: false, error: err.message, elapsed_ms: elapsed });
        });
      } catch (err) {
        cleanupImage();
        console.error(`[bridge] /llm-call parse error: ${err.message}`);
        safeRespond(res, 500, { ok: false, error: err.message });
      }
    });
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
