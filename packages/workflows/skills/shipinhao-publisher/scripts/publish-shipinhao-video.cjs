#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const CDP_URL = 'http://localhost:9228';
const WINDOWS_IP = '100.97.242.124';
const WINDOWS_USER = 'xuxia';
const WINDOWS_KEY = '/Users/jinnuoshengyuan/.ssh/windows_ed';
const WIN_BASE_DIR = 'C:\\Users\\xuxia\\shipinhao-media';
const CREATE_URL = 'https://channels.weixin.qq.com/platform/post/create';
const SHOTS_DIR = '/tmp/shipinhao-video-screenshots';
const SUCCESS_SHOT = '/tmp/shipinhao-video-fix-success.png';
const INIT_WAIT_MS = 120000;
const UPLOAD_WAIT_MS = 15 * 60 * 1000;

const SELECTORS = {
  contentFrame: 'iframe[name="content"]',
  uploadButton: '.ant-upload.ant-upload-drag .ant-upload-btn:visible',
  fileInput: 'input[type="file"][accept*="video"]',
  descEditor: '.input-editor[data-placeholder="添加描述"]:visible',
  titleInput: 'input[placeholder="概括视频主要内容，字数建议6-16个字符"]:visible',
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const take = flag => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : '';
  };

  if (args.includes('--help') || args.includes('-h')) {
    console.log('用法: node publish-shipinhao-video.cjs --title "标题" --video /path/to/video.mp4 [--desc "描述"] [--dry-run]');
    process.exit(0);
  }

  const title = take('--title').trim();
  const video = take('--video');
  const desc = take('--desc').trim();
  const isDryRun = args.includes('--dry-run');

  if (!title) {
    console.error('[SPH-VIDEO] 必须提供 --title');
    process.exit(1);
  }
  if (!video || !fs.existsSync(video)) {
    console.error('[SPH-VIDEO] 必须提供有效的 --video 本地文件路径');
    process.exit(1);
  }

  return {
    title,
    desc,
    isDryRun,
    video: path.resolve(video),
  };
}

