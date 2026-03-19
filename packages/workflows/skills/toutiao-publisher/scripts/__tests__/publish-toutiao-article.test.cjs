'use strict';
/**
 * 今日头条发布脚本单元测试
 *
 * 测试范围：纯函数（无 SSH、无网络依赖）
 *
 * 运行：node --test packages/workflows/skills/toutiao-publisher/scripts/__tests__/publish-toutiao-article.test.cjs
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readFile, loadContent, validateContent } = require('../publish-toutiao-article.cjs');

// ─── readFile ────────────────────────────────────────────────────────────────

describe('readFile', () => {
  test('不存在的文件返回 null', () => {
    const result = readFile('/tmp/__nonexistent_toutiao_test__.txt');
    assert.equal(result, null);
  });

  test('读取存在的文件并 trim', () => {
    const tmpFile = path.join(os.tmpdir(), `toutiao-test-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, '  hello world  \n');
    try {
      const result = readFile(tmpFile);
      assert.equal(result, 'hello world');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});

// ─── loadContent ─────────────────────────────────────────────────────────────

describe('loadContent', () => {
  let tmpDir;

  test('加载完整内容目录', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toutiao-'));
    fs.writeFileSync(path.join(tmpDir, 'title.txt'), '测试标题');
    fs.writeFileSync(path.join(tmpDir, 'content.txt'), '测试正文内容');
    fs.writeFileSync(path.join(tmpDir, 'type.txt'), 'article');

    const { title, content, type, imagePath } = loadContent(tmpDir);
    assert.equal(title, '测试标题');
    assert.equal(content, '测试正文内容');
    assert.equal(type, 'article');
    assert.equal(imagePath, null);

    fs.rmSync(tmpDir, { recursive: true });
  });

  test('type.txt 缺失时默认 article', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toutiao-'));
    fs.writeFileSync(path.join(tmpDir, 'title.txt'), '标题');
    fs.writeFileSync(path.join(tmpDir, 'content.txt'), '内容');

    const { type } = loadContent(tmpDir);
    assert.equal(type, 'article');

    fs.rmSync(tmpDir, { recursive: true });
  });

  test('检测图片文件', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toutiao-'));
    fs.writeFileSync(path.join(tmpDir, 'title.txt'), '标题');
    fs.writeFileSync(path.join(tmpDir, 'content.txt'), '内容');
    fs.writeFileSync(path.join(tmpDir, 'image.jpg'), 'fake-image-data');

    const { imagePath } = loadContent(tmpDir);
    assert.ok(imagePath !== null);
    assert.ok(imagePath.endsWith('image.jpg'));

    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ─── validateContent ─────────────────────────────────────────────────────────

describe('validateContent', () => {
  test('缺少 content 时返回错误', () => {
    const result = validateContent({ title: '标题', content: null, type: 'article' });
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('content.txt'));
  });

  test('article 类型缺少 title 时返回错误', () => {
    const result = validateContent({ title: null, content: '内容', type: 'article' });
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('title.txt'));
  });

  test('weitoutiao 类型无需 title', () => {
    const result = validateContent({ title: null, content: '内容', type: 'weitoutiao' });
    assert.equal(result.valid, true);
    assert.equal(result.error, null);
  });

  test('完整 article 内容通过校验', () => {
    const result = validateContent({ title: '标题', content: '内容', type: 'article' });
    assert.equal(result.valid, true);
    assert.equal(result.error, null);
  });
});
