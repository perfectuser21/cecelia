'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const SCRIPT_PATH = path.resolve(__dirname, '../publish-weibo-image.cjs');
const scriptContent = fs.readFileSync(SCRIPT_PATH, 'utf8');

describe('CDP 端点配置', () => {
  test('CDP_PORT 应为 19227', () => {
    assert.ok(scriptContent.includes('CDP_PORT = 19227'), 'CDP_PORT 应固定为 19227');
  });

  test('WINDOWS_IP 应为有效 Tailscale IP（100.x.x.x）', () => {
    const ipMatch = scriptContent.match(/WINDOWS_IP\s*=\s*'([\d.]+)'/);
    assert.ok(ipMatch, 'WINDOWS_IP 常量应存在');
    assert.ok(
      /^100\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ipMatch[1]),
      `WINDOWS_IP 应为 Tailscale IP 格式（100.x.x.x），实际为: ${ipMatch && ipMatch[1]}`
    );
  });

  test('CDP 连接使用 /json 端点发现页面', () => {
    assert.ok(
      scriptContent.includes('WINDOWS_IP') && scriptContent.includes('CDP_PORT'),
      'CDP 连接应使用 WINDOWS_IP 和 CDP_PORT'
    );
    assert.ok(scriptContent.includes('/json'), 'CDP 应使用 /json 端点发现页面');
  });
});

describe('Windows 路径配置', () => {
  test('WINDOWS_BASE_DIR 应以 C:\\ 开头', () => {
    const match = scriptContent.match(/WINDOWS_BASE_DIR\s*=\s*'([^']+)'/);
    assert.ok(match, 'WINDOWS_BASE_DIR 常量应存在');
    assert.ok(match[1].startsWith('C:\\'), `WINDOWS_BASE_DIR 应以 C:\\ 开头，实际为: ${match && match[1]}`);
    assert.ok(match[1].includes('Users'), 'WINDOWS_BASE_DIR 应包含 Users 目录');
  });

  test('Windows 路径使用反斜杠', () => {
    const match = scriptContent.match(/WINDOWS_BASE_DIR\s*=\s*'([^']+)'/);
    assert.ok(match, 'WINDOWS_BASE_DIR 常量应存在');
    assert.ok(match[1].includes('\\'), 'Windows 路径应使用反斜杠');
    assert.ok(!match[1].includes('/'), 'Windows 路径不应使用正斜杠');
  });

  test('convertToWindowsPaths 被调用', () => {
    assert.ok(
      scriptContent.includes('convertToWindowsPaths('),
      'convertToWindowsPaths 函数应被调用以转换路径格式'
    );
  });
});

describe('平台限制常量', () => {
  test('MAX_IMAGES 应为 9', () => {
    assert.ok(scriptContent.includes('MAX_IMAGES = 9'), 'MAX_IMAGES 应固定为 9（微博平台限制）');
  });

  test('超出 MAX_IMAGES 时应有截断警告', () => {
    assert.ok(
      scriptContent.includes('超过微博限制') || scriptContent.includes('已截断') || scriptContent.includes('MAX_IMAGES'),
      '超出图片上限时应有警告或截断处理'
    );
  });
});

describe('发布端点验证', () => {
  test('发布页 URL 应指向 weibo.com/p/publish/', () => {
    assert.ok(
      scriptContent.includes('weibo.com/p/publish/'),
      '发布页 URL 应包含 weibo.com/p/publish/'
    );
  });

  test('发布页 URL 使用 HTTPS', () => {
    const urlMatch = scriptContent.match(/https?:\/\/weibo\.com[^\s'"]+/);
    assert.ok(urlMatch, '应存在 weibo.com URL');
    assert.ok(urlMatch[0].startsWith('https://'), `发布 URL 应使用 HTTPS，实际为: ${urlMatch && urlMatch[0]}`);
  });

  test('登录失效检测逻辑存在', () => {
    assert.ok(
      scriptContent.includes('passport.weibo.com') || scriptContent.includes('login'),
      '应包含登录失效检测（passport.weibo.com 重定向）'
    );
  });
});

describe('验证码选择器完整性', () => {
  test('包含 GeeTest 选择器', () => {
    assert.ok(scriptContent.includes('geetest'), '应包含 GeeTest 验证码选择器');
  });

  test('包含天鉴 tc 类选择器', () => {
    assert.ok(
      scriptContent.includes('tc-9bad') || scriptContent.includes('tc-action'),
      '应包含天鉴（tc-9bad 或 tc-action）验证码选择器'
    );
  });

  test('包含通用 captcha 选择器', () => {
    assert.ok(scriptContent.includes('captcha'), '应包含通用 captcha 选择器');
  });

  test('验证码处理保存截图', () => {
    assert.ok(
      scriptContent.includes('captcha-detected') || scriptContent.includes('captcha-failed'),
      '验证码触发时应保存截图以便排查'
    );
  });
});

describe('工具函数引用完整性', () => {
  test('使用 readContent', () => {
    assert.ok(scriptContent.includes('readContent('), 'readContent 函数应被引用');
  });

  test('使用 escapeForJS', () => {
    assert.ok(scriptContent.includes('escapeForJS('), 'escapeForJS 函数应被引用');
  });

  test('使用 extractDirNames', () => {
    assert.ok(scriptContent.includes('extractDirNames('), 'extractDirNames 函数应被引用');
  });

  test('使用 findImages', () => {
    assert.ok(scriptContent.includes('findImages('), 'findImages 函数应被引用');
  });
});
