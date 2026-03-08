#!/usr/bin/env node
/**
 * 小红书图文发布脚本
 *
 * 功能：发布图文内容（标题 + 文字 + 图片）
 * 用法：node publish-xhs-image.cjs --content /path/to/image-{id}/
 *
 * 内容目录结构：
 *   title.txt     - 标题（必需，小红书要求）
 *   content.txt   - 正文内容（可选，支持话题 #xxx#）
 *   image.jpg     - 图片（支持 image1.jpg, image2.jpg 等）
 *
 * 环境要求：
 *   NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules
 */

'use strict';

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CDP_PORT = 19224;
const WINDOWS_IP = '100.97.242.124';
const SCREENSHOTS_DIR = '/tmp/xhs-publish-screenshots';
const WINDOWS_BASE_DIR = 'C:\\Users\\xuxia\\xhs-media';
const PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish';

// 创建截图目录
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

// 命令行参数解析
const args = process.argv.slice(2);
const contentDirArg = args[args.indexOf('--content') + 1];

if (!contentDirArg || !fs.existsSync(contentDirArg)) {
  console.error('错误：必须提供有效的内容目录路径');
  console.error('使用方式：node publish-xhs-image.cjs --content /path/to/image-xxx/');
  process.exit(1);
}

const contentDir = path.resolve(contentDirArg);

// 读取内容
const titleFile = path.join(contentDir, 'title.txt');
const titleText = fs.existsSync(titleFile)
  ? fs.readFileSync(titleFile, 'utf8').trim()
  : '';

const contentFile = path.join(contentDir, 'content.txt');
const contentText = fs.existsSync(contentFile)
  ? fs.readFileSync(contentFile, 'utf8').trim()
  : '';

// 收集图片文件
function findImages(dir) {
  const files = fs.readdirSync(dir);
  const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  return files
    .filter(f => imageExts.some(ext => f.toLowerCase().endsWith(ext)))
    .sort()
    .map(f => path.join(dir, f));
}

const localImages = findImages(contentDir);
if (localImages.length === 0) {
  console.error('错误：内容目录中没有图片文件');
  process.exit(1);
}

// 转换图片路径为 Windows 绝对路径
const dateDir = path.basename(path.dirname(contentDir));
const contentDirName = path.basename(contentDir);
const windowsImages = localImages.map(img => {
  const filename = path.basename(img);
  return path.join(WINDOWS_BASE_DIR, dateDir, contentDirName, filename).replace(/\//g, '\\');
});

console.log('\n========================================');
console.log('小红书图文发布');
console.log('========================================\n');
console.log('内容目录: ' + contentDir);
console.log('标题长度: ' + titleText.length + ' 字符');
console.log('正文长度: ' + contentText.length + ' 字符');
console.log('图片数量: ' + localImages.length);
if (windowsImages.length > 0) {
  console.log('Windows 路径: ' + windowsImages[0]);
}
console.log('');

// CDP 客户端
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
          reject(new Error('CDP timeout: ' + method));
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

// 工具函数
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeForJS(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/`/g, '\\`')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

async function screenshot(cdp, name) {
  try {
    const result = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const filename = path.join(SCREENSHOTS_DIR, name + '-' + Date.now() + '.png');
    fs.writeFileSync(filename, Buffer.from(result.data, 'base64'));
    console.log('   截图: ' + filename);
  } catch (e) {
    console.warn('   截图失败: ' + e.message);
  }
}

// 获取 CDP WebSocket URL
async function getCDPUrl() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: WINDOWS_IP,
      port: CDP_PORT,
      path: '/json',
      method: 'GET',
      timeout: 10000,
    };

    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const pages = JSON.parse(data);
          const page = pages.find(p => p.type === 'page' && !p.url.includes('devtools'));
          if (!page) {
            reject(new Error('未找到可用的页面（小红书浏览器可能未打开）'));
            return;
          }
          resolve(page.webSocketDebuggerUrl);
        } catch (e) {
          reject(new Error('解析 CDP 响应失败: ' + e.message));
        }
      });
    });

    req.on('error', e => reject(new Error('CDP 连接失败 (' + WINDOWS_IP + ':' + CDP_PORT + '): ' + e.message)));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('CDP 连接超时 (' + WINDOWS_IP + ':' + CDP_PORT + ')'));
    });
    req.end();
  });
}

