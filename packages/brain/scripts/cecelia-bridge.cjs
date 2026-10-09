#!/usr/bin/env node
// cecelia-bridge.cjs — HTTP bridge between Brain and cecelia-run
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { createBridgeLifecycle, safeRespond } = require('./lib/bridge-lifecycle.cjs');
const llmLifecycle = createBridgeLifecycle();

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
      // 图片临时文件路径（多模态），确认整个进程组退出后清理
      let imageTmpPath = null;
      const cleanupImage = () => {
        if (imageTmpPath) {
          try { fs.unlinkSync(imageTmpPath); } catch {}
          imageTmpPath = null;
        }
      };

      try {
        const { prompt, model, timeout, image_base64, image_mime } = JSON.parse(body);
        if (!prompt) {
          safeRespond(res, 400, { ok: false, error: 'Missing prompt' });
          return;
        }

        const modelArg = model || 'haiku';

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

        const env = Object.assign({}, process.env);
        delete env.CLAUDECODE;
        // 单账号：accountId 已废弃，一律走默认 ~/.claude（不设 CLAUDE_CONFIG_DIR）
        delete env.CLAUDE_CONFIG_DIR;

        const llmWorkDir = '/tmp/cecelia-llm';
        try { fs.mkdirSync(llmWorkDir, { recursive: true }); } catch {}
        llmLifecycle.run(req, res, {
          command: CLAUDE_BIN, args, timeout, model: modelArg,
          options: { env, cwd: llmWorkDir, stdio: ['ignore', 'pipe', 'pipe'] },
          cleanup: cleanupImage,
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

llmLifecycle.bindShutdown(server);

server.listen(PORT, () => {
  console.log(`[bridge] Listening on port ${PORT}`);
});
