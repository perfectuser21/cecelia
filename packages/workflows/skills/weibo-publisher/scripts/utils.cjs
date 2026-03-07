#!/usr/bin/env node
/**
 * 微博发布器 - 工具函数
 *
 * 纯函数，可单元测试，供 publish-weibo-image.cjs 和 batch 脚本使用
 */

'use strict';

const path = require('path');
const fs = require('fs');

/**
 * 扫描目录中所有图片文件，按文件名排序返回绝对路径数组
 *
 * @param {string} dir - 目录路径
 * @param {object} [fsModule] - fs 模块（可注入用于测试）
 * @returns {string[]} 图片文件绝对路径数组
 */
function findImages(dir, fsModule) {
  const fsImpl = fsModule || fs;
  const files = fsImpl.readdirSync(dir);
  const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  return files
    .filter(f => imageExts.some(ext => f.toLowerCase().endsWith(ext)))
    .sort()
    .map(f => path.join(dir, f));
}

/**
 * 读取内容目录中的文案文本
 *
 * @param {string} contentDir - 内容目录路径
 * @param {object} [fsModule] - fs 模块（可注入用于测试）
 * @returns {string} 文案内容（修剪空白），文件不存在时返回空字符串
 */
function readContent(contentDir, fsModule) {
  const fsImpl = fsModule || fs;
  const contentFile = path.join(contentDir, 'content.txt');
  if (!fsImpl.existsSync(contentFile)) {
    return '';
  }
  return fsImpl.readFileSync(contentFile, 'utf8').trim();
}

/**
 * 将本地图片路径数组转换为 Windows 绝对路径数组
 *
 * 目录结构：{windowsBaseDir}/{dateDir}/{contentDirName}/{filename}
 *
 * @param {string[]} localImages - 本地图片路径数组
 * @param {string} windowsBaseDir - Windows 基础目录（如 C:\Users\xuxia\weibo-media）
 * @param {string} dateDir - 日期目录名（如 2026-03-07）
 * @param {string} contentDirName - 内容目录名（如 image-1）
 * @returns {string[]} Windows 路径数组（反斜杠分隔）
 */
function convertToWindowsPaths(localImages, windowsBaseDir, dateDir, contentDirName) {
  return localImages.map(img => {
    const filename = path.basename(img);
    return path.join(windowsBaseDir, dateDir, contentDirName, filename).replace(/\//g, '\\');
  });
}

/**
 * 转义字符串用于 JavaScript 字符串注入（CDP Runtime.evaluate）
 *
 * @param {string} text - 原始文本
 * @returns {string} 安全转义后的字符串
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
 * 从内容目录路径提取日期目录名和内容目录名
 *
 * 期望结构：.../{dateDir}/{contentDirName}/
 *
 * @param {string} contentDir - 内容目录绝对路径
 * @returns {{ dateDir: string, contentDirName: string }}
 */
function extractDirNames(contentDir) {
  const contentDirName = path.basename(contentDir);
  const dateDir = path.basename(path.dirname(contentDir));
  return { dateDir, contentDirName };
}

module.exports = {
  findImages,
  readContent,
  convertToWindowsPaths,
  escapeForJS,
  extractDirNames,
};
