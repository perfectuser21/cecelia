#!/usr/bin/env node
/**
 * 小红书图文发布脚本
 *
 * 功能：发布图文笔记（文字 + 图片），通过 CDP 控制 Windows PC Chrome
 * 用法：node publish-xiaohongshu-image.cjs --content /path/to/image-{id}/
 *
 * 内容目录结构：
 *   content.txt   - 笔记正文（可选，支持话题 #xxx# 格式）
 *   title.txt     - 笔记标题（可选，不超过 20 字，无则用正文前 20 字）
 *   image.jpg     - 图片（支持 image1.jpg, image2.jpg 等，最多 9 张）
 *
 * 环境要求：
 *   NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const { CDPClient } = require('../../weibo-publisher/scripts/cdp-client.cjs');
const { findImages: findImagesUtil } = require('../../weibo-publisher/scripts/utils.cjs');

const CDP_PORT = 19225;
const WINDOWS_IP = '100.97.242.124';
const SCREENSHOTS_DIR = '/tmp/xiaohongshu-publish-screenshots';
const WINDOWS_BASE_DIR = 'C:\\Users\\xuxia\\xiaohongshu-media';
const PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish';
const XHS_DOMAIN = 'creator.xiaohongshu.com';

// 创建截图目录
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

// ============================================================
// 命令行参数解析
// ============================================================
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log('用法：node publish-xiaohongshu-image.cjs --content /path/to/image-xxx/');
  console.log('');
  console.log('选项：');
  console.log('  --content <dir>   图文目录（必须包含至少一张图片）');
  console.log('  --help, -h        显示帮助');
  process.exit(0);
}

const contentDirArg = args[args.indexOf('--content') + 1];

if (!contentDirArg) {
  console.error('❌ 错误：必须提供 --content 参数');
  console.error('使用方式：node publish-xiaohongshu-image.cjs --content /path/to/image-xxx/');
  process.exit(1);
}

if (!fs.existsSync(contentDirArg)) {
  console.error(`❌ 错误：内容目录不存在: ${contentDirArg}`);
  process.exit(1);
}

const contentDir = path.resolve(contentDirArg);

// 读取正文
const contentFile = path.join(contentDir, 'content.txt');
const contentText = fs.existsSync(contentFile)
  ? fs.readFileSync(contentFile, 'utf8').trim()
  : '';

// 读取标题（可选）
const titleFile = path.join(contentDir, 'title.txt');
const titleText = fs.existsSync(titleFile)
  ? fs.readFileSync(titleFile, 'utf8').trim().slice(0, 20)
  : contentText.replace(/#[^#]+#/g, '').trim().slice(0, 20);

// 读取图片
const localImages = findImagesUtil(contentDir);
if (localImages.length === 0) {
  console.error('❌ 错误：内容目录中没有图片文件');
  process.exit(1);
}

// 小红书最多支持 9 张图片
const MAX_IMAGES = 9;
const imagesToUpload = localImages.slice(0, MAX_IMAGES);
if (localImages.length > MAX_IMAGES) {
  console.warn(`⚠️  图片数量超过限制（${localImages.length} > 9），仅上传前 9 张`);
}

// 转换图片路径为 Windows 绝对路径
const dateDir = path.basename(path.dirname(contentDir));
const contentDirName = path.basename(contentDir);
const windowsImages = imagesToUpload.map(img => {
  const filename = path.basename(img);
  return path.join(WINDOWS_BASE_DIR, dateDir, contentDirName, filename).replace(/\//g, '\\');
});

console.log('\n[XHS] ========================================');
console.log('[XHS] 小红书图文发布');
console.log('[XHS] ========================================\n');
console.log(`[XHS] 📁 内容目录: ${contentDir}`);
console.log(`[XHS] 📝 标题: ${titleText || '（无标题）'}`);
console.log(`[XHS] 📝 正文长度: ${contentText.length} 字符`);
console.log(`[XHS] 🖼️  图片数量: ${imagesToUpload.length}`);
if (windowsImages.length > 0) {
  console.log(`[XHS] 📁 Windows 路径示例: ${windowsImages[0]}`);
}
console.log('');

// ============================================================
// 工具函数
// ============================================================
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function screenshot(cdp, name) {
  try {
    const result = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const filepath = path.join(SCREENSHOTS_DIR, `${name}.png`);
    fs.writeFileSync(filepath, Buffer.from(result.data, 'base64'));
    console.log(`[XHS]    📸 ${filepath}`);
    return filepath;
  } catch (e) {
    console.error(`[XHS]    ❌ 截图失败: ${e.message}`);
    return null;
  }
}

/**
 * 转义字符串，用于 CDP Runtime.evaluate 的 JS 注入
 */
