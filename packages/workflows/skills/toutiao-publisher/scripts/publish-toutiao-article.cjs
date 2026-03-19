#!/usr/bin/env node
/**
 * 今日头条图文发布脚本（SSH 包装器）
 *
 * 技术方案：SSH → xian-mac (Mac mini) → Windows PC Playwright
 *
 * 发布流程：
 *   1. 读取本地内容目录（title.txt, content.txt, type.txt, image.jpg）
 *   2. 构建 JSON queue 并 Base64 编码
 *   3. SSH 到 xian-mac，再由 Mac mini SSH 到 Windows PC 执行 Playwright 脚本
 *
 * 用法：
 *   NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules \
 *     node publish-toutiao-article.cjs --content /path/to/post-1/
 *   node publish-toutiao-article.cjs --content /path/to/post-1/ --dry-run
 *
 * 内容目录结构：
 *   title.txt    - 标题（必需，article 类型）
 *   content.txt  - 正文（必需）
 *   type.txt     - 类型：article | weitoutiao（默认：article）
 *   image.jpg    - 封面图（可选，支持 .jpg/.jpeg/.png）
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─── 可导出工具函数（供测试用）────────────────────────────────────────────────

/**
 * 读取文件内容（不存在时返回 null）
 */
function readFile(filePath) {
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf8').trim();
  }
  return null;
}

/**
 * 从内容目录加载发布内容
 * @param {string} contentDir 内容目录路径
 * @returns {{ title, content, type, imagePath }}
 */
function loadContent(contentDir) {
  const title = readFile(path.join(contentDir, 'title.txt'));
  const content = readFile(path.join(contentDir, 'content.txt'));
  const type = readFile(path.join(contentDir, 'type.txt')) || 'article';

  const imageExts = ['image.jpg', 'image.jpeg', 'image.png', 'cover.jpg', 'cover.jpeg', 'cover.png'];
  const imagePath = imageExts
    .map(f => path.join(contentDir, f))
    .find(f => fs.existsSync(f)) || null;

  return { title, content, type, imagePath };
}

/**
 * 校验内容字段是否满足发布要求
 * @returns {{ valid: boolean, error: string|null }}
 */
function validateContent({ title, content, type }) {
  if (!content) {
    return { valid: false, error: '缺少 content.txt（正文必需）' };
  }
  if (type === 'article' && !title) {
    return { valid: false, error: 'article 类型缺少 title.txt（标题必需）' };
  }
  return { valid: true, error: null };
}

module.exports = { readFile, loadContent, validateContent };

// ─── CLI 入口（仅直接运行时执行）────────────────────────────────────────────

if (require.main === module) {
  // 参数解析
  const args = process.argv.slice(2);
  let contentDir = null;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--content' && args[i + 1]) {
      contentDir = path.resolve(args[++i]);
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }

  if (!contentDir) {
    console.error('用法: node publish-toutiao-article.cjs --content <dir> [--dry-run]');
    process.exit(1);
  }

  if (!fs.existsSync(contentDir)) {
    console.error(`内容目录不存在: ${contentDir}`);
    process.exit(1);
  }

  // 读取内容
  const { title, content, type, imagePath } = loadContent(contentDir);

  // 校验
  const { valid, error } = validateContent({ title, content, type });
  if (!valid) {
    console.error(`❌ ${error}`);
    process.exit(1);
  }

  // 打印内容摘要
  console.log('');
  console.log('今日头条发布');
  console.log('─────────────────────────────────');
  console.log(`类型: ${type}`);
  console.log(`标题: ${title || '（无标题）'}`);
  console.log(`正文: ${content.slice(0, 60)}${content.length > 60 ? '...' : ''}`);
  console.log(`图片: ${imagePath ? path.basename(imagePath) : '（无图片，使用默认）'}`);

  if (dryRun) {
    console.log('');
    console.log('[DRY-RUN] 跳过实际发布');
    process.exit(0);
  }

  // 构建 Queue JSON
  const queueEntry = { type, title: title || '', content, imagePath: imagePath || '' };
  const base64Json = Buffer.from(JSON.stringify([queueEntry])).toString('base64');

  // SSH 配置
  const MAC_MINI_HOST = 'xian-mac';
  const WINDOWS_IP = '100.97.242.124';
  const WINDOWS_USER = 'xuxia';
  const WINDOWS_SCRIPT_DIR = 'C:/Users/xuxia/playwright-recorder';
  const SSH_KEY = '~/.ssh/windows_ed';
  const winScript = type === 'weitoutiao'
    ? 'publish-weitoutiao-playwright.js'
    : 'publish-article-playwright.js';

  console.log('');
  console.log(`SSH → ${MAC_MINI_HOST} → Windows PC (${WINDOWS_IP})...`);

  // Mac mini 上执行的脚本：解码 JSON → SCP 到 Windows → SSH 运行 Playwright
  const macScript = [
    'set -e',
    'TMPDIR=$(mktemp -d /tmp/tt_XXXXXX)',
    'B64FILE="$TMPDIR/queue.b64"',
    'JSONFILE="$TMPDIR/queue.json"',
    `echo '${base64Json}' > "$B64FILE"`,
    'base64 -d "$B64FILE" > "$JSONFILE"',
    `scp -i ${SSH_KEY} -o StrictHostKeyChecking=no "$JSONFILE" ${WINDOWS_USER}@${WINDOWS_IP}:'/c/Users/${WINDOWS_USER}/AppData/Local/Temp/tt_queue.json'`,
    `ssh -i ${SSH_KEY} -o StrictHostKeyChecking=no ${WINDOWS_USER}@${WINDOWS_IP} "cd '${WINDOWS_SCRIPT_DIR}' && node ${winScript} C:/Users/${WINDOWS_USER}/AppData/Local/Temp/tt_queue.json"`,
    'rm -rf "$TMPDIR"',
  ].join('\n');

  try {
    execSync(`ssh ${MAC_MINI_HOST} 'bash -s'`, {
      input: macScript,
      stdio: ['pipe', 'inherit', 'inherit'],
      timeout: 180000,
    });
    console.log('');
    console.log('✅ 今日头条发布成功');
    process.exit(0);
  } catch (err) {
    console.error('');
    console.error('❌ 今日头条发布失败');
    if (err.message) console.error(err.message);
    process.exit(1);
  }
}