async function main() {
  let cdp = null;

  try {
    // 步骤1: 连接 CDP
    console.log('1. 连接到 Windows PC 浏览器（小红书）...\n');

    const wsUrl = await getCDPUrl();
    console.log('   WebSocket URL: ' + wsUrl + '\n');

    cdp = new CDPClient(wsUrl);
    await cdp.connect();
    console.log('   CDP 连接成功\n');

    await cdp.send('Page.enable');

    // 步骤2: 导航到发布页面
    console.log('2. 导航到小红书发布页面...\n');

    const currentUrl = await cdp.send('Runtime.evaluate', {
      expression: 'window.location.href',
      returnByValue: true,
    });
    console.log('   当前 URL: ' + currentUrl.result.value + '\n');

    if (!currentUrl.result.value.includes('creator.xiaohongshu.com/publish')) {
      await cdp.send('Page.navigate', { url: PUBLISH_URL });
      await sleep(4000);
      console.log('   已导航到发布页面\n');
    } else {
      console.log('   已在发布页面\n');
    }

    await screenshot(cdp, '01-publish-page');
    await sleep(2000);

    // 步骤3: 选择图文类型
    console.log('3. 选择图文发布类型...\n');

    const typeResult = await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const selectors = [
          '[class*="tab"][class*="image"]',
          '[class*="image-text"]',
          'div[data-type="image"]',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.offsetWidth > 0) {
            el.click();
            return { clicked: true, selector: sel };
          }
        }
        const tabs = Array.from(document.querySelectorAll('[class*="tab"], [role="tab"], button'));
        const imageTab = tabs.find(t => t.textContent && t.textContent.trim().includes('图文') && t.offsetWidth > 0);
        if (imageTab) {
          imageTab.click();
          return { clicked: true, text: imageTab.textContent.trim() };
        }
        return { clicked: false, note: '未找到图文类型按钮（可能已默认选中）' };
      })()`,
      returnByValue: true,
    });
    console.log('   类型选择: ' + JSON.stringify(typeResult.result.value) + '\n');
    await sleep(2000);
    await screenshot(cdp, '02-type-selected');

    // 步骤4: 上传图片
    console.log('4. 上传图片（' + windowsImages.length + ' 张）...\n');

    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector: 'input[type="file"]',
    });

    console.log('   找到 ' + nodeIds.length + ' 个 file input\n');

    if (nodeIds.length === 0) {
      console.log('   尝试点击上传区域...\n');
      await cdp.send('Runtime.evaluate', {
        expression: `(function() {
          const selectors = [
            '[class*="upload"]',
            '[class*="add-image"]',
            '[class*="img-add"]',
            '.upload-btn',
            'label[class*="upload"]',
          ];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.offsetWidth > 0) {
              el.click();
              return { clicked: true, selector: sel };
            }
          }
          const els = Array.from(document.querySelectorAll('button, label, div[role="button"]'));
          const uploadEl = els.find(e =>
            e.textContent && (e.textContent.includes('上传') || e.textContent.includes('添加图片')) &&
            e.offsetWidth > 0
          );
          if (uploadEl) {
            uploadEl.click();
            return { clicked: true, text: uploadEl.textContent.trim() };
          }
          return { clicked: false };
        })()`,
      });
      await sleep(2000);

      const { root: root2 } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
      const { nodeIds: nodeIds2 } = await cdp.send('DOM.querySelectorAll', {
        nodeId: root2.nodeId,
        selector: 'input[type="file"]',
      });
      nodeIds.push(...nodeIds2);
    }

    if (nodeIds.length > 0) {
      console.log('   设置图片文件...\n');
      await cdp.send('DOM.setFileInputFiles', {
        nodeId: nodeIds[0],
        files: windowsImages,
      });

      await cdp.send('Runtime.evaluate', {
        expression: `(function() {
          const inputs = document.querySelectorAll('input[type="file"]');
          if (inputs[0]) inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
        })()`,
      });

      await sleep(8000);
      await screenshot(cdp, '04-images-uploaded');
      console.log('   图片已上传\n');
    } else {
      await screenshot(cdp, '04-no-file-input');
      throw new Error('未找到文件上传输入框，无法上传图片（页面可能未加载完成）');
    }

    // 步骤5: 填写标题
    if (titleText) {
      console.log('5. 填写标题（' + titleText.length + ' 字符）...\n');
      const escapedTitle = escapeForJS(titleText);

      const titleResult = await cdp.send('Runtime.evaluate', {
        expression: `(function() {
          const selectors = [
            'input[placeholder*="标题"]',
            'input[class*="title"]',
            '[class*="title-input"] input',
            '[class*="note-title"] input',
            'input[maxlength]',
          ];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.offsetWidth > 0) {
              el.focus();
              el.value = '` + escapedTitle + `';
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return { success: true, selector: sel };
            }
          }
          return { success: false, error: '未找到标题输入框' };
        })()`,
        returnByValue: true,
      });

      console.log('   标题填写: ' + JSON.stringify(titleResult.result.value) + '\n');
      await sleep(1000);
      await screenshot(cdp, '05-title-filled');
    } else {
      console.log('5. 跳过标题（无标题内容）\n');
    }

    // 步骤6: 填写正文
    if (contentText) {
      console.log('6. 填写正文（' + contentText.length + ' 字符）...\n');
      const escapedContent = escapeForJS(contentText);

      const contentResult = await cdp.send('Runtime.evaluate', {
        expression: `(function() {
          const selectors = [
            '[class*="content"] [contenteditable="true"]',
            '[class*="note-content"] [contenteditable]',
            '[class*="desc"] [contenteditable]',
            '.ql-editor',
            '[contenteditable="true"]',
          ];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.offsetWidth > 0) {
              el.focus();
              el.innerText = '` + escapedContent + `';
              el.dispatchEvent(new Event('input', { bubbles: true }));
              return { success: true, selector: sel };
            }
          }
          return { success: false, error: '未找到正文输入区域' };
        })()`,
        returnByValue: true,
      });

      console.log('   正文填写: ' + JSON.stringify(contentResult.result.value) + '\n');
      await sleep(1000);
      await screenshot(cdp, '06-content-filled');
    } else {
      console.log('6. 跳过正文（无正文内容）\n');
    }

    // 步骤7: 点击发布
    console.log('7. 点击发布...\n');

    const publishResult = await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
        const publishBtn = buttons.find(b =>
          b.textContent &&
          (b.textContent.trim() === '发布' || b.textContent.trim() === '立即发布') &&
          b.offsetWidth > 0 &&
          !b.disabled
        );
        if (publishBtn) {
          publishBtn.click();
          return { clicked: true, text: publishBtn.textContent.trim() };
        }
        const anyPublishBtn = buttons.find(b =>
          b.textContent && b.textContent.includes('发布') &&
          b.offsetWidth > 0 && !b.disabled
        );
        if (anyPublishBtn) {
          anyPublishBtn.click();
          return { clicked: true, text: anyPublishBtn.textContent.trim(), fuzzy: true };
        }
        return { clicked: false, error: '未找到发布按钮' };
      })()`,
      returnByValue: true,
    });

    console.log('   发布按钮: ' + JSON.stringify(publishResult.result.value) + '\n');
    await sleep(4000);
    await screenshot(cdp, '07-publish-clicked');

    await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const buttons = Array.from(document.querySelectorAll('button'));
        const confirmBtn = buttons.find(b =>
          b.textContent && (b.textContent.includes('确认') || b.textContent.includes('确定')) &&
          b.offsetWidth > 0 && !b.disabled
        );
        if (confirmBtn) { confirmBtn.click(); return { confirmed: true }; }
        return { confirmed: false };
      })()`,
    });

    await sleep(3000);

    // 步骤8: 验证结果
    console.log('8. 验证发布结果...\n');

    const finalUrl = await cdp.send('Runtime.evaluate', {
      expression: 'window.location.href',
      returnByValue: true,
    });
    const finalUrlValue = finalUrl.result.value;
    console.log('   最终 URL: ' + finalUrlValue + '\n');

    await screenshot(cdp, '08-final');

    const successCheck = await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const body = document.body.textContent || '';
        return {
          hasSuccess: body.includes('发布成功') || body.includes('发表成功') || body.includes('上传成功'),
          navigated: !window.location.href.includes('publish/publish'),
        };
      })()`,
      returnByValue: true,
    });
    const successVal = successCheck.result.value;

    // 标记完成
    const doneFile = path.join(contentDir, 'done.txt');
    fs.writeFileSync(doneFile, '发布时间: ' + new Date().toISOString() + '\n最终URL: ' + finalUrlValue + '\n');

    if (successVal.hasSuccess || successVal.navigated) {
      console.log('\n========== 小红书发布成功 ==========\n');
      console.log('截图目录: ' + SCREENSHOTS_DIR + '\n');
      cdp.close();
      process.exit(0);
    }

    console.log('   无法确认发布状态，请查看截图确认\n');
    console.log('截图目录: ' + SCREENSHOTS_DIR + '\n');
    cdp.close();
    process.exit(0);

  } catch (err) {
    console.error('\n========== 发布失败 ==========\n');
    console.error(err.message);
    console.error('');

    if (cdp) {
      await screenshot(cdp, 'error-state').catch(() => {});
      cdp.close();
    }

    process.exit(1);
  }
}

main();