function escapeForJS(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  let cdp;

  try {
    // ===== 连接 CDP =====
    console.log('[XHS] 🔌 连接 CDP...\n');
    const pagesData = await new Promise((resolve, reject) => {
      http.get(`http://${WINDOWS_IP}:${CDP_PORT}/json`, res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`CDP 响应解析失败: ${e.message}`));
          }
        });
      }).on('error', err => {
        reject(new Error(
          `CDP 连接失败 (${WINDOWS_IP}:${CDP_PORT}): ${err.message}\n` +
          `排查：curl http://${WINDOWS_IP}:${CDP_PORT}/json\n` +
          `确认 Chrome 以 --remote-debugging-port=${CDP_PORT} 启动`
        ));
      });
    });

    // 找到小红书创作者页面
    const xhsPage = pagesData.find(
      p => p.type === 'page' && p.url.includes(XHS_DOMAIN)
    );
    if (!xhsPage) {
      const firstPage = pagesData.find(p => p.type === 'page');
      if (!firstPage) {
        throw new Error(
          `未找到任何浏览器页面，且没有小红书标签页。\n` +
          `请在 Chrome (端口 ${CDP_PORT}) 中打开 ${PUBLISH_URL}`
        );
      }
      console.log(`[XHS]    ⚠️  未找到小红书页面，使用当前页: ${firstPage.url}`);
      cdp = new CDPClient(firstPage.webSocketDebuggerUrl);
    } else {
      cdp = new CDPClient(xhsPage.webSocketDebuggerUrl);
    }

    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    console.log('[XHS] ✅ CDP 已连接\n');

    // ===== 步骤1: 导航到发布页 =====
    console.log('[XHS] 1️⃣  导航到小红书发布页...\n');
    await cdp.send('Page.navigate', { url: PUBLISH_URL });
    await sleep(5000);
    await screenshot(cdp, '01-initial');

    const urlResult = await cdp.send('Runtime.evaluate', {
      expression: 'window.location.href',
      returnByValue: true
    });
    const currentUrl = urlResult.result.value;
    console.log(`[XHS]    当前 URL: ${currentUrl}\n`);

    if (!currentUrl.includes('xiaohongshu.com')) {
      throw new Error(`导航失败，当前页面: ${currentUrl}`);
    }
    if (currentUrl.includes('login') || currentUrl.includes('passport')) {
      throw new Error(
        `小红书未登录，请在 Chrome (端口 ${CDP_PORT}) 上先登录小红书创作者账号\n` +
        `访问 ${PUBLISH_URL} 并完成登录`
      );
    }
    console.log('[XHS]    ✅ 导航完成\n');

    // ===== 步骤2: 选择图文类型 =====
    console.log('[XHS] 2️⃣  选择图文发布类型...\n');
    await sleep(2000);

    const typeResult = await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        // 尝试点击「图文」类型选项
        const selectors = [
          '[class*="tab"][class*="image"]',
          '[class*="image-text"]',
          'div[data-v-*][class*="tab"]:first-child',
          '.tab-item:first-child',
          'span:contains("图文")'
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.offsetWidth > 0) {
            el.click();
            return { clicked: true, selector: sel };
          }
        }
        // 查找包含"图文"文字的可点击元素
        const allEls = Array.from(document.querySelectorAll('div, span, button, a'));
        const imageTextEl = allEls.find(el =>
          el.textContent.trim() === '图文' &&
          el.offsetWidth > 0 &&
          el.offsetHeight > 0
        );
        if (imageTextEl) {
          imageTextEl.click();
          return { clicked: true, text: '图文' };
        }
        return { clicked: false, note: '未找到图文类型选项，可能已是图文模式' };
      })()`,
      returnByValue: true
    });
    console.log(`[XHS]    类型选择: ${JSON.stringify(typeResult.result.value)}`);
    await sleep(2000);
    await screenshot(cdp, '02-type-selected');

    // ===== 步骤3: 上传图片 =====
    console.log(`[XHS] 3️⃣  上传图片（${windowsImages.length} 张）...\n`);

    // 先点击上传区域以触发 file input 显示
    await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const uploadSelectors = [
          '.upload-input',
          'input[type="file"]',
          '[class*="upload"][class*="btn"]',
          '[class*="add-image"]',
          '.media-upload-wrap',
          '[class*="creator-tab"]:first-child'
        ];
        for (const sel of uploadSelectors) {
          const el = document.querySelector(sel);
          if (el && (el.tagName === 'INPUT' || el.offsetWidth > 0)) {
            if (el.tagName !== 'INPUT') el.click();
            return { found: true, selector: sel };
          }
        }
        return { found: false };
      })()`,
      returnByValue: true
    });
    await sleep(1000);

    // 获取 file input 并设置文件
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector: 'input[type="file"]'
    });

    console.log(`[XHS]    找到 ${nodeIds.length} 个 file input\n`);

    if (nodeIds.length === 0) {
      await screenshot(cdp, '03-no-input');
      throw new Error('未找到文件上传 input，请检查页面状态（截图已保存）');
    }

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

    // 等待图片上传（XHS 上传可能较慢）
    console.log('[XHS]    等待图片上传...');
    await sleep(8000);
    await screenshot(cdp, '03-images-uploaded');
    console.log('[XHS]    ✅ 图片已上传\n');

    // ===== 步骤4: 填写标题 =====
    if (titleText) {
      console.log(`[XHS] 4️⃣  填写标题: ${titleText}\n`);
      const escapedTitle = escapeForJS(titleText);

      const titleResult = await cdp.send('Runtime.evaluate', {
        expression: `(function() {
          const selectors = [
            'input[placeholder*="标题"]',
            'input[placeholder*="填写标题"]',
            'input[class*="title"]',
            '.title-input input',
            'input[maxlength="20"]',
            'input[maxlength="50"]'
          ];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.offsetWidth > 0) {
              el.focus();
              const nativeSetter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value'
              ).set;
              nativeSetter.call(el, '${escapedTitle}');
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return { success: true, selector: sel };
            }
          }
          return { success: false, error: '未找到标题输入框' };
        })()`,
        returnByValue: true
      });
      console.log(`[XHS]    标题填写: ${JSON.stringify(titleResult.result.value)}`);
      await sleep(1000);
    } else {
      console.log('[XHS] 4️⃣  跳过标题（无标题内容）\n');
    }

    // ===== 步骤5: 填写正文 =====
    if (contentText) {
      console.log(`[XHS] 5️⃣  填写正文（${contentText.length} 字符）...\n`);
      const escapedContent = escapeForJS(contentText);

      const contentResult = await cdp.send('Runtime.evaluate', {
        expression: `(function() {
          const selectors = [
            'div[contenteditable="true"][class*="content"]',
            'div[contenteditable="true"][class*="desc"]',
            'div[contenteditable="true"][class*="editor"]',
            '.ql-editor',
            'div[contenteditable="true"]:not([class*="title"])',
            'textarea[placeholder*="正文"]',
            'textarea[placeholder*="内容"]',
            'textarea[placeholder*="描述"]',
            'textarea'
          ];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.offsetWidth > 0) {
              el.focus();
              if (el.tagName === 'TEXTAREA') {
                const nativeSetter = Object.getOwnPropertyDescriptor(
                  window.HTMLTextAreaElement.prototype, 'value'
                ).set;
                nativeSetter.call(el, '${escapedContent}');
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              } else {
                // contenteditable div
                el.focus();
                document.execCommand('selectAll', false, null);
                document.execCommand('insertText', false, '${escapedContent}');
                el.dispatchEvent(new Event('input', { bubbles: true }));
              }
              return { success: true, selector: sel };
            }
          }
          return { success: false, error: '未找到正文输入区域' };
        })()`,
        returnByValue: true
      });
      console.log(`[XHS]    正文填写: ${JSON.stringify(contentResult.result.value)}`);
      await sleep(1000);
      await screenshot(cdp, '05-content-filled');
    } else {
      console.log('[XHS] 5️⃣  跳过正文（无正文内容）\n');
    }

    // ===== 步骤6: 点击发布 =====
    console.log('[XHS] 6️⃣  点击发布...\n');
    await sleep(2000);
    await screenshot(cdp, '06-before-publish');

    const publishResult = await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const buttons = Array.from(document.querySelectorAll('button, div[role="button"], span[role="button"]'));
        // 优先找精确匹配"发布"的按钮
        const publishBtn = buttons.find(b =>
          b.textContent &&
          (b.textContent.trim() === '发布' || b.textContent.trim() === '确认发布') &&
          b.offsetWidth > 0 &&
          !b.disabled &&
          !b.classList.toString().includes('disabled')
        );
        if (publishBtn) {
          publishBtn.click();
          return { clicked: true, text: publishBtn.textContent.trim() };
        }
        // 备选：class 中包含 submit 或 publish
        const submitBtn = document.querySelector(
          'button[class*="submit"]:not([disabled]), button[class*="publish"]:not([disabled])'
        );
        if (submitBtn && submitBtn.offsetWidth > 0) {
          submitBtn.click();
          return { clicked: true, selector: 'submit-btn' };
        }
        return {
          clicked: false,
          error: '未找到发布按钮',
          btns: buttons.filter(b => b.offsetWidth > 0).map(b => b.textContent.trim()).slice(0, 5)
        };
      })()`,
      returnByValue: true
    });

    console.log(`[XHS]    发布按钮: ${JSON.stringify(publishResult.result.value)}`);

    if (!publishResult.result.value || !publishResult.result.value.clicked) {
      await screenshot(cdp, '06-publish-btn-not-found');
      throw new Error(`未能点击发布按钮: ${JSON.stringify(publishResult.result.value)}`);
    }

    // 等待发布完成
    await sleep(5000);
    await screenshot(cdp, '06-after-publish');

    // ===== 步骤7: 验证发布结果 =====
    console.log('[XHS] 7️⃣  验证发布结果...\n');

    const finalUrl = await cdp.send('Runtime.evaluate', {
      expression: 'window.location.href',
      returnByValue: true
    });
    const finalUrlValue = finalUrl.result.value;
    console.log(`[XHS]    最终 URL: ${finalUrlValue}\n`);

    await screenshot(cdp, '07-final');

    const successCheck = await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const bodyText = document.body.textContent || '';
        const bodyInner = document.body.innerHTML || '';
        return {
          hasSuccess: bodyText.includes('发布成功') || bodyText.includes('笔记已发布') ||
                      bodyText.includes('创作成功') || bodyInner.includes('success'),
          hasError: bodyText.includes('发布失败') || bodyText.includes('发布错误') ||
                    bodyText.includes('内容违规'),
          urlChanged: !window.location.href.includes('/publish/')
        };
      })()`,
      returnByValue: true
    });

    const result = successCheck.result.value;
    console.log(`[XHS]    结果检查: ${JSON.stringify(result)}`);

    if (result.hasSuccess || result.urlChanged) {
      console.log('\n[XHS] ✅ 小红书笔记发布成功！');
      console.log(`[XHS]    截图目录: ${SCREENSHOTS_DIR}`);
    } else if (result.hasError) {
      throw new Error('发布失败（内容违规或其他错误），请查看截图');
    } else {
      console.log('\n[XHS] ⚠️  发布状态不确定，请查看截图确认');
      console.log(`[XHS]    截图目录: ${SCREENSHOTS_DIR}`);
    }

  } catch (err) {
    console.error(`\n[XHS] ❌ 发布失败: ${err.message}`);
    if (cdp) {
      await screenshot(cdp, 'error-final').catch(() => {});
    }
    process.exit(1);
  } finally {
    if (cdp) cdp.close();
  }
}

main();
