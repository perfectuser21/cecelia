#!/usr/bin/env node
/**
 * 小红书视频发布脚本
 *
 * 方案：CDP UI 自动化（与图文方案架构对齐）
 *   - 端口：19225（小红书视频专用 Chrome 实例）
 *   - SCP：通过 xian-mac 跳板复制视频到 Windows
 *   - 流程：导航发布页 → 切换视频 tab → 文件上传 → 填写信息 → 发布
 *
 * 用法：
 *   NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules \
 *     node publish-xiaohongshu-video.cjs \
 *     --video /path/to/video.mp4 \
 *     --title "视频标题" \
 *     [--tags "标签1,标签2"] \
 *     [--cover /path/to/cover.jpg] \
 *     [--dry-run]
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

const { CDPClient } = require('../../weibo-publisher/scripts/cdp-client.cjs');
const { escapeForJS } = require('./utils.cjs');

// ============================================================
// 配置
// ============================================================
const CDP_PORT = 19225;
const WINDOWS_IP = '100.97.242.124';
const XIAN_MAC_HOST = 'xian-mac';
const XIAN_MAC_SSH_KEY = '/Users/jinnuoshengyuan/.ssh/windows_ed';
const SCREENSHOTS_DIR = '/tmp/xiaohongshu-video-publish-screenshots';
const WINDOWS_BASE_DIR = 'C:\\Users\\xuxia\\xiaohongshu-video';
const PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish';
const XHS_DOMAIN = 'creator.xiaohongshu.com';

// ============================================================
// 纯函数（可导出测试）
// ============================================================

function isLoginError(url) {
  if (!url) return false;
  return url.includes('login') || url.includes('passport');
}

function isPublishSuccess(url, bodyText) {
  const successKeywords = ['发布成功', '笔记已发布', '创作成功'];
  const hasKeyword = successKeywords.some(kw => (bodyText || '').includes(kw));
  const urlChanged = url ? !url.includes('/publish/') : false;
  return hasKeyword || urlChanged;
}

// ============================================================
// 工具函数
// ============================================================
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function screenshot(cdp, name) {
  try {
    const result = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 50 });
    const filepath = path.join(SCREENSHOTS_DIR, `${name}.png`);
    fs.writeFileSync(filepath, Buffer.from(result.data, 'base64'));
    console.log(`[XHS-V]  截图: ${filepath}`);
    return filepath;
  } catch (e) {
    console.error(`[XHS-V]  截图失败: ${e.message}`);
    return null;
  }
}

// ============================================================
// SCP：通过 xian-mac 跳板复制文件到 Windows
// ============================================================
function scpFileToWindows(localFilePath, windowsDir) {
  const fileName = path.basename(localFilePath);
  const tmpDir = `/tmp/xhs-video-upload-${Date.now()}`;

  execSync(`ssh ${XIAN_MAC_HOST} "mkdir -p ${tmpDir}"`, { timeout: 10000, stdio: 'pipe' });
  execSync(
    `scp -o StrictHostKeyChecking=no "${localFilePath}" "${XIAN_MAC_HOST}:${tmpDir}/"`,
    { timeout: 120000, stdio: 'pipe' }
  );

  const winDirForward = windowsDir.replace(/\\/g, '/');
  execSync(
    `ssh ${XIAN_MAC_HOST} "ssh -i ${XIAN_MAC_SSH_KEY} -o StrictHostKeyChecking=no xuxia@${WINDOWS_IP} 'powershell -command \\"New-Item -ItemType Directory -Force -Path ${winDirForward} | Out-Null; Write-Host ok\\""'"`,
    { timeout: 15000, stdio: 'pipe' }
  );

  execSync(
    `ssh ${XIAN_MAC_HOST} "scp -i ${XIAN_MAC_SSH_KEY} -o StrictHostKeyChecking=no ${tmpDir}/${fileName} xuxia@${WINDOWS_IP}:${winDirForward}/${fileName}"`,
    { timeout: 120000, stdio: 'pipe' }
  );

  execSync(`ssh ${XIAN_MAC_HOST} "rm -rf ${tmpDir}"`, { timeout: 10000, stdio: 'pipe' });

  return `${windowsDir}\\${fileName}`;
}

// ============================================================
// 主流程
// ============================================================
async function main(videoPath, titleText, tagsText, coverPath, isDryRun) {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  console.log('\n[XHS-V] ========================================');
  console.log('[XHS-V] 小红书视频发布 v1');
  console.log('[XHS-V] ========================================\n');
  console.log(`[XHS-V] 视频文件: ${videoPath}`);
  console.log(`[XHS-V] 标题: ${titleText || '（无）'}`);
  console.log(`[XHS-V] 标签: ${tagsText || '（无）'}`);
  console.log(`[XHS-V] 封面: ${coverPath || '（无）'}`);

  if (isDryRun) {
    console.log('\n[XHS-V] dry-run 模式，跳过 CDP 连接和文件传输');
    return;
  }

  let cdp;
  try {
    // ===== Step 0: SCP 视频到 Windows =====
    console.log('\n[XHS-V] 0️⃣  复制视频到 Windows...');
    const uploadDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const videoName = path.basename(videoPath, path.extname(videoPath));
    const winDir = `${WINDOWS_BASE_DIR}\\${uploadDate}\\${videoName}`;
    const windowsVideo = scpFileToWindows(videoPath, winDir);
    console.log(`[XHS-V]  ✅ 视频已复制到 Windows: ${windowsVideo}`);

    // ===== CDP 连接 =====
    console.log('\n[XHS-V] 连接 CDP...');
    const pagesData = await new Promise((resolve, reject) => {
      http.get(`http://${WINDOWS_IP}:${CDP_PORT}/json`, res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
      }).on('error', err => reject(new Error(`CDP 连接失败 (${WINDOWS_IP}:${CDP_PORT}): ${err.message}`)));
    });

    const xhsPage = pagesData.find(p => p.type === 'page' && p.url.includes(XHS_DOMAIN));
    const targetPage = xhsPage || pagesData.find(p => p.type === 'page');
    if (!targetPage) {
      throw new Error(`未找到浏览器页面，请在 Chrome (端口 ${CDP_PORT}) 中打开 ${PUBLISH_URL}`);
    }

    cdp = new CDPClient(targetPage.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    console.log('[XHS-V] ✅ CDP 已连接\n');

    // ===== Step 1: 导航到发布页 =====
    console.log('[XHS-V] 1️⃣  导航到发布页...');
    await cdp.send('Page.navigate', { url: PUBLISH_URL });
    await sleep(5000);
    await screenshot(cdp, '01-nav');

    const urlRes = await cdp.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
    const currentUrl = urlRes.result.value;
    if (isLoginError(currentUrl)) {
      throw new Error(`小红书未登录，请在 Chrome (${CDP_PORT}) 登录`);
    }
    console.log(`[XHS-V]  URL: ${currentUrl}\n`);

    // ===== Step 2: 切换到视频模式 =====
    console.log('[XHS-V] 2️⃣  切换到视频模式...');
    await sleep(2000);
    await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const all = Array.from(document.querySelectorAll('*'));
        const el = all.find(e => e.textContent.trim() === '视频' && e.offsetParent !== null && e.children.length === 0);
        if (el) { el.click(); return '视频'; }
        const tabs = Array.from(document.querySelectorAll('[role="tab"], .tab, [class*="tab"]'));
        const videoTab = tabs.find(t => t.textContent.includes('视频') && t.offsetParent !== null);
        if (videoTab) { videoTab.click(); return '视频-tab'; }
        return null;
      })()`,
      returnByValue: true
    });
    await sleep(2000);
    await screenshot(cdp, '02-video-mode');

    // ===== Step 3: 上传视频（fileChooser 方案）=====
    console.log('[XHS-V] 3️⃣  上传视频...');

    await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true });

    const fcPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('File chooser timeout 15s')), 15000);
      cdp.on('Page.fileChooserOpened', params => {
        clearTimeout(timer);
        resolve(params);
      });
    });

    const uploadBtnInfo = await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const texts = ['上传视频', '点击上传', '上传', '选择视频', '选择文件'];
        const btns = Array.from(document.querySelectorAll('button, label, div, span'));
        for (const text of texts) {
          const b = btns.find(el => el.textContent.trim() === text && el.offsetParent !== null);
          if (b) {
            const r = b.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text };
          }
        }
        const inp = document.querySelector('input[type="file"][accept*="video"], input[type="file"]');
        if (inp) {
          const parent = inp.closest('label') || inp.closest('div') || inp.parentElement;
          if (parent && parent.offsetParent) {
            const r = parent.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: 'fallback-input-parent' };
          }
        }
        return null;
      })()`,
      returnByValue: true
    });

    if (!uploadBtnInfo.result.value) {
      await screenshot(cdp, '03-no-upload-btn');
      throw new Error('未找到视频上传按钮');
    }

    const { x: ux, y: uy } = uploadBtnInfo.result.value;
    console.log(`[XHS-V]  上传按钮坐标: (${ux}, ${uy})，text: ${uploadBtnInfo.result.value.text}`);

    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ux, y: uy, button: 'left', clickCount: 1 });
    await sleep(100);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ux, y: uy, button: 'left', clickCount: 1 });

    const fc = await fcPromise;
    console.log(`[XHS-V]  文件选择器 backendNodeId: ${fc.backendNodeId}`);

    await cdp.send('DOM.setFileInputFiles', { backendNodeId: fc.backendNodeId, files: [windowsVideo] });
    await cdp.send('Page.setInterceptFileChooserDialog', { enabled: false });

    // 等待视频上传完成（最多 5 分钟）
    console.log('[XHS-V]  等待视频上传和处理...');
    for (let i = 0; i < 300; i++) {
      await sleep(1000);
      const r = await cdp.send('Runtime.evaluate', {
        expression: `(function() {
          const body = document.body.innerHTML;
          return body.includes('添加标题') || body.includes('写点什么') ||
                 body.includes('填写标题') || body.includes('发布笔记') ||
                 document.querySelector('input[placeholder*="标题"]') !== null ||
                 document.querySelector('div[contenteditable="true"]') !== null;
        })()`,
        returnByValue: true
      });
      if (r.result.value) {
        console.log(`[XHS-V]  视频上传完成（${i}s）`);
        break;
      }
      if (i > 0 && i % 30 === 0) {
        console.log(`[XHS-V]  ... 上传中 ${i}s`);
        await screenshot(cdp, `03-uploading-${i}s`);
      }
    }
    await screenshot(cdp, '03-uploaded');

    // ===== Step 4: 填写标题 =====
    if (titleText) {
      console.log('[XHS-V] 4️⃣  填写标题...');
      const escapedTitle = escapeForJS(titleText);
      const titleResult = await cdp.send('Runtime.evaluate', {
        expression: `(function() {
          const sels = [
            'input[placeholder*="标题"]',
            'input[placeholder*="填写标题"]',
            'input[class*="title"]',
            'input[maxlength="20"]',
            'input[maxlength="50"]',
            'input[maxlength="100"]'
          ];
          for (const s of sels) {
            const el = document.querySelector(s);
            if (el && el.offsetParent) {
              el.focus();
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
              setter.call(el, '${escapedTitle}');
              el.dispatchEvent(new Event('input', { bubbles: true }));
              return true;
            }
          }
          return false;
        })()`,
        returnByValue: true
      });
      if (titleResult.result.value) {
        console.log('[XHS-V]  标题已填写');
      } else {
        console.warn('[XHS-V]  ⚠️  未找到标题输入框');
      }
      await sleep(500);
    }

    // ===== Step 5: 填写标签（以 #tag 形式插入内容区）=====
    if (tagsText) {
      console.log('[XHS-V] 5️⃣  填写标签...');
      const tags = tagsText.split(',').map(t => t.trim()).filter(Boolean);
      const hashTags = tags.map(t => (t.startsWith('#') ? t : `#${t}`)).join(' ');

      const contentAreaInfo = await cdp.send('Runtime.evaluate', {
        expression: `(function() {
          const sels = [
            'div[contenteditable="true"][class*="content"]',
            'div[contenteditable="true"][class*="desc"]',
            'div[contenteditable="true"][class*="editor"]',
            '.ql-editor',
            'div[contenteditable="true"]',
            'textarea'
          ];
          for (const s of sels) {
            const el = document.querySelector(s);
            if (el && el.offsetParent) {
              const r = el.getBoundingClientRect();
              return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), sel: s };
            }
          }
          return null;
        })()`,
        returnByValue: true
      });

      if (contentAreaInfo.result.value) {
        const { x: cx, y: cy } = contentAreaInfo.result.value;
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
        await sleep(100);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 });
        await sleep(200);
        await cdp.send('Input.insertText', { text: hashTags });
        await sleep(500);
        console.log(`[XHS-V]  标签已填写: ${hashTags}`);
      } else {
        console.warn('[XHS-V]  ⚠️  未找到内容区域，跳过标签填写');
      }
      await screenshot(cdp, '05-tags');
    }

    // ===== Step 6: 上传封面（可选）=====
    if (coverPath && fs.existsSync(coverPath)) {
      console.log('[XHS-V] 6️⃣  上传封面...');
      try {
        const uploadDate2 = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const videoName2 = path.basename(videoPath, path.extname(videoPath));
        const winCoverDir = `${WINDOWS_BASE_DIR}\\${uploadDate2}\\${videoName2}`;
        const windowsCover = scpFileToWindows(coverPath, winCoverDir);

        await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true });

        const coverFcPromise = new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Cover file chooser timeout 10s')), 10000);
          cdp.on('Page.fileChooserOpened', params => {
            clearTimeout(timer);
            resolve(params);
          });
        });

        const coverBtnInfo = await cdp.send('Runtime.evaluate', {
          expression: `(function() {
            const texts = ['更换封面', '选择封面', '封面'];
            const all = Array.from(document.querySelectorAll('*'));
            for (const text of texts) {
              const el = all.find(e => e.textContent.trim() === text && e.offsetParent !== null);
              if (el) {
                const r = el.getBoundingClientRect();
                return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text };
              }
            }
            return null;
          })()`,
          returnByValue: true
        });

        if (coverBtnInfo.result.value) {
          const { x: bx, y: by } = coverBtnInfo.result.value;
          await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: bx, y: by, button: 'left', clickCount: 1 });
          await sleep(100);
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bx, y: by, button: 'left', clickCount: 1 });
          const coverFc = await coverFcPromise;
          await cdp.send('DOM.setFileInputFiles', { backendNodeId: coverFc.backendNodeId, files: [windowsCover] });
          await cdp.send('Page.setInterceptFileChooserDialog', { enabled: false });
          await sleep(3000);
          console.log('[XHS-V]  封面已上传');
          await screenshot(cdp, '06-cover');
        } else {
          await cdp.send('Page.setInterceptFileChooserDialog', { enabled: false });
          console.warn('[XHS-V]  ⚠️  未找到封面上传按钮，跳过封面设置');
        }
      } catch (e) {
        console.warn(`[XHS-V]  ⚠️  封面上传失败（降级跳过）: ${e.message}`);
      }
    }

    // ===== Step 7: 点击发布 =====
    console.log('[XHS-V] 7️⃣  点击发布...');
    await sleep(1000);
    await screenshot(cdp, '07-before-pub');

    const publishRes = await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node, last = null;
        while (node = walker.nextNode()) {
          if (node.textContent.trim() === '发布') {
            const el = node.parentElement;
            if (el.offsetParent !== null && !el.hasAttribute('disabled')) last = el;
          }
        }
        if (last) {
          last.scrollIntoView({ behavior: 'instant', block: 'center' });
          const r = last.getBoundingClientRect();
          return { found: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        }
        return { found: false };
      })()`,
      returnByValue: true
    });

    if (!publishRes.result.value?.found) {
      await screenshot(cdp, '07-no-pub-btn');
      throw new Error('未找到发布按钮');
    }

    const { x: px, y: py } = publishRes.result.value;
    await sleep(300);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: px, y: py, button: 'left', clickCount: 1 });
    await sleep(100);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: px, y: py, button: 'left', clickCount: 1 });
    await sleep(5000);
    await screenshot(cdp, '07-after-pub');

    // ===== Step 8: 验证结果 =====
    const finalUrlRes = await cdp.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
    const finalUrl = finalUrlRes.result.value;
    const bodyRes = await cdp.send('Runtime.evaluate', {
      expression: 'document.body.textContent.slice(0, 500)',
      returnByValue: true
    });
    const bodyText = bodyRes.result.value;

    if (isPublishSuccess(finalUrl, bodyText)) {
      console.log('\n[XHS-V] ✅ 发布成功！');
      console.log(`[XHS-V]  最终 URL: ${finalUrl}`);
    } else {
      console.log('\n[XHS-V] ⚠️  发布状态不确定，请查看截图');
    }
    console.log(`[XHS-V]  截图目录: ${SCREENSHOTS_DIR}`);

  } catch (err) {
    console.error(`\n[XHS-V] ❌ 发布失败: ${err.message}`);
    if (cdp) await screenshot(cdp, 'error').catch(() => {});
    process.exit(1);
  } finally {
    if (cdp) cdp.close();
  }
}

// ============================================================
// CLI 入口
// ============================================================
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log('用法：node publish-xiaohongshu-video.cjs --video /path/to/video.mp4 --title "标题"');
    console.log('选项：');
    console.log('  --video <path>    视频文件路径（必须）');
    console.log('  --title <text>    视频标题');
    console.log('  --tags <list>     标签，逗号分隔（如 "美食,旅行"）');
    console.log('  --cover <path>    封面图片路径（可选）');
    console.log('  --dry-run         仅打印参数，不连接 CDP');
    process.exit(0);
  }

  const isDryRun = args.includes('--dry-run');

  const videoIdx = args.indexOf('--video');
  if (videoIdx < 0 || !args[videoIdx + 1]) {
    console.error('❌ 必须提供 --video 参数');
    process.exit(1);
  }

  const videoPath = path.resolve(args[videoIdx + 1]);
  if (!isDryRun && !fs.existsSync(videoPath)) {
    console.error(`❌ 视频文件不存在: ${videoPath}`);
    process.exit(1);
  }

  const titleIdx = args.indexOf('--title');
  const titleText = titleIdx >= 0 ? args[titleIdx + 1] || '' : '';

  const tagsIdx = args.indexOf('--tags');
  const tagsText = tagsIdx >= 0 ? args[tagsIdx + 1] || '' : '';

  const coverIdx = args.indexOf('--cover');
  const coverPath = coverIdx >= 0 ? args[coverIdx + 1] || '' : '';

  main(videoPath, titleText, tagsText, coverPath, isDryRun).catch(err => {
    console.error(`\n[XHS-V] ❌ ${err.message}`);
    process.exit(1);
  });
}

module.exports = { isLoginError, isPublishSuccess };
