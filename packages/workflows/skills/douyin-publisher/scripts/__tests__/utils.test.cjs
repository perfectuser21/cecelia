'use strict';
/**
 * 抖音发布器工具函数单元测试
 *
 * 覆盖：图片查找、视频查找、标题/文案读取、标签读取、封面查找、
 *       Windows 路径转换、JS 转义、目录名提取、登录重定向检测、发布成功检测。
 *
 * 运行：
 *   node --test packages/workflows/skills/douyin-publisher/scripts/__tests__/utils.test.cjs
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const {
  VIDEO_PUBLISH_URL,
  IMAGE_PUBLISH_URL,
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
} = require('../utils.cjs');

// ============================================================
// Test 1: 常量
// ============================================================
describe('常量（URLs）', () => {
  test('VIDEO_PUBLISH_URL 包含 creator.douyin.com', () => {
    assert.ok(VIDEO_PUBLISH_URL.includes('creator.douyin.com'), 'VIDEO_PUBLISH_URL 应包含 creator.douyin.com');
    assert.ok(VIDEO_PUBLISH_URL.startsWith('https://'), 'VIDEO_PUBLISH_URL 应以 https:// 开头');
  });

  test('IMAGE_PUBLISH_URL 包含 default-tab=3', () => {
    assert.ok(IMAGE_PUBLISH_URL.includes('default-tab=3'), 'IMAGE_PUBLISH_URL 应包含 default-tab=3');
    assert.ok(IMAGE_PUBLISH_URL.startsWith('https://'), 'IMAGE_PUBLISH_URL 应以 https:// 开头');
  });

  test('SUCCESS_URL_PATTERNS 包含内容管理和上传页', () => {
    assert.ok(Array.isArray(SUCCESS_URL_PATTERNS), 'SUCCESS_URL_PATTERNS 应为数组');
    assert.ok(SUCCESS_URL_PATTERNS.some(p => p.includes('/content/manage')), '应包含 /content/manage');
    assert.ok(SUCCESS_URL_PATTERNS.some(p => p.includes('/content/upload')), '应包含 /content/upload');
  });
});

// ============================================================
// Test 2: findImages — 图片查找（排除 cover）
// ============================================================
describe('findImages（图片查找）', () => {
  let tmpDir;

  test('找到 jpg/png/gif/webp 图片并排序，排除 cover', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dy-find-images-'));
    fs.writeFileSync(path.join(tmpDir, 'image2.jpg'), 'fake');
    fs.writeFileSync(path.join(tmpDir, 'image1.png'), 'fake');
    fs.writeFileSync(path.join(tmpDir, 'image3.gif'), 'fake');
    fs.writeFileSync(path.join(tmpDir, 'cover.jpg'), 'fake');
    fs.writeFileSync(path.join(tmpDir, 'content.txt'), '文案');

    const images = findImages(tmpDir);
    assert.equal(images.length, 3, '应找到 3 张图片（不含 cover）');
    assert.ok(images[0].endsWith('image1.png'), '应按字母排序');
    assert.ok(images[1].endsWith('image2.jpg'));
    assert.ok(images[2].endsWith('image3.gif'));
    assert.ok(!images.some(p => p.includes('cover')), '不应包含 cover 文件');
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('空目录返回空数组', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dy-find-images-'));
    const images = findImages(tmpDir);
    assert.equal(images.length, 0, '空目录应返回空数组');
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('忽略非图片文件', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dy-find-images-'));
    fs.writeFileSync(path.join(tmpDir, 'photo.jpg'), 'fake');
    fs.writeFileSync(path.join(tmpDir, 'content.txt'), '文案');
    fs.writeFileSync(path.join(tmpDir, 'title.txt'), '标题');

    const images = findImages(tmpDir);
    assert.equal(images.length, 1, '只应找到 1 张图片');
    assert.ok(images[0].endsWith('photo.jpg'));
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ============================================================
// Test 3: findVideo — 视频查找
// ============================================================
describe('findVideo（视频查找）', () => {
  let tmpDir;

  test('找到 mp4 视频', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dy-find-video-'));
    fs.writeFileSync(path.join(tmpDir, 'video.mp4'), 'fake');
    fs.writeFileSync(path.join(tmpDir, 'title.txt'), '标题');

    const video = findVideo(tmpDir);
    assert.ok(video !== null, '应找到视频文件');
    assert.ok(video.endsWith('video.mp4'), '应返回 mp4 路径');
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('找到 mov 视频', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dy-find-video-'));
    fs.writeFileSync(path.join(tmpDir, 'clip.mov'), 'fake');

    const video = findVideo(tmpDir);
    assert.ok(video !== null);
    assert.ok(video.endsWith('clip.mov'));
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('无视频文件时返回 null', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dy-find-video-'));
    fs.writeFileSync(path.join(tmpDir, 'title.txt'), '标题');

    const video = findVideo(tmpDir);
    assert.equal(video, null, '无视频文件应返回 null');
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('多个视频文件时返回第一个（按字母排序）', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dy-find-video-'));
    fs.writeFileSync(path.join(tmpDir, 'b-video.mp4'), 'fake');
    fs.writeFileSync(path.join(tmpDir, 'a-video.mp4'), 'fake');

    const video = findVideo(tmpDir);
    assert.ok(video.endsWith('a-video.mp4'), '应返回字母序第一个视频');
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ============================================================
// Test 4: readTitle — 标题读取
// ============================================================
describe('readTitle（标题读取）', () => {
  test('正确读取 title.txt 并去除首尾空格', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dy-title-'));
    fs.writeFileSync(path.join(tmpDir, 'title.txt'), '  抖音视频标题  ');
    assert.equal(readTitle(tmpDir), '抖音视频标题');
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('无 title.txt 时返回空字符串', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dy-title-'));
    assert.equal(readTitle(tmpDir), '');
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ============================================================
// Test 5: readContent — 文案读取
// ============================================================
describe('readContent（文案读取）', () => {
  test('正确读取 content.txt 文案', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dy-content-'));
    fs.writeFileSync(path.join(tmpDir, 'content.txt'), '  这是抖音文案  ');
    assert.equal(readContent(tmpDir), '这是抖音文案');
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('无 content.txt 时返回空字符串', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dy-content-'));
    assert.equal(readContent(tmpDir), '');
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ============================================================
// Test 6: readTags — 标签读取
// ============================================================
describe('readTags（标签读取）', () => {
  test('逗号分隔的标签正确解析', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dy-tags-'));
    fs.writeFileSync(path.join(tmpDir, 'tags.txt'), '标签1, 标签2, 标签3');
    const tags = readTags(tmpDir);
    assert.equal(tags.length, 3);
    assert.equal(tags[0], '标签1');
    assert.equal(tags[1], '标签2');
    assert.equal(tags[2], '标签3');
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('每行一个标签，去除 # 前缀', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dy-tags-'));
    fs.writeFileSync(path.join(tmpDir, 'tags.txt'), '#标签A\n#标签B\n标签C');
    const tags = readTags(tmpDir);
    assert.deepEqual(tags, ['标签A', '标签B', '标签C']);
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('无 tags.txt 时返回空数组', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dy-tags-'));
    assert.deepEqual(readTags(tmpDir), []);
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('过滤空标签', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dy-tags-'));
    fs.writeFileSync(path.join(tmpDir, 'tags.txt'), '标签1,,, 标签2');
    const tags = readTags(tmpDir);
    assert.equal(tags.length, 2);
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ============================================================
// Test 7: findCover — 封面查找
// ============================================================
describe('findCover（封面查找）', () => {
  test('找到 cover.jpg', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dy-cover-'));
    fs.writeFileSync(path.join(tmpDir, 'cover.jpg'), 'fake');
    const cover = findCover(tmpDir);
    assert.ok(cover !== null);
    assert.ok(cover.endsWith('cover.jpg'));
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('cover.jpg 优先于 cover.png', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dy-cover-'));
    fs.writeFileSync(path.join(tmpDir, 'cover.jpg'), 'fake');
    fs.writeFileSync(path.join(tmpDir, 'cover.png'), 'fake');
    const cover = findCover(tmpDir);
    assert.ok(cover.endsWith('cover.jpg'), 'cover.jpg 应优先');
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('无封面文件时返回 null', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dy-cover-'));
    fs.writeFileSync(path.join(tmpDir, 'title.txt'), '标题');
    assert.equal(findCover(tmpDir), null);
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ============================================================
// Test 8: convertToWindowsPaths — Windows 路径转换
// ============================================================
describe('convertToWindowsPaths（Windows 路径转换）', () => {
  const WINDOWS_BASE_DIR = 'C:\\Users\\xuxia\\douyin-media';

  test('生成正确的 Windows 路径', () => {
    const localPaths = ['/Users/admin/.douyin-queue/2026-03-19/video-1/video.mp4'];
    const result = convertToWindowsPaths(localPaths, WINDOWS_BASE_DIR, '2026-03-19', 'video-1');
    assert.equal(result[0], 'C:\\Users\\xuxia\\douyin-media\\2026-03-19\\video-1\\video.mp4');
  });

  test('路径使用反斜杠，无正斜杠', () => {
    const localPaths = ['/tmp/queue/2026-03-19/image-2/cover.png'];
    const result = convertToWindowsPaths(localPaths, WINDOWS_BASE_DIR, '2026-03-19', 'image-2');
    assert.ok(!result[0].includes('/'), '不应含正斜杠');
    assert.ok(result[0].includes('\\'), '应含反斜杠');
  });

  test('多个文件路径转换', () => {
    const localPaths = [
      '/tmp/.douyin-queue/2026-03-19/image-3/img1.jpg',
      '/tmp/.douyin-queue/2026-03-19/image-3/img2.jpg',
    ];
    const result = convertToWindowsPaths(localPaths, WINDOWS_BASE_DIR, '2026-03-19', 'image-3');
    assert.equal(result.length, 2);
    assert.ok(result[0].endsWith('\\img1.jpg'));
    assert.ok(result[1].endsWith('\\img2.jpg'));
  });
});

// ============================================================
// Test 9: extractDirNames — 目录名提取
// ============================================================
describe('extractDirNames（目录名提取）', () => {
  test('正确提取抖音队列路径的日期和内容目录名', () => {
    const result = extractDirNames('/Users/admin/.douyin-queue/2026-03-19/video-1');
    assert.equal(result.dateDir, '2026-03-19');
    assert.equal(result.contentDirName, 'video-1');
  });

  test('图文目录名提取', () => {
    const result = extractDirNames('/tmp/queue/2026-03-20/image-5');
    assert.equal(result.dateDir, '2026-03-20');
    assert.equal(result.contentDirName, 'image-5');
  });
});

// ============================================================
// Test 10: escapeForJS — JS 注入转义
// ============================================================
describe('escapeForJS（JS 注入转义）', () => {
  test('换行符正确转义', () => {
    const result = escapeForJS('第一段\n第二段');
    assert.ok(result.includes('\\n'), '换行应转义为 \\n');
    assert.ok(!result.includes('\n'), '不应含原始换行符');
  });

  test('中文内容不被破坏', () => {
    const text = '抖音发布测试，中文正常';
    const result = escapeForJS(text);
    assert.equal(result, text, '中文内容应原样保留');
  });

  test('单引号正确转义', () => {
    const result = escapeForJS("it's fine");
    assert.ok(result.includes("\\'"), '单引号应被转义');
  });

  test('双引号正确转义', () => {
    const result = escapeForJS('say "hello"');
    assert.ok(result.includes('\\"'), '双引号应被转义');
  });
});

// ============================================================
// Test 11: isLoginRedirect — 登录重定向检测
// ============================================================
describe('isLoginRedirect（登录重定向检测）', () => {
  test('识别 passport.douyin.com 重定向', () => {
    assert.ok(
      isLoginRedirect('https://passport.douyin.com/login?service=creator'),
      '应识别 passport.douyin.com 为登录重定向'
    );
  });

  test('识别 /login 路径', () => {
    assert.ok(
      isLoginRedirect('https://creator.douyin.com/login?next=...'),
      '应识别 /login 为登录重定向'
    );
  });

  test('识别 sso.douyin.com', () => {
    assert.ok(
      isLoginRedirect('https://sso.douyin.com/auth?redirect=...'),
      '应识别 sso.douyin.com 为登录重定向'
    );
  });

  test('正常发布页面不被误判', () => {
    assert.ok(
      !isLoginRedirect('https://creator.douyin.com/creator-micro/content/upload'),
      '发布页面不应被判断为登录重定向'
    );
  });

  test('内容管理页面不被误判', () => {
    assert.ok(
      !isLoginRedirect('https://creator.douyin.com/creator-micro/content/manage'),
      '内容管理页面不应被判断为登录重定向'
    );
  });

  test('空值返回 false', () => {
    assert.equal(isLoginRedirect(''), false);
    assert.equal(isLoginRedirect(null), false);
    assert.equal(isLoginRedirect(undefined), false);
  });
});

// ============================================================
// Test 12: isPublishSuccess — 发布成功检测
// ============================================================
describe('isPublishSuccess（发布成功检测）', () => {
  test('URL 包含 /content/manage 视为成功', () => {
    assert.ok(
      isPublishSuccess('https://creator.douyin.com/creator-micro/content/manage'),
      '/content/manage 应视为成功'
    );
  });

  test('URL 包含 /content/upload 视为成功', () => {
    assert.ok(
      isPublishSuccess('https://creator.douyin.com/creator-micro/content/upload'),
      '/content/upload 应视为成功'
    );
  });

  test('页面文本包含"发布成功"视为成功', () => {
    assert.ok(
      isPublishSuccess(null, '恭喜！发布成功，您的作品已上传'),
      '包含"发布成功"文本应视为成功'
    );
  });

  test('正在发布的 URL 不视为成功', () => {
    assert.ok(
      !isPublishSuccess('https://creator.douyin.com/creator-micro/content/post/video'),
      '编辑页面 URL 不应视为成功'
    );
  });

  test('空值都为 false', () => {
    assert.equal(isPublishSuccess(null, null), false);
    assert.equal(isPublishSuccess('', ''), false);
    assert.equal(isPublishSuccess(undefined, undefined), false);
  });
});

// ============================================================
// Test 13: parseArgs — 命令行参数解析
// ============================================================
describe('parseArgs（命令行参数解析）', () => {
  test('正确解析 --content 参数', () => {
    const result = parseArgs(['node', 'script.cjs', '--content', '/tmp/video-1']);
    assert.equal(result.contentDir, '/tmp/video-1');
    assert.equal(result.dryRun, false);
  });

  test('正确解析 --dry-run 标志', () => {
    const result = parseArgs(['node', 'script.cjs', '--content', '/tmp/video-1', '--dry-run']);
    assert.equal(result.contentDir, '/tmp/video-1');
    assert.equal(result.dryRun, true);
  });

  test('无参数时 contentDir 为 null', () => {
    const result = parseArgs(['node', 'script.cjs']);
    assert.equal(result.contentDir, null);
    assert.equal(result.dryRun, false);
  });

  test('--content 是最后一个参数时返回 null（无值）', () => {
    const result = parseArgs(['node', 'script.cjs', '--content']);
    assert.equal(result.contentDir, null, '无值时应返回 null');
  });
});
