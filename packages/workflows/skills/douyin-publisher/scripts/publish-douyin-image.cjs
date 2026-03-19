#!/usr/bin/env node
/**
 * 抖音图文发布脚本
 *
 * 方案：CDP UI 自动化（raw WebSocket，不依赖 Playwright）
 *   - 端口：19222（抖音专用 Chrome 实例）
 *   - SCP：通过 xian-mac 跳板复制图片到 Windows
 *   - 流程：导航图文发布页 → 上传图片 → 填写标题/文案 → 发布
 *
 * 用法：
 *   NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules \
 *     node publish-douyin-image.cjs \
 *     --content /path/to/image-1/
 *
 * 内容目录结构：
 *   title.txt     - 标题（必填）
 *   content.txt   - 文案内容（可选）
 *   tags.txt      - 标签，每行一个或逗号分隔（可选）
 *   image.jpg     - 图片（至少 1 张，支持 image1.jpg...）
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
  IMAGE_PUBLISH_URL,
  findImages,
  readTitle,
  readContent,
  readTags,
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
const SCREENSHOTS_DIR = '/tmp/douyin-image-publish-screenshots';
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
    console.log(`[DY-I]   截图: ${filepath}`);
    return filepath;
  } catch (e) {
    console.error(`[DY-I]   截图失败: ${e.message}`);
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
// SCP：通过 xian-mac 跳板复制图片到 Windows
// ============================================================
function scpImagesToWindows(localImages, windowsDir) {
  console.log(`[DY-I] 0️⃣  SCP 图片到 Windows（通过 ${XIAN_MAC_HOST}）...`);

  const tmpDir = `/tmp/dy-image-upload-${Date.now()}`;

  // 1. 复制到 xian-mac /tmp
  execSync(`ssh ${XIAN_MAC_HOST} "mkdir -p ${tmpDir}"`, { timeout: 10000, stdio: 'pipe' });
  for (const imgPath of localImages) {
    execSync(
      `scp -o StrictHostKeyChecking=no "${imgPath}" "${XIAN_MAC_HOST}:${tmpDir}/"`,
      { timeout: 30000, stdio: 'pipe' }
    );
  }
  console.log(`[DY-I]    图片已复制到 xian-mac:${tmpDir}`);

  // 2. 在 xian-mac 上创建 Windows 目标目录
  const winDirForward = windowsDir.replace(/\\/g, '/');
  execSync(
    `ssh ${XIAN_MAC_HOST} "ssh -i ${XIAN_MAC_SSH_KEY} -o StrictHostKeyChecking=no xuxia@${WINDOWS_IP} 'powershell -command \\"New-Item -ItemType Directory -Force -Path ${winDirForward} | Out-Null; Write-Host ok\\""'"`,
    { timeout: 15000, stdio: 'pipe' }
  );

  // 3. 从 xian-mac SCP 到 Windows
  for (const imgPath of localImages) {
    const fname = path.basename(imgPath);
    execSync(
      `ssh ${XIAN_MAC_HOST} "scp -i ${XIAN_MAC_SSH_KEY} -o StrictHostKeyChecking=no ${tmpDir}/${fname} xuxia@${WINDOWS_IP}:${winDirForward}/${fname}"`,
      { timeout: 30000, stdio: 'pipe' }
    );
  }

  // 4. 清理 xian-mac 临时目录
  execSync(`ssh ${XIAN_MAC_HOST} "rm -rf ${tmpDir}"`, { timeout: 10000, stdio: 'pipe' });
  console.log(`[DY-I]    ✅ ${localImages.length} 张图片已复制到 Windows`);
}

// ============================================================
// 主流程
// ============================================================
async function main(contentDir) {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  console.log('\n[DY-I] ========================================');
  console.log('[DY-I] 抖音图文发布 v1.0');
  console.log('[DY-I] ========================================\n');

  // ── 1. 读取内容目录 ──────────────────────────────────────
  const title = readTitle(contentDir);
  const content = readContent(contentDir);
  const tags = readTags(contentDir);
  const localImages = findImages(contentDir);

  if (!title) {
    console.error('[DY-I] ❌ title.txt 不存在或为空（必填）');
    process.exit(1);
  }
  if (localImages.length === 0) {
    console.error('[DY-I] ❌ 内容目录中未找到图片文件（jpg/png/gif/webp）');
    process.exit(1);
  }

  console.log('[DY-I] 📋 发布内容:');
  console.log(`[DY-I]    标题: ${title}`);
  console.log(`[DY-I]    文案: ${content ? content.substring(0, 50) + '...' : '（无）'}`);
  console.log(`[DY-I]    标签: ${tags.join(', ') || '（无）'}`);
  console.log(`[DY-I]    图片: ${localImages.length} 张`);
  console.log('');

  // ── 2. SCP 图片到 Windows ────────────────────────────────
  const { dateDir, contentDirName } = extractDirNames(contentDir);
  const windowsUploadDir = `${WINDOWS_BASE_DIR}\\${dateDir}\\${contentDirName}`;
  const windowsImages = convertToWindowsPaths(localImages, WINDOWS_BASE_DIR, dateDir, contentDirName);
  scpImagesToWindows(localImages, windowsUploadDir);

  // ── 3. 连接 CDP ──────────────────────────────────────────
  console.log('\n[DY-I] 🔗 连接 CDP...');
  const pagesData = await getCDPPages(WINDOWS_IP, CDP_PORT);
  const targetPage = pagesData.find(
    p => p.type === 'page' && p.url && p.url.includes(DY_DOMAIN)
  ) || pagesData.find(p => p.type === 'page');

  if (!targetPage || !targetPage.webSocketDebuggerUrl) {
    console.error(`[DY-I] ❌ 未找到可用的 Chrome 页面（CDP ${WINDOWS_IP}:${CDP_PORT}）`);
    process.exit(2);
  }

  const cdp = new CDPClient(targetPage.webSocketDebuggerUrl);
  await cdp.connect();
  console.log('[DY-I]    ✅ CDP 已连接\n');

  let publishSuccess = false;
  let itemId = null;

  try {
    await cdp.send('Network.enable');

    // ── 4. 导航到图文发布页 ────────────────────────────────
    console.log('[DY-I] 📍 Step 1: 导航到图文发布页面');
    await cdp.send('Page.navigate', { url: IMAGE_PUBLISH_URL });
    await sleep(3000);

    // 检查是否登录重定向
    const urlResult = await cdp.send('Runtime.evaluate', {
      expression: 'window.location.href',
      returnByValue: true,
    });
    const currentUrl = urlResult.value;
    if (isLoginRedirect(currentUrl)) {
      console.error('[DY-I] ❌ 会话已过期，请重新登录抖音创作者中心');
      console.error(`[DY-I]    当前 URL: ${currentUrl}`);
      cdp.close();
      process.exit(2);
    }

    await screenshot(cdp, '01-publish-page');
    console.log('[DY-I]    ✅ 已导航到图文发布页面\n');

    // ── 5. 上传图片（DOM.setFileInputFiles）────────────────
    console.log(`[DY-I] 📍 Step 2: 上传 ${windowsImages.length} 张图片`);

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
      files: windowsImages,
    });
    console.log(`[DY-I]    ✅ 已注入 ${windowsImages.length} 张图片\n`);

    // ── 6. 等待图片上传及页面跳转 ─────────────────────────
    console.log('[DY-I] ⏳ Step 3: 等待图片上传及页面跳转（45 秒）');
    let uploadDone = false;
    for (let i = 0; i < 9; i++) {
      await sleep(5000);
      const urlRes = await cdp.send('Runtime.evaluate', {
        expression: 'window.location.href',
        returnByValue: true,
      });
      const url = urlRes.value;
      if (url.includes('/content/post/image') || url.includes('type=image')) {
        console.log(`[DY-I]    ✅ 图片上传完成，已跳转: ${url}`);
        uploadDone = true;
        break;
      }
    }
    if (!uploadDone) {
      console.warn('[DY-I]    ⚠️  等待超时，继续尝试填写...');
    }
    await sleep(5000);
    await screenshot(cdp, '03-after-upload');

    // ── 7. 填写标题 ────────────────────────────────────────
    console.log('[DY-I] 📍 Step 4: 填写标题');
    const escapedTitle = escapeForJS(title);
    const titleFilled = await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const input = document.querySelector('input[placeholder*="标题"]');
        if (!input) return { success: false, error: '未找到标题 input' };
        input.focus();
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(input, '${escapedTitle}');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true };
      })()`,
      returnByValue: true,
    });

    if (!titleFilled.result.value?.success) {
      console.warn(`[DY-I]    ⚠️  标题填写失败: ${titleFilled.result.value?.error}`);
    } else {
      console.log('[DY-I]    ✅ 标题已填写\n');
    }

    await sleep(2000);

    // ── 8. 填写文案 ────────────────────────────────────────
    if (content) {
      console.log('[DY-I] 📍 Step 5: 填写文案');
      const escapedContent = escapeForJS(content);
      const contentFilled = await cdp.send('Runtime.evaluate', {
        expression: `(function() {
          const editable = document.querySelector('[contenteditable="true"]');
          if (!editable) return { success: false, error: '未找到文案输入框' };
          editable.focus();
          editable.innerText = '${escapedContent}';
          editable.dispatchEvent(new Event('input', { bubbles: true }));
          return { success: true };
        })()`,
        returnByValue: true,
      });

      if (!contentFilled.result.value?.success) {
        console.warn(`[DY-I]    ⚠️  文案填写失败: ${contentFilled.result.value?.error}`);
      } else {
        console.log('[DY-I]    ✅ 文案已填写\n');
      }
      await sleep(2000);
    }

    await screenshot(cdp, '05-form-filled');

    // ── 9. 点击发布按钮 ────────────────────────────────────
    console.log('[DY-I] 📍 Step 6: 点击发布按钮');
    const clickResult = await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const buttons = Array.from(document.querySelectorAll('button'));
        const publishBtn = buttons.find(b => {
          const text = b.textContent.trim();
          return text === '发布' || text === '提交发布' || text === '立即发布';
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
      throw new Error('未找到发布按钮（发布/提交发布/立即发布）');
    }

    const { x, y, text } = clickResult.result.value;
    console.log(`[DY-I]    点击按钮: "${text}" (${x}, ${y})`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(100);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    console.log('[DY-I]    ✅ 已点击发布\n');

    // ── 10. 等待发布完成 ───────────────────────────────────
    console.log('[DY-I] ⏳ Step 7: 等待发布完成（15 秒）');
    await sleep(15000);

    const finalUrlRes = await cdp.send('Runtime.evaluate', {
      expression: 'window.location.href',
      returnByValue: true,
    });
    const finalUrl = finalUrlRes.value;
    console.log(`[DY-I]    最终 URL: ${finalUrl}`);

    await screenshot(cdp, '06-after-publish');

    if (finalUrl.includes('/content/manage')) {
      publishSuccess = true;
      console.log('\n[DY-I] 🎉 图文发布成功！');
    } else if (
      finalUrl.includes('/content/upload') ||
      finalUrl.includes('/content/post/')
    ) {
      publishSuccess = true;
      console.log('\n[DY-I] 🎉 图文发布成功（URL 已跳转）');
    } else {
      throw new Error(`发布失败，页面未跳转到内容管理（当前: ${finalUrl}）`);
    }

  } catch (error) {
    console.error(`\n[DY-I] ❌ 发布失败: ${error.message}`);
    try { await screenshot(cdp, 'error'); } catch {}
    cdp.close();
    process.exit(2);
  }

  cdp.close();
  if (publishSuccess) {
    console.log('[DY-I] ✅ 全部完成\n');
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
  console.error('[DY-I] 用法: node publish-douyin-image.cjs --content <内容目录>');
  console.error('[DY-I] 内容目录应包含: title.txt (必填), image.jpg (至少1张), content.txt, tags.txt (可选)');
  process.exit(1);
}

if (!fs.existsSync(contentDir)) {
  console.error(`[DY-I] 错误: 内容目录不存在: ${contentDir}`);
  process.exit(1);
}

main(contentDir).catch(err => {
  console.error(`\n[DY-I] 💥 运行失败: ${err.message}`);
  process.exit(2);
});