function formatDateDir(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function sanitizePathSegment(input) {
  return (input || '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'video';
}

function toWindowsScpPath(p) {
  return p.replace(/\\/g, '/');
}

function buildWindowsTarget(localVideo) {
  const dateDir = formatDateDir(new Date());
  const baseName = sanitizePathSegment(path.basename(localVideo, path.extname(localVideo)));
  const uniqueDir = `${baseName}-${Date.now()}`;
  const winDir = `${WIN_BASE_DIR}\\${dateDir}\\${uniqueDir}`;
  const winVideo = `${winDir}\\${path.basename(localVideo)}`;
  return { winDir, winVideo };
}

function scpToWindows(localVideo, winDir) {
  console.log('[SPH-VIDEO] SCP 视频到 Windows...');
  const winDirForScp = toWindowsScpPath(winDir);

  execFileSync(
    'ssh',
    [
      '-i',
      WINDOWS_KEY,
      '-o',
      'StrictHostKeyChecking=no',
      `${WINDOWS_USER}@${WINDOWS_IP}`,
      `powershell -command "New-Item -ItemType Directory -Force -Path '${winDirForScp}' | Out-Null; Write-Host ok"`,
    ],
    { timeout: 20000, stdio: 'pipe' }
  );

  execFileSync(
    'scp',
    [
      '-i',
      WINDOWS_KEY,
      '-o',
      'StrictHostKeyChecking=no',
      localVideo,
      `${WINDOWS_USER}@${WINDOWS_IP}:${winDirForScp}/${path.basename(localVideo)}`,
    ],
    { timeout: 120000, stdio: 'pipe' }
  );

  console.log(`[SPH-VIDEO]    已传到 Windows: ${winDir}`);
}

async function screenshot(page, name) {
  ensureDir(SHOTS_DIR);
  const target = path.join(SHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: target, fullPage: true });
  console.log(`[SPH-VIDEO]    截图: ${target}`);
}

async function screenshotTo(page, target) {
  ensureDir(path.dirname(target));
  await page.screenshot({ path: target, fullPage: true });
  console.log(`[SPH-VIDEO]    截图: ${target}`);
}

async function dismissCommonDialogs(page) {
  const buttonTexts = ['我知道了', '知道了', '取消', '稍后再说'];

  for (const text of buttonTexts) {
    const locator = page.locator(`button:has-text("${text}")`);
    const count = await locator.count().catch(() => 0);
    for (let i = 0; i < count; i += 1) {
      const button = locator.nth(i);
      const buttonText = await button.innerText().catch(() => '');
      if (buttonText.trim() === '发表') continue;
      if (await button.isVisible().catch(() => false)) {
        await button.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(500);
      }
    }
  }
}

function stripVisiblePseudo(selector) {
  return selector.replace(/:visible/g, '');
}

function buildElementVisiblePredicate() {
  return `
    el => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        rect.width > 0 &&
        rect.height > 0;
    }
  `;
}

async function waitForSelectorHandle(frame, selector, options = {}) {
  const { timeout = 30000, visible = false } = options;
  const plainSelector = stripVisiblePseudo(selector);
  const handle = await frame.waitForFunction(
    ({ query, visibleOnly, visiblePredicate }) => {
      const isVisible = Function(`return (${visiblePredicate})`)();
      const node = document.querySelector(query);
      if (!node) return null;
      if (visibleOnly && !isVisible(node)) return null;
      return node;
    },
    {
      query: plainSelector,
      visibleOnly: visible,
      visiblePredicate: buildElementVisiblePredicate(),
    },
    { timeout }
  );
  const element = handle.asElement();
  if (!element) throw new Error(`未获取到元素句柄: ${plainSelector}`);
  return element;
}

async function waitForExactButtonHandle(frame, text, options = {}) {
  const { timeout = 30000, visible = false } = options;
  const handle = await frame.waitForFunction(
    ({ expectedText, visibleOnly, visiblePredicate }) => {
      const isVisible = Function(`return (${visiblePredicate})`)();
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.find(button => {
        if ((button.textContent || '').trim() !== expectedText) return false;
        return !visibleOnly || isVisible(button);
      }) || null;
    },
    {
      expectedText: text,
      visibleOnly: visible,
      visiblePredicate: buildElementVisiblePredicate(),
    },
    { timeout }
  );
  const element = handle.asElement();
  if (!element) throw new Error(`未获取到按钮句柄: ${text}`);
  return element;
}

async function resolveEditorFrame(page, timeout = INIT_WAIT_MS) {
  const deadline = Date.now() + timeout;
  let lastReason = '未找到 content iframe';

  while (Date.now() < deadline) {
    const candidates = page.frames().filter(frame => (
      /\/micro\/content\/post\/create/.test(frame.url()) || frame.name() === 'content'
    ));

    for (const frame of candidates.reverse()) {
      const hasEditor = await frame.evaluate(({ titleSelector, fileSelector }) => {
        const titleInput = document.querySelector(titleSelector);
        const fileInput = document.querySelector(fileSelector);
        const publishButton = Array.from(document.querySelectorAll('button'))
          .some(button => (button.textContent || '').trim() === '发表');
        return !!(titleInput || fileInput || publishButton);
      }, {
        titleSelector: stripVisiblePseudo(SELECTORS.titleInput),
        fileSelector: stripVisiblePseudo(SELECTORS.fileInput),
      }).catch(() => false);

      if (hasEditor) {
        console.log(`[SPH-VIDEO]    命中编辑器 frame: ${frame.url() || '(about:blank)'}`);
        return frame;
      }
      lastReason = `候选 frame 未出现编辑器控件: ${frame.url() || '(about:blank)'}`;
    }

    await page.waitForTimeout(1000);
  }

  throw new Error(`未解析到视频发布编辑器 frame: ${lastReason}`);
}

async function openCreatePage(context) {
  const existingPage = context.pages().find(page => (
    !page.isClosed() &&
    /https:\/\/channels\.weixin\.qq\.com\/platform\/post\/(create|list)/.test(page.url()) &&
    !/login\.html/.test(page.url())
  ));

  if (existingPage) {
    console.log('[SPH-VIDEO] 复用现有视频号标签并刷新到创建页');
    await existingPage.bringToFront().catch(() => {});
    try {
      await existingPage.goto(CREATE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (error) {
      if (!String(error.message).includes('net::ERR_ABORTED')) throw error;
      console.log('[SPH-VIDEO]    导航返回 ERR_ABORTED，继续等待当前页面就绪');
    }
    return { page: existingPage, createdPage: false };
  }

  const page = await context.newPage();
  console.log('[SPH-VIDEO] CDP 已连接，已创建新标签页用于发布');

  try {
    await page.goto(CREATE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (error) {
    if (!String(error.message).includes('net::ERR_ABORTED')) throw error;
    console.log('[SPH-VIDEO]    导航返回 ERR_ABORTED，继续等待当前页面就绪');
  }

  return { page, createdPage: true };
}

async function waitForReady(page) {
  await page.waitForTimeout(8000);
  await dismissCommonDialogs(page);

  const frame = await resolveEditorFrame(page);
  await waitForSelectorHandle(frame, SELECTORS.titleInput, { visible: true, timeout: 30000 });
  await waitForSelectorHandle(frame, SELECTORS.descEditor, { visible: true, timeout: INIT_WAIT_MS });
  await waitForSelectorHandle(frame, SELECTORS.fileInput, { timeout: 30000 });
  await waitForExactButtonHandle(frame, '发表', { visible: true, timeout: 30000 });
  await page.waitForTimeout(2000);
  return frame;
}

async function deepResolveFileInput(frame, cdpSession) {
  const expression = `(() => {
    const walk = root => {
      if (!root) return null;
      const direct = root.querySelector?.('${SELECTORS.fileInput.replace(/'/g, "\\'")}');
      if (direct) return direct;
      const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
      for (const node of nodes) {
        if (node.shadowRoot) {
          const found = walk(node.shadowRoot);
          if (found) return found;
        }
      }
      return null;
    };
    return walk(document);
  })()`;

  const executionContext = await frame._mainContext();
  const { result } = await cdpSession.send('Runtime.evaluate', {
    expression,
    contextId: executionContext._contextId,
  });
  if (!result.objectId) throw new Error('未获取到上传 input 的 objectId');
  const { node } = await cdpSession.send('DOM.describeNode', { objectId: result.objectId });
  return node.backendNodeId;
}

async function uploadVideo(page, frame, context, localVideo, windowsTarget) {
  console.log('[SPH-VIDEO] 上传视频...');
  const input = await waitForSelectorHandle(frame, SELECTORS.fileInput, { timeout: 30000 });

  try {
    await input.setInputFiles(localVideo);
    await page.waitForTimeout(1500);

    const fileCount = await input.evaluate(el => el.files?.length || 0);
    if (fileCount !== 1) {
      throw new Error(`frame.setInputFiles 后 input.files=${fileCount}`);
    }

    console.log('[SPH-VIDEO]    上传方式: playwright-frame');
    return;
  } catch (playwrightError) {
    console.log(`[SPH-VIDEO]    frame.setInputFiles 未生效，回退 SCP + CDP: ${playwrightError.message}`);
  }

  let uploadedBy = 'cdp';

  try {
    const { winDir, winVideo } = windowsTarget;
    scpToWindows(localVideo, winDir);
    const cdpSession = await context.newCDPSession(page);
    const backendNodeId = await deepResolveFileInput(frame, cdpSession);
    await cdpSession.send('DOM.setFileInputFiles', {
      backendNodeId,
      files: [winVideo],
    });
    await page.waitForTimeout(1500);

    const fileCount = await input.evaluate(el => el.files?.length || 0);
    if (fileCount !== 1) {
      throw new Error(`CDP 设置后 input.files=${fileCount}`);
    }
  } catch (error) {
    throw new Error(`iframe 上传失败: ${error.message}`);
  }

  console.log(`[SPH-VIDEO]    上传方式: ${uploadedBy}`);
}

async function fillTitle(frame, title) {
  console.log('[SPH-VIDEO] 填写标题...');
  const input = await waitForSelectorHandle(frame, SELECTORS.titleInput, { visible: true, timeout: 30000 });
  await input.click();
  await input.fill('');
  await input.fill(title);
}

async function fillDescription(frame, desc) {
  if (!desc) return;
  console.log('[SPH-VIDEO] 填写描述...');
  const editor = await waitForSelectorHandle(frame, SELECTORS.descEditor, { visible: true, timeout: 30000 });
  await editor.click();
  await editor.evaluate(node => {
    node.textContent = '';
    if ('value' in node) node.value = '';
  });
  await editor.fill(desc);
}

async function waitForUploadComplete(frame) {
  console.log('[SPH-VIDEO] 等待上传完成...');
  await frame.waitForFunction(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const publishButton = buttons.find(button => (button.textContent || '').trim() === '发表');
    if (!publishButton) return false;
    const className = publishButton.className || '';
    const bodyText = document.body?.innerText || '';
    const previewReady = /删除|编辑|封面预览|个人主页和分享卡片/.test(bodyText) ||
      !!document.querySelector('video, canvas, .cover-wrap, .post-cover-selector, .post-create-cover');
    return !publishButton.disabled && !className.includes('disabled') && previewReady;
  }, null, { timeout: UPLOAD_WAIT_MS });
  await frame.page().waitForTimeout(3000);
}

async function verifyDraft(frame, expectedTitle, expectedDesc) {
  const titleHandle = await waitForSelectorHandle(frame, SELECTORS.titleInput, { timeout: 30000 });
  const descHandle = await waitForSelectorHandle(frame, SELECTORS.descEditor, { timeout: 30000 });
  const publishButton = await waitForExactButtonHandle(frame, '发表', { timeout: 30000 });
  const titleValue = await titleHandle.inputValue();
  const descText = await descHandle.innerText();
  const state = await publishButton.evaluate(el => ({
    text: (el.textContent || '').trim(),
    disabled: !!el.disabled || String(el.className || '').includes('disabled'),
  }));
  const previewVisible = await frame.evaluate(() => {
    const bodyText = document.body?.innerText || '';
    if (/重新上传|更换视频|上传封面|提取封面|视频处理完成|上传完成|删除|编辑|封面预览/.test(bodyText)) return true;
    return !!document.querySelector('video, canvas, .upload-success, .upload-item, .post-upload-wrap .cover-wrap, .post-cover-selector, .post-create-cover');
  });

  if (titleValue !== expectedTitle) {
    throw new Error(`标题校验失败: ${titleValue}`);
  }
  if (expectedDesc && !descText.includes(expectedDesc)) {
    throw new Error('描述校验失败');
  }
  if (!previewVisible) {
    throw new Error('未检测到视频上传后的预览区域');
  }
  if (state.disabled) {
    throw new Error(`发表按钮仍不可用: ${state.text}`);
  }

  console.log(`[SPH-VIDEO]    校验通过: 标题="${titleValue}", 发表按钮="${state.text}"`);
}

async function main() {
  const { title, desc, video, isDryRun } = parseArgs(process.argv);
  const { winDir, winVideo } = buildWindowsTarget(video);

  console.log('[SPH-VIDEO] ========================================');
  console.log('[SPH-VIDEO] 视频号视频发布 (Playwright + CDP)');
  console.log('[SPH-VIDEO] ========================================');
  console.log(`[SPH-VIDEO] 视频: ${video}`);
  console.log(`[SPH-VIDEO] 标题: ${title}`);
  console.log(`[SPH-VIDEO] 描述: ${desc || '(空)'}`);
  console.log(`[SPH-VIDEO] 模式: ${isDryRun ? 'dry-run' : 'publish'}`);

  console.log('[SPH-VIDEO] 连接 CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL, { timeout: 30000 });
  const context = browser.contexts()[0];
  const { page, createdPage } = await openCreatePage(context);

  page.on('dialog', dialog => {
    console.log(`[SPH-VIDEO]    关闭对话框: ${dialog.message()}`);
    dialog.dismiss().catch(() => {});
  });

  try {
    const frame = await waitForReady(page);
    await screenshot(page, '01-ready');

    await uploadVideo(page, frame, context, video, { winDir, winVideo });
    await screenshot(page, '02-upload-started');

    await fillTitle(frame, title);
    await fillDescription(frame, desc);
    await screenshot(page, '03-filled');

    await waitForUploadComplete(frame);
    await screenshot(page, '04-uploaded');
    await verifyDraft(frame, title, desc);

    if (isDryRun) {
      console.log('[SPH-VIDEO] dry-run 完成，未点击发表');
      return;
    }

    console.log('[SPH-VIDEO] 点击发表...');
    const publishButton = await waitForExactButtonHandle(frame, '发表', { visible: true, timeout: 10000 });
    await publishButton.click({ timeout: 10000 });
    await page.waitForTimeout(5000);
    await screenshot(page, '05-published');
    await screenshotTo(page, SUCCESS_SHOT);
    console.log('[SPH-VIDEO] 发布完成');
  } finally {
    if (createdPage && !page.isClosed()) {
      await page.close().catch(() => {});
    }
    await browser.close();
  }
}

main().catch(error => {
  console.error('[SPH-VIDEO] 发布失败:', error.message);
  process.exit(1);
});
