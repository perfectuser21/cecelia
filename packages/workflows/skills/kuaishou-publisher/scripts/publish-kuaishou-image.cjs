#!/usr/bin/env node
/**
 * 快手图文发布脚本
 *
 * 功能：发布图文内容（文字 + 图片）
 * 用法：node publish-kuaishou-image.cjs --content /path/to/image-{id}/
 *
 * 内容目录结构：
 *   content.txt   - 文案内容（可选）
 *   image.jpg     - 图片（支持 image1.jpg, image2.jpg 等）
 *
 * 环境要求：
 *   NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const {
  PUBLISH_URLS,
  findImages,
  readContent,
  convertToWindowsPaths,
  escapeForJS,
  extractDirNames,
  isLoginRedirect,
  isPublishPageReached,
} = require('./utils.cjs');

const CDP_PORT = 19223;
const WINDOWS_IP = '100.97.242.124';
const SCREENSHOTS_DIR = '/tmp/kuaishou-publish-screenshots';
const WINDOWS_BASE_DIR = 'C:\\Users\\xuxia\\kuaishou-media';

// 创建截图目录
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

// 命令行参数解析
const args = process.argv.slice(2);
const contentDirArg = args[args.indexOf('--content') + 1];

if (!contentDirArg || !fs.existsSync(contentDirArg)) {
  console.error('❌ 错误：必须提供有效的内容目录路径');
  console.error('使用方式：node publish-kuaishou-image.cjs --content /path/to/image-xxx/');
  process.exit(1);
}

const contentDir = path.resolve(contentDirArg);
const contentText = readContent(contentDir);
const localImages = findImages(contentDir);

if (localImages.length === 0) {
  console.error('❌ 错误：内容目录中没有图片文件');
  process.exit(1);
}

const { dateDir, contentDirName } = extractDirNames(contentDir);
const windowsImages = convertToWindowsPaths(localImages, WINDOWS_BASE_DIR, dateDir, contentDirName);

console.log('\n========================================');
console.log('快手图文发布');
console.log('========================================\n');
console.log(`📁 内容目录: ${contentDir}`);
console.log(`📝 文案长度: ${contentText.length} 字符`);
console.log(`🖼️  图片数量: ${localImages.length}`);
if (windowsImages.length > 0) {
  console.log(`📁 Windows 路径: ${windowsImages[0]}`);
}
console.log('');

// CDP 客户端
class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 0;
    this.callbacks = {};
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
      });
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.callbacks[id] = msg => {
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      };
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.callbacks[id]) {
          delete this.callbacks[id];
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 60000);
    });
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function screenshot(cdp, name) {
  try {
    const result = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const filepath = path.join(SCREENSHOTS_DIR, `${name}.png`);
    fs.writeFileSync(filepath, Buffer.from(result.data, 'base64'));
    console.log(`   📸 ${filepath}`);
  } catch (e) {
    console.error(`   ❌ 截图失败: ${e.message}`);
  }
}

async function navigateToPublishPage(cdp) {
  for (const targetUrl of PUBLISH_URLS) {
    console.log(`   尝试导航到: ${targetUrl}`);
    await cdp.send('Page.navigate', { url: targetUrl });
    await sleep(5000);

    const urlResult = await cdp.send('Runtime.evaluate', {
      expression: 'window.location.href',
      returnByValue: true,
    });
    const currentUrl = urlResult.result.value;
    console.log(`   当前 URL: ${currentUrl}`);

    if (isLoginRedirect(currentUrl)) {
      console.error('\n[SESSION_EXPIRED] 快手会话已过期，需要重新登录');
      console.error(`重定向到: ${currentUrl}`);
      throw new Error('[SESSION_EXPIRED] 快手 OAuth 会话已过期，请重新登录创作者中心');
    }

    if (isPublishPageReached(currentUrl, targetUrl)) {
      console.log(`   ✅ 成功到达发布页面\n`);
      return currentUrl;
    }

    console.log(`   ⚠️  URL 不匹配，尝试下一个候选 URL...`);
  }

  // 所有候选 URL 均失败，取当前 URL 做最后检查
  const urlResult = await cdp.send('Runtime.evaluate', {
    expression: 'window.location.href',
    returnByValue: true,
  });
  const currentUrl = urlResult.result.value;

  if (isLoginRedirect(currentUrl)) {
    console.error('\n[SESSION_EXPIRED] 快手会话已过期，需要重新登录');
    throw new Error('[SESSION_EXPIRED] 快手 OAuth 会话已过期，请重新登录创作者中心');
  }

  throw new Error(`所有候选发布 URL 均导航失败，当前页面: ${currentUrl}`);
}

async function main() {
  let cdp;

  try {
    // 获取 CDP 连接
    console.log('🔌 连接 CDP...\n');
    const pagesData = await new Promise((resolve, reject) => {
      http.get(`http://${WINDOWS_IP}:${CDP_PORT}/json`, res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });

    // 找到快手页面
    const kuaishouPage = pagesData.find(
      p => p.type === 'page' && p.url.includes('kuaishou.com')
    );
    if (!kuaishouPage) {
      // 如果没有快手页面，使用第一个可用页面
      const firstPage = pagesData.find(p => p.type === 'page');
      if (!firstPage) throw new Error('未找到任何浏览器页面');
      console.log(`   ⚠️  未找到快手页面，使用: ${firstPage.url}`);
      cdp = new CDPClient(firstPage.webSocketDebuggerUrl);
    } else {
      cdp = new CDPClient(kuaishouPage.webSocketDebuggerUrl);
    }

    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    console.log('✅ CDP 已连接\n');

    // ========== 步骤1: 导航到图文发布页（多 URL 降级 + OAuth 检测）==========
    console.log('1️⃣  导航到快手图文发布页...\n');
    await screenshot(cdp, '01-initial');
    await navigateToPublishPage(cdp);

    // ========== 步骤2: 填写文案 ==========
    if (contentText) {
      console.log('2️⃣  填写文案...\n');

      const escapedContent = escapeForJS(contentText);

      const fillResult = await cdp.send('Runtime.evaluate', {
        expression: `(function() {
          // 尝试找到文案输入区域（快手图文发布页）
          const selectors = [
            'textarea[placeholder*="文案"]',
            'textarea[placeholder*="输入"]',
            'div[contenteditable="true"]',
            '.ql-editor',
            'textarea'
          ];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.offsetWidth > 0) {
              el.focus();
              if (el.tagName === 'TEXTAREA') {
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                  window.HTMLTextAreaElement.prototype, 'value'
                ).set;
                nativeInputValueSetter.call(el, '${escapedContent}');
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              } else {
                el.innerText = '${escapedContent}';
                el.dispatchEvent(new Event('input', { bubbles: true }));
              }
              return { success: true, selector: sel };
            }
          }
          return { success: false, error: '未找到文案输入区域' };
        })()`,
        returnByValue: true
      });

      const fillVal = fillResult.result.value;
      console.log(`   填写结果: ${JSON.stringify(fillVal)}`);
      await sleep(1000);
      await screenshot(cdp, '02-content-filled');

      if (fillVal && fillVal.success) {
        console.log(`   ✅ 已填写 ${contentText.length} 字\n`);
      } else {
        console.log('   ⚠️  文案填写可能未成功，继续上传图片...\n');
      }
    } else {
      console.log('2️⃣  跳过文案（无文案内容）\n');
    }

    // ========== 步骤3: 上传图片 ==========
    console.log(`3️⃣  上传图片（${windowsImages.length} 张）...\n`);

    // 查找 file input
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector: 'input[type="file"]'
    });

    console.log(`   找到 ${nodeIds.length} 个 file input\n`);

    if (nodeIds.length === 0) {
      // 尝试点击上传按钮触发 file input 出现
      console.log('   尝试点击上传按钮...\n');
      await cdp.send('Runtime.evaluate', {
        expression: `(function() {
          const selectors = [
            'button[class*="upload"]',
            'div[class*="upload"]',
            '.upload-btn',
            '[class*="add-image"]',
            '[class*="add-photo"]'
          ];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.offsetWidth > 0) {
              el.click();
              return { clicked: true, selector: sel };
            }
          }
          // 尝试找带"上传"文字的按钮
          const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
          const uploadBtn = buttons.find(b =>
            b.textContent && (b.textContent.includes('上传') || b.textContent.includes('添加')) &&
            b.offsetWidth > 0
          );
          if (uploadBtn) {
            uploadBtn.click();
            return { clicked: true, text: uploadBtn.textContent.trim() };
          }
          return { clicked: false };
        })()`
      });
      await sleep(2000);

      // 再次查找 file input
      const { root: root2 } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
      const { nodeIds: nodeIds2 } = await cdp.send('DOM.querySelectorAll', {
        nodeId: root2.nodeId,
        selector: 'input[type="file"]'
      });
      nodeIds.push(...nodeIds2);
    }

    if (nodeIds.length > 0) {
      console.log('   设置图片文件...\n');
      await cdp.send('DOM.setFileInputFiles', {
        nodeId: nodeIds[0],
        files: windowsImages
      });

      // 触发 change 事件
      await cdp.send('Runtime.evaluate', {
        expression: `(function() {
          const inputs = document.querySelectorAll('input[type="file"]');
          if (inputs[0]) {
            inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
          }
        })()`
      });

      await sleep(6000);
      await screenshot(cdp, '03-images-uploaded');
      console.log('   ✅ 图片已上传\n');
    } else {
      await screenshot(cdp, '03-no-file-input');
      throw new Error('未找到文件上传输入框，无法上传图片（页面可能未加载完成或结构已变更）');
    }

    // ========== 步骤4: 发布 ==========
    console.log('4️⃣  点击发布...\n');

    const publishResult = await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const buttons = Array.from(document.querySelectorAll('button'));
        const publishBtn = buttons.find(b =>
          b.textContent && b.textContent.includes('发布') &&
          b.offsetWidth > 0 &&
          !b.disabled
        );
        if (publishBtn) {
          publishBtn.click();
          return { clicked: true, text: publishBtn.textContent.trim() };
        }
        return { clicked: false, error: '未找到发布按钮' };
      })()`,
      returnByValue: true
    });

    console.log(`   发布按钮: ${JSON.stringify(publishResult.result.value)}`);
    await sleep(3000);
    await screenshot(cdp, '04-publish-clicked');

    // 处理可能的确认弹窗
    await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const buttons = Array.from(document.querySelectorAll('button'));
        const confirmBtn = buttons.find(b =>
          b.textContent && (b.textContent.includes('确认') || b.textContent.includes('确定')) &&
          b.offsetWidth > 0 &&
          !b.disabled
        );
        if (confirmBtn) {
          confirmBtn.click();
          return { confirmed: true };
        }
        return { confirmed: false };
      })()`
    });

    await sleep(3000);

    // ========== 步骤5: 验证结果 ==========
    console.log('5️⃣  验证发布结果...\n');

    const finalUrl = await cdp.send('Runtime.evaluate', {
      expression: 'window.location.href',
      returnByValue: true
    });
    const finalUrlValue = finalUrl.result.value;
    console.log(`   最终 URL: ${finalUrlValue}\n`);

    await screenshot(cdp, '05-final');

    // 检查是否有成功提示
    const successCheck = await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const body = document.body.textContent || '';
        return {
          hasSuccess: body.includes('发布成功') || body.includes('发表成功') || body.includes('上传成功'),
          navigated: !window.location.href.includes('publish')
        };
      })()`,
      returnByValue: true
    });
    const successVal = successCheck.result.value;

    if (successVal.hasSuccess || successVal.navigated) {
      console.log('\n========== ✅ 发布成功 ==========\n');
      console.log(`截图目录: ${SCREENSHOTS_DIR}\n`);
      await cdp.close();
      process.exit(0);
    }

    console.log('   ⚠️  无法确认发布状态，请手动检查\n');
    console.log(`截图目录: ${SCREENSHOTS_DIR}\n`);
    await cdp.close();
    process.exit(0);

  } catch (err) {
    console.error('\n========== ❌ 发布失败 ==========\n');
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
