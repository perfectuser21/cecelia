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

// ─── 参数解析 ────────────────────────────────────────────────────────────────

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

// ─── 读取内容 ────────────────────────────────────────────────────────────────

function readFile(filePath) {
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf8').trim();
  }
  return null;
}

const title = readFile(path.join(contentDir, 'title.txt'));
const content = readFile(path.join(contentDir, 'content.txt'));
const type = readFile(path.join(contentDir, 'type.txt')) || 'article';

// 图片：优先顺序 image.jpg > cover.jpg > image.png > cover.png
const imageExts = ['image.jpg', 'image.jpeg', 'image.png', 'cover.jpg', 'cover.jpeg', 'cover.png'];
const imagePath = imageExts
  .map(f => path.join(contentDir, f))
  .find(f => fs.existsSync(f)) || null;

// 基本校验
if (!content) {
  console.error('❌ 缺少 content.txt（正文必需）');
  process.exit(1);
}

if (type === 'article' && !title) {
  console.error('❌ article 类型缺少 title.txt（标题必需）');
  process.exit(1);
}

// ─── 打印内容摘要 ─────────────────────────────────────────────────────────────

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

// ─── 构建 Queue JSON ─────────────────────────────────────────────────────────

const queueEntry = {
  type,
  title: title || '',
  content,
  imagePath: imagePath || '',
};

const jsonStr = JSON.stringify([queueEntry]);
const base64Json = Buffer.from(jsonStr).toString('base64');

// ─── SSH 执行发布 ────────────────────────────────────────────────────────────

const MAC_MINI_HOST = 'xian-mac';
const WINDOWS_IP = '100.97.242.124';
const WINDOWS_USER = 'xuxia';
const WINDOWS_SCRIPT_DIR = 'C:/Users/xuxia/playwright-recorder';
const SSH_KEY = '~/.ssh/windows_ed';

// 决定 Windows Playwright 脚本
const winScript =
  type === 'weitoutiao'
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
  // 将脚本通过 stdin 传给 xian-mac，避免引号转义问题
  execSync(`ssh ${MAC_MINI_HOST} 'bash -s'`, {
    input: macScript,
    stdio: ['pipe', 'inherit', 'inherit'],
    timeout: 180000, // 3 分钟超时
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
