'use strict';
/**
 * 抖音发布器工具函数
 *
 * 纯函数层，与 CDP 无关，可完全单元测试。
 * 架构与 kuaishou-publisher/utils.cjs、xiaohongshu-publisher/utils.cjs 保持一致。
 */

const fs = require('fs');
const path = require('path');

/**
 * 视频发布页面 URL
 */
const VIDEO_PUBLISH_URL = 'https://creator.douyin.com/creator-micro/content/upload';

/**
 * 图文发布页面 URL（default-tab=3 切换到图文 tab）
 */
const IMAGE_PUBLISH_URL = 'https://creator.douyin.com/creator-micro/content/upload?default-tab=3';

/**
 * 抖音创作者中心 Cookie 域
 */
const DOUYIN_COOKIE_DOMAINS = [
  'https://creator.douyin.com',
  'https://www.douyin.com',
  'https://douyin.com',
];

/**
 * 发布成功 URL 模式（发布后会跳转到内容管理页或回到上传页）
 */
const SUCCESS_URL_PATTERNS = [
  '/content/manage',
  '/content/upload',
];

/**
 * 收集目录中的图片文件（排序后，排除 cover.* 文件）。
 * @param {string} dir - 内容目录路径
 * @returns {string[]} 图片绝对路径数组
 */
function findImages(dir) {
  const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  const files = fs.readdirSync(dir);
  return files
    .filter(f => {
      const lower = f.toLowerCase();
      const isCover = lower.startsWith('cover.');
      return !isCover && imageExts.some(ext => lower.endsWith(ext));
    })
    .sort()
    .map(f => path.join(dir, f));
}

/**
 * 查找目录中的视频文件（第一个匹配）。
 * @param {string} dir - 内容目录路径
 * @returns {string|null} 视频绝对路径，或 null
 */
function findVideo(dir) {
  const videoExts = ['.mp4', '.mov', '.avi', '.mkv', '.flv', '.webm'];
  const files = fs.readdirSync(dir).sort();
  const found = files.find(f => videoExts.some(ext => f.toLowerCase().endsWith(ext)));
  return found ? path.join(dir, found) : null;
}

/**
 * 读取内容目录中的 title.txt 标题。
 * @param {string} dir - 内容目录路径
 * @returns {string} 标题文本（trim 后），无文件时返回空字符串
 */
function readTitle(dir) {
  const file = path.join(dir, 'title.txt');
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8').trim();
}

/**
 * 读取内容目录中的 content.txt 文案。
 * @param {string} dir - 内容目录路径
 * @returns {string} 文案文本（trim 后），无文件时返回空字符串
 */
function readContent(dir) {
  const file = path.join(dir, 'content.txt');
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8').trim();
}

/**
 * 读取内容目录中的 tags.txt 标签列表。
 * 文件格式：每行一个标签，或逗号分隔。
 * @param {string} dir - 内容目录路径
 * @returns {string[]} 标签数组（去除 # 前缀和空标签）
 */
function readTags(dir) {
  const file = path.join(dir, 'tags.txt');
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf8').trim();
  return raw
    .split(/[\n,]/)
    .map(t => t.trim().replace(/^#/, ''))
    .filter(Boolean);
}

/**
 * 查找内容目录中的封面图（cover.jpg 优先）。
 * @param {string} dir - 内容目录路径
 * @returns {string|null} 封面绝对路径，或 null
 */
function findCover(dir) {
  const candidates = ['cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp'];
  for (const name of candidates) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * 将本地路径数组转换为 Windows PC 上的绝对路径。
 * @param {string[]} localPaths - 本地路径数组
 * @param {string} windowsBaseDir - Windows 基础目录（如 C:\Users\xuxia\douyin-media）
 * @param {string} dateDir - 日期目录名（如 2026-03-19）
 * @param {string} contentDirName - 内容目录名（如 video-1）
 * @returns {string[]} Windows 路径数组
 */
function convertToWindowsPaths(localPaths, windowsBaseDir, dateDir, contentDirName) {
  return localPaths.map(p => {
    const filename = path.basename(p);
    return path.join(windowsBaseDir, dateDir, contentDirName, filename).replace(/\//g, '\\');
  });
}

/**
 * 从内容目录路径提取日期目录名和内容目录名。
 * 例如：/Users/admin/.douyin-queue/2026-03-19/video-1
 *   → { dateDir: '2026-03-19', contentDirName: 'video-1' }
 * @param {string} contentDir - 内容目录绝对路径
 * @returns {{ dateDir: string, contentDirName: string }}
 */
function extractDirNames(contentDir) {
  const parts = contentDir.split(path.sep);
  const contentDirName = parts[parts.length - 1];
  const dateDir = parts[parts.length - 2];
  return { dateDir, contentDirName };
}

/**
 * 转义文本用于 JavaScript 字符串注入（CDP Runtime.evaluate）。
 * @param {string} text
 * @returns {string}
 */
function escapeForJS(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * 检测 URL 是否为抖音登录重定向（会话过期）。
 * @param {string|null|undefined} url
 * @returns {boolean}
 */
function isLoginRedirect(url) {
  if (!url) return false;
  return (
    url.includes('passport.douyin.com') ||
    url.includes('/login') ||
    url.includes('sso.douyin.com') ||
    url.includes('login.douyin.com')
  );
}

/**
 * 检测发布是否成功（URL 跳转或页面文本）。
 * @param {string|null|undefined} url - 当前页面 URL
 * @param {string|null|undefined} bodyText - 页面文本内容（可选）
 * @returns {boolean}
 */
function isPublishSuccess(url, bodyText) {
  if (url) {
    if (SUCCESS_URL_PATTERNS.some(p => url.includes(p))) return true;
  }
  if (bodyText) {
    const successKeywords = ['发布成功', '已发布', '上传成功'];
    if (successKeywords.some(kw => bodyText.includes(kw))) return true;
  }
  return false;
}

/**
 * 解析命令行参数，提取 --content、--dry-run 等。
 * @param {string[]} argv - process.argv
 * @returns {{ contentDir: string|null, dryRun: boolean }}
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  const get = key => {
    const idx = args.indexOf(key);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
  };
  return {
    contentDir: get('--content'),
    dryRun: args.includes('--dry-run'),
  };
}

module.exports = {
  VIDEO_PUBLISH_URL,
  IMAGE_PUBLISH_URL,
  DOUYIN_COOKIE_DOMAINS,
  SUCCESS_URL_PATTERNS,
  findImages,
  findVideo,
  readTitle,
  readContent,
  readTags,
  findCover,
  convertToWindowsPaths,
  extractDirNames,
  escapeForJS,
  isLoginRedirect,
  isPublishSuccess,
  parseArgs,
};
