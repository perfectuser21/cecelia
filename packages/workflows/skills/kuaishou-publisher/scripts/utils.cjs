'use strict';
/**
 * 快手发布器工具函数
 *
 * 纯函数层，与 CDP 无关，可完全单元测试。
 * 架构与 weibo-publisher/utils.cjs、xiaohongshu-publisher/utils.cjs 保持一致。
 */

const fs = require('fs');
const path = require('path');

/**
 * 候选发布 URL（按优先级排序）。
 * 快手 API 改版后 photo-video 页面可能重定向；
 * 脚本会依次尝试直到找到可用 URL。
 */
const PUBLISH_URLS = [
  'https://cp.kuaishou.com/article/publish/photo-video',
  'https://cp.kuaishou.com/article/publish/photo',
];

/**
 * 收集目录中的图片文件（排序后）。
 * @param {string} dir - 内容目录路径
 * @returns {string[]} 图片绝对路径数组
 */
function findImages(dir) {
  const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  const files = fs.readdirSync(dir);
  return files
    .filter(f => imageExts.some(ext => f.toLowerCase().endsWith(ext)))
    .sort()
    .map(f => path.join(dir, f));
}

/**
 * 读取内容目录中的 content.txt 文案。
 * 文件不存在时返回空字符串。
 * @param {string} dir - 内容目录路径
 * @returns {string}
 */
function readContent(dir) {
  const file = path.join(dir, 'content.txt');
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8').trim();
}

/**
 * 将本地图片路径数组转换为 Windows PC 上的绝对路径。
 * @param {string[]} localImages - 本地图片路径数组
 * @param {string} windowsBaseDir - Windows 基础目录（如 C:\Users\xuxia\kuaishou-media）
 * @param {string} dateDir - 日期目录名（如 2026-03-08）
 * @param {string} contentDirName - 内容目录名（如 image-1）
 * @returns {string[]} Windows 路径数组
 */
function convertToWindowsPaths(localImages, windowsBaseDir, dateDir, contentDirName) {
  return localImages.map(img => {
    const filename = path.basename(img);
    return path.join(windowsBaseDir, dateDir, contentDirName, filename).replace(/\//g, '\\');
  });
}

/**
 * 转义字符串中的特殊字符，使其可安全注入到 CDP Runtime.evaluate JS 表达式。
 * @param {string} text - 原始文本
 * @returns {string} 转义后的文本
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
 * 从内容目录路径提取日期目录名和内容目录名。
 * 路径约定：~/.kuaishou-queue/{dateDir}/{contentDirName}
 * @param {string} contentDir - 内容目录绝对路径
 * @returns {{ dateDir: string, contentDirName: string }}
 */
function extractDirNames(contentDir) {
  const contentDirName = path.basename(contentDir);
  const dateDir = path.basename(path.dirname(contentDir));
  return { dateDir, contentDirName };
}

/**
 * 检测 URL 是否为快手 OAuth 登录重定向。
 * 会话过期时，cp.kuaishou.com 会重定向到 passport.kuaishou.com/pc/account/login/。
 * @param {string} url - 当前页面 URL
 * @returns {boolean}
 */
function isLoginRedirect(url) {
  if (!url || typeof url !== 'string') return false;
  return (
    url.includes('passport.kuaishou.com') ||
    url.includes('/account/login') ||
    url === 'https://cp.kuaishou.com/profile' ||
    (url.startsWith('https://cp.kuaishou.com/profile') && !url.includes('/article'))
  );
}

/**
 * 检测导航后的 URL 是否落在目标发布页面（而非被重定向）。
 * @param {string} url - 导航后实际 URL
 * @param {string} targetUrl - 期望的目标 URL
 * @returns {boolean}
 */
function isPublishPageReached(url, targetUrl) {
  if (!url || !targetUrl) return false;
  const targetPath = new URL(targetUrl).pathname;
  return url.includes('cp.kuaishou.com') && url.includes(targetPath);
}

module.exports = {
  PUBLISH_URLS,
  findImages,
  readContent,
  convertToWindowsPaths,
  escapeForJS,
  extractDirNames,
  isLoginRedirect,
  isPublishPageReached,
};
