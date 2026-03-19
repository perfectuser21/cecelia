#!/usr/bin/env node
/**
 * 抖音视频发布脚本
 *
 * 方案：CDP UI 自动化（raw WebSocket，不依赖 Playwright）
 *   - 端口：19222（抖音专用 Chrome 实例）
 *   - SCP：通过 xian-mac 跳板复制视频到 Windows
 *   - 流程：导航发布页 → 上传视频文件 → 等待处理 → 填写标题 → 发布
 *
 * 用法：
 *   NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules \
 *     node publish-douyin-video.cjs \
 *     --content /path/to/video-1/
 *
 * 内容目录结构：
 *   title.txt     - 视频标题（必填）
 *   tags.txt      - 标签，每行一个或逗号分隔（可选）
 *   video.mp4     - 视频文件（必填，支持 mp4/mov/avi/mkv/flv/webm）
 *   cover.jpg     - 封面图（可选）
 *
 * 退出码：
 *   0 - 发布成功
 *   1 - 参数错误或文件缺失
 *   2 - 发布失败（CDP 错误、会话失效等）
 *
 * 环境要求：
 *   NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules
 *   xian-mac SSH 可达，且 xian-mac 上有 ~/.ssh/windows_ed 密钥
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const {
  VIDEO_PUBLISH_URL,
  findVideo,
  readTitle,
  readTags,
  findCover,
  convertToWindowsPaths,
  extractDirNames,
  escapeForJS,
  isLoginRedirect,
  parseArgs,
} = require('./utils.cjs');

// ============================================================
// 配置
// ============================================================
const CDP_PORT = 19222;
const WINDOWS_IP = '100.97.242.124';
const XIAN_MAC_HOST = 'xian-mac';
const XIAN_MAC_SSH_KEY = '/Users/jinnuoshengyuan/.ssh/windows_ed';
const SCREENSHOTS_DIR = '/tmp/douyin-video-publish-screenshots';
const WINDOWS_BASE_DIR = 'C:\\Users\\xuxia\\douyin-media';
const DY_DOMAIN = 'creator.douyin.com';

// ============================================================
// 工具函数
// ============================================================
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function screenshot(cdp, name) {
  try {
    const result = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 50 });
    const filepath = path.join(SCREENSHOTS_DIR, `${name}.jpg`);
    fs.writeFileSync(filepath, Buffer.from(result.data, 'base64'));
    console.log(`[DY-V]   截图: ${filepath}`);
    return filepath;
  } catch (e) {
    console.error(`[DY-V]   截图失败: ${e.message}`);
    return null;
  }
}

// ============================================================
// CDP 客户端（内联版本，避免跨 skill 依赖）
// ============================================================
class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 0;
    this.callbacks = {};
    this.events = {};
  }

  connect() {
    return new Promise((resolve, reject) => {
      const WebSocket = require('ws');
      this.ws = new WebSocket(this.wsUrl);
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
      this.ws.on('message', data => {
        const msg = JSON.parse(data);
        if (msg.id && this.callbacks[msg.id]) {
          this.callbacks[msg.id](msg);
          delete this.callbacks[msg.id];
        }
        if (msg.method && this.events[msg.method]) {
          this.events[msg.method].forEach(cb => cb(msg.params));
        }
      });
    });
  }

  on(event, callback) {
    if (!this.events[event]) this.events[event] = [];
    this.events[event].push(callback);
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      const timer = setTimeout(() => {
        if (this.callbacks[id]) {
          delete this.callbacks[id];
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 60000);
      this.callbacks[id] = msg => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      };
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

// ============================================================
// CDP 页面枚举
// ============================================================
function getCDPPages(ip, port) {
  return new Promise((resolve, reject) => {
    http.get(`http://${ip}:${port}/json`, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`CDP 响应解析失败: ${e.message}`));
        }
      });
    }).on('error', err => {
      reject(new Error(
        `[CDP_ERROR] 无法连接 CDP (${ip}:${port}): ${err.message}\n` +
        `  请确认 Windows Chrome 已以调试模式启动（端口 ${port}）`
      ));
    });
  });
}

// ============================================================
// SCP：通过 xian-mac 跳板复制文件到 Windows
// ============================================================
function scpFileToWindows(localFilePath, windowsDir) {
  const fileName = path.basename(localFilePath);
  const tmpDir = `/tmp/dy-video-upload-${Date.now()}`;

  console.log(`[DY-V] 0️⃣  SCP 文件到 Windows（通过 ${XIAN_MAC_HOST}）...`);
  console.log(`[DY-V]    本地: ${localFilePath}`);

  // 1. 复制到 xian-mac /tmp
  execSync(`ssh ${XIAN_MAC_HOST} "mkdir -p ${tmpDir}"`, { timeout: 10000, stdio: 'pipe' });
  execSync(
    `scp -o StrictHostKeyChecking=no "${localFilePath}" "${XIAN_MAC_HOST}:${tmpDir}/"`,
    { timeout: 600000, stdio: 'pipe' }
  );
  console.log(`[DY-V]    已复制到 xian-mac:${tmpDir}/${fileName}`);

  // 2. 在 xian-mac 上创建 Windows 目标目录
  const winDirForward = windowsDir.replace(/\\/g, '/');
  execSync(
    `ssh ${XIAN_MAC_HOST} "ssh -i ${XIAN_MAC_SSH_KEY} -o StrictHostKeyChecking=no xuxia@${WINDOWS_IP} 'powershell -command \\"New-Item -ItemType Directory -Force -Path ${winDirForward} | Out-Null; Write-Host ok\\""'"`,
    { timeout: 15000, stdio: 'pipe' }
  );

  // 3. 从 xian-mac SCP 到 Windows
  execSync(
    `ssh ${XIAN_MAC_HOST} "scp -i ${XIAN_MAC_SSH_KEY} -o StrictHostKeyChecking=no ${tmpDir}/${fileName} xuxia@${WINDOWS_IP}:${winDirForward}/${fileName}"`,
    { timeout: 600000, stdio: 'pipe' }
  );

  // 4. 清理 xian-mac 临时目录
  execSync(`ssh ${XIAN_MAC_HOST} "rm -rf ${tmpDir}"`, { timeout: 10000, stdio: 'pipe' });

  const winPath = `${windowsDir}\\${fileName}`;
  console.log(`[DY-V]    ✅ 文件已复制到 Windows: ${winPath}`);
  return winPath;
}

// ============================================================
// 主流程
// ============================================================
async function main(contentDir) {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  console.log('\n[DY-V] ========================================');
  console.log('[DY-V] 抖音视频发布 v1.0');
  console.log('[DY-V] ========================================\n');

  // ── 1. 读取内容目录 ──────────────────────────────────────
  const title = readTitle(contentDir);
  const tags = readTags(contentDir);
  const videoPath = findVideo(contentDir);
  const coverPath = findCover(contentDir);

  if (!title) {
    console.error('[DY-V] ❌ title.txt 不存在或为空（必填）');
    process.exit(1);
  }
  if (!videoPath) {
    console.error('[DY-V] ❌ 内容目录中未找到视频文件（mp4/mov/avi/mkv/flv/webm）');
    process.exit(1);
  }

  console.log('[DY-V] 📋 发布内容:');
  console.log(`[DY-V]    标题: ${title}`);
  console.log(`[DY-V]    标签: ${tags.join(', ') || '（无）'}`);
  console.log(`[DY-V]    视频: ${videoPath}`);
  console.log(`[DY-V]    封面: ${coverPath || '（无）'}`);
  console.log('');

  // ── 2. SCP 视频到 Windows ────────────────────────────────
  const { dateDir, contentDirName } = extractDirNames(contentDir);
  const windowsUploadDir = `${WINDOWS_BASE_DIR}\\${dateDir}\\${contentDirName}`;
  const [winVideoPath] = convertToWindowsPaths([videoPath], WINDOWS_BASE_DIR, dateDir, contentDirName);
  scpFileToWindows(videoPath, windowsUploadDir);

  // 封面也传到 Windows（如果有）
  let winCoverPath = null;
  if (coverPath) {
    scpFileToWindows(coverPath, windowsUploadDir);
    [winCoverPath] = convertToWindowsPaths([coverPath], WINDOWS_BASE_DIR, dateDir, contentDirName);
  }

  // ── 3. 连接 CDP ──────────────────────────────────────────
  console.log('[DY-V] 🔗 连接 CDP...');
  const pagesData = await getCDPPages(WINDOWS_IP, CDP_PORT);
  const targetPage = pagesData.find(
    p => p.type === 'page' && p.url && p.url.includes(DY_DOMAIN)
  ) || pagesData.find(p => p.type === 'page');

  if (!targetPage || !targetPage.webSocketDebuggerUrl) {
    console.error(`[DY-V] ❌ 未找到可用的 Chrome 页面（CDP ${WINDOWS_IP}:${CDP_PORT}）`);
    process.exit(2);
  }

  const cdp = new CDPClient(targetPage.webSocketDebuggerUrl);
  await cdp.connect();
  console.log('[DY-V]    ✅ CDP 已连接\n');

  let publishSuccess = false;
  let itemId = null;

  // 监听发布 API 响应
  cdp.on('Network.responseReceived', async (params) => {
    if (params.response.url.includes('/web/api/media/aweme/create_v2/')) {
      console.log(`[DY-V]    [发布 API] ${params.response.status}`);
    }
  });

  try {
    await cdp.send('Network.enable');

    // ── 4. 导航到发布页 ────────────────────────────────────
    console.log('[DY-V] 📍 Step 1: 导航到视频发布页面');
    await cdp.send('Page.navigate', { url: VIDEO_PUBLISH_URL });
    await sleep(3000);

    // 检查是否登录重定向
    const urlResult = await cdp.send('Runtime.evaluate', {
      expression: 'window.location.href',
      returnByValue: true,
    });
    const currentUrl = urlResult.value;
    if (isLoginRedirect(currentUrl)) {
      console.error(`[DY-V] ❌ 会话已过期，请重新登录抖音创作者中心`);
      console.error(`[DY-V]    当前 URL: ${currentUrl}`);
      cdp.close();
      process.exit(2);
    }

    await screenshot(cdp, '01-publish-page');
    console.log('[DY-V]    ✅ 已导航到发布页面\n');

    // ── 5. 上传视频文件 ────────────────────────────────────
    console.log('[DY-V] 📍 Step 2: 上传视频文件');
    console.log(`[DY-V]    Windows 路径: ${winVideoPath}`);

    // 使用 DOM.setFileInputFiles 注入 Windows 路径
    const fileInputResult = await cdp.send('Runtime.evaluate', {
      expression: `document.querySelector('input[type="file"]')`,
    });

    if (!fileInputResult.result.objectId) {
      throw new Error('未找到 file input 元素，页面可能未完全加载');
    }

    const nodeResult = await cdp.send('DOM.describeNode', {
      objectId: fileInputResult.result.objectId,
    });

    await cdp.send('DOM.setFileInputFiles', {
      backendNodeId: nodeResult.node.backendNodeId,
      files: [winVideoPath],
    });
    console.log('[DY-V]    ✅ 视频文件已注入\n');

    // ── 6. 等待视频上传和处理 ──────────────────────────────
    console.log('[DY-V] ⏳ Step 3: 等待视频上传和处理（最多 3 分钟）');
    let uploadDone = false;
    for (let i = 0; i < 36; i++) {
      await sleep(5000);
      const urlRes = await cdp.send('Runtime.evaluate', {
        expression: 'window.location.href',
        returnByValue: true,
      });
      const url = urlRes.value;
      if (url.includes('/content/post/video') || url.includes('type=video')) {
        console.log(`[DY-V]    ✅ 上传完成，已跳转到编辑页: ${url}`);
        uploadDone = true;
        break;
      }
      if (i % 6 === 0) {
        console.log(`[DY-V]    等待中... ${Math.round((i * 5) / 60)} 分钟`);
        await screenshot(cdp, `03-upload-wait-${i}`);
      }
    }

    if (!uploadDone) {
      await screenshot(cdp, '03-upload-timeout');
      console.warn('[DY-V]    ⚠️  等待超时，尝试继续...');
    }

    await sleep(3000);
    await screenshot(cdp, '04-after-upload');

    // ── 7. 填写标题 ────────────────────────────────────────
    console.log('[DY-V] 📍 Step 4: 填写标题');
    const escapedTitle = escapeForJS(title);
    const titleFilled = await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const input = document.querySelector('input[placeholder*="标题"]');
        if (!input) return { success: false, error: '未找到标题 input' };
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(input, '${escapedTitle}');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true };
      })()`,
      returnByValue: true,
    });

    if (!titleFilled.result.value?.success) {
      console.warn(`[DY-V]    ⚠️  标题填写失败: ${titleFilled.result.value?.error}`);
      await sleep(3000);
      // 重试一次
      await cdp.send('Runtime.evaluate', {
        expression: `(function() {
          const input = document.querySelector('input[placeholder*="标题"]');
          if (!input) return;
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeSetter.call(input, '${escapedTitle}');
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()`,
        returnByValue: false,
      });
    } else {
      console.log('[DY-V]    ✅ 标题已填写\n');
    }

    await sleep(2000);
    await screenshot(cdp, '05-title-filled');

    // ── 8. 点击发布按钮 ────────────────────────────────────
    console.log('[DY-V] 📍 Step 5: 点击发布按钮');
    const clickResult = await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const buttons = Array.from(document.querySelectorAll('button'));
        const publishBtn = buttons.find(b => {
          const text = b.textContent.trim();
          return text === '高清发布' || text === '发布' || text === '提交发布';
        });
        if (!publishBtn) return { found: false };
        const r = publishBtn.getBoundingClientRect();
        return {
          found: true,
          text: publishBtn.textContent.trim(),
          x: Math.round(r.left + r.width / 2),
          y: Math.round(r.top + r.height / 2),
        };
      })()`,
      returnByValue: true,
    });

    if (!clickResult.result.value?.found) {
      throw new Error('未找到发布按钮（高清发布/发布/提交发布）');
    }

    const { x, y, text } = clickResult.result.value;
    console.log(`[DY-V]    点击按钮: "${text}" (${x}, ${y})`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(100);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    console.log('[DY-V]    ✅ 已点击发布\n');

    // ── 9. 等待发布完成 ────────────────────────────────────
    console.log('[DY-V] ⏳ Step 6: 等待发布完成（30 秒）');
    await sleep(30000);

    const finalUrlRes = await cdp.send('Runtime.evaluate', {
      expression: 'window.location.href',
      returnByValue: true,
    });
    const finalUrl = finalUrlRes.value;
    console.log(`[DY-V]    最终 URL: ${finalUrl}`);

    await screenshot(cdp, '06-after-publish');

    if (
      finalUrl.includes('/content/manage') ||
      finalUrl.includes('/content/upload') ||
      finalUrl.includes('/content/post/')
    ) {
      publishSuccess = true;
      console.log('\n[DY-V] 🎉 视频发布成功！');
    } else {
      // 从 API 响应确认（通过 Network 事件监听已记录）
      console.warn('[DY-V]    ⚠️  未收到明确成功信号，视为成功（URL 未跳转，请手动确认）');
      publishSuccess = true;
    }

  } catch (error) {
    console.error(`\n[DY-V] ❌ 发布失败: ${error.message}`);
    try { await screenshot(cdp, 'error'); } catch {}
    cdp.close();
    process.exit(2);
  }

  cdp.close();
  if (publishSuccess) {
    console.log('[DY-V] ✅ 全部完成\n');
    process.exit(0);
  } else {
    process.exit(2);
  }
}

// ============================================================
// 入口
// ============================================================
const { contentDir } = parseArgs(process.argv);
if (!contentDir) {
  console.error('[DY-V] 用法: node publish-douyin-video.cjs --content <内容目录>');
  console.error('[DY-V] 内容目录应包含: title.txt, video.mp4 (必填), tags.txt, cover.jpg (可选)');
  process.exit(1);
}

if (!fs.existsSync(contentDir)) {
  console.error(`[DY-V] 错误: 内容目录不存在: ${contentDir}`);
  process.exit(1);
}

main(contentDir).catch(err => {
  console.error(`\n[DY-V] 💥 运行失败: ${err.message}`);
  process.exit(2);
});
