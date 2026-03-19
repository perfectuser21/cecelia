'use strict';
/**
 * 快手视频发布器单元测试
 *
 * 测试范围：纯函数（无网络、无 CDP 依赖）
 *
 * 运行：NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules \
 *        node --test packages/workflows/skills/kuaishou-publisher/scripts/__tests__/publish-kuaishou-video.test.cjs
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseCookieHeader,
  isSessionValid,
  isLoginError,
  isRateLimit,
  parseKuaishouResponse,
  parseArgs,
  buildImageUploadForm,
} = require('../publish-kuaishou-video.cjs');

// ============================================================
// parseCookieHeader
// ============================================================
describe('parseCookieHeader', () => {
  test('空数组 → 空 cookieHeader、null sessionToken 和 null userId', () => {
    const result = parseCookieHeader([]);
    assert.equal(result.cookieHeader, '');
    assert.equal(result.sessionToken, null);
    assert.equal(result.userId, null);
  });

  test('null → 空 cookieHeader', () => {
    const result = parseCookieHeader(null);
    assert.equal(result.cookieHeader, '');
    assert.equal(result.sessionToken, null);
  });

  test('单个 cookie → 正确的 header 字符串', () => {
    const cookies = [{ name: 'kuaishou.web.cp.api_st', value: 'abc123' }];
    const { cookieHeader } = parseCookieHeader(cookies);
    assert.equal(cookieHeader, 'kuaishou.web.cp.api_st=abc123');
  });

  test('多个 cookie → 用分号空格连接', () => {
    const cookies = [
      { name: 'kuaishou.web.cp.api_st', value: 'st123' },
      { name: 'userId', value: '456' },
      { name: 'did', value: 'device789' },
    ];
    const { cookieHeader } = parseCookieHeader(cookies);
    assert.equal(cookieHeader, 'kuaishou.web.cp.api_st=st123; userId=456; did=device789');
  });

  test('api_st 出现在 api_ph 前时返回 api_st 值', () => {
    const cookies = [
      { name: 'kuaishou.web.cp.api_st', value: 'st222' },
      { name: 'kuaishou.web.cp.api_ph', value: 'ph111' },
    ];
    const { sessionToken } = parseCookieHeader(cookies);
    assert.equal(sessionToken, 'st222');
  });

  test('只有 api_ph 时 sessionToken 为 api_ph 值', () => {
    const cookies = [{ name: 'kuaishou.web.cp.api_ph', value: 'ph333' }];
    const { sessionToken } = parseCookieHeader(cookies);
    assert.equal(sessionToken, 'ph333');
  });

  test('提取 userId', () => {
    const cookies = [
      { name: 'kuaishou.web.cp.api_st', value: 'st' },
      { name: 'userId', value: '9988' },
    ];
    const { userId } = parseCookieHeader(cookies);
    assert.equal(userId, '9988');
  });
});

// ============================================================
// isSessionValid
// ============================================================
describe('isSessionValid', () => {
  test('空数组 → false', () => {
    assert.equal(isSessionValid([]), false);
  });

  test('null → false', () => {
    assert.equal(isSessionValid(null), false);
  });

  test('不含会话 cookie → false', () => {
    const cookies = [
      { name: 'did', value: 'device123' },
      { name: 'userId', value: '456' },
    ];
    assert.equal(isSessionValid(cookies), false);
  });

  test('含 api_st → true', () => {
    const cookies = [{ name: 'kuaishou.web.cp.api_st', value: 'abc' }];
    assert.equal(isSessionValid(cookies), true);
  });

  test('含 api_ph → true', () => {
    const cookies = [{ name: 'kuaishou.web.cp.api_ph', value: 'xyz' }];
    assert.equal(isSessionValid(cookies), true);
  });
});

// ============================================================
// isLoginError
// ============================================================
describe('isLoginError', () => {
  test('HTTP 401 → true', () => {
    assert.equal(isLoginError(401, ''), true);
  });

  test('HTTP 403 → true', () => {
    assert.equal(isLoginError(403, ''), true);
  });

  test('HTTP 200 + 正常响应 → false', () => {
    assert.equal(isLoginError(200, '{"result":1}'), false);
  });

  test('HTTP 200 + 含"未登录" → true', () => {
    assert.equal(isLoginError(200, '{"message":"未登录"}'), true);
  });

  test('HTTP 200 + 含"请登录" → true', () => {
    assert.equal(isLoginError(200, '请登录后操作'), true);
  });

  test('HTTP 200 + null body → false', () => {
    assert.equal(isLoginError(200, null), false);
  });
});

// ============================================================
// isRateLimit
// ============================================================
describe('isRateLimit', () => {
  test('null → false', () => {
    assert.equal(isRateLimit(null), false);
  });

  test('正常响应 → false', () => {
    assert.equal(isRateLimit('{"result":1}'), false);
  });

  test('含"频率限制" → true', () => {
    assert.equal(isRateLimit('操作频率限制'), true);
  });

  test('含"操作频繁" → true', () => {
    assert.equal(isRateLimit('操作频繁，请稍后重试'), true);
  });

  test('含"too frequent" → true', () => {
    assert.equal(isRateLimit('too frequent'), true);
  });
});

// ============================================================
// parseKuaishouResponse
// ============================================================
describe('parseKuaishouResponse', () => {
  test('result=1 → ok=true', () => {
    const { ok, errorMsg } = parseKuaishouResponse('{"result":1,"data":{"work_id":"123"}}');
    assert.equal(ok, true);
    assert.equal(errorMsg, null);
  });

  test('result=0 + error_msg → ok=false, errorMsg 正确', () => {
    const { ok, errorMsg } = parseKuaishouResponse('{"result":0,"error_msg":"视频格式错误"}');
    assert.equal(ok, false);
    assert.equal(errorMsg, '视频格式错误');
  });

  test('code=200 → ok=true', () => {
    const { ok } = parseKuaishouResponse('{"code":200,"data":{}}');
    assert.equal(ok, true);
  });

  test('无效 JSON → ok=false', () => {
    const { ok, errorMsg } = parseKuaishouResponse('not json');
    assert.equal(ok, false);
    assert.match(errorMsg, /响应解析失败/);
  });
});

// ============================================================
// parseArgs
// ============================================================
describe('parseArgs', () => {
  test('必填参数正确解析', () => {
    const { video, title } = parseArgs(['node', 'script.cjs', '--video', '/tmp/video.mp4', '--title', '测试视频']);
    assert.equal(video, '/tmp/video.mp4');
    assert.equal(title, '测试视频');
  });

  test('--tags 按逗号分割', () => {
    const { tags } = parseArgs(['node', 'script.cjs', '--video', 'v.mp4', '--title', 't', '--tags', '健身,运动,生活']);
    assert.deepEqual(tags, ['健身', '运动', '生活']);
  });

  test('无 --tags → 空数组', () => {
    const { tags } = parseArgs(['node', 'script.cjs', '--video', 'v.mp4', '--title', 't']);
    assert.deepEqual(tags, []);
  });

  test('--cover 可选', () => {
    const { cover } = parseArgs(['node', 'script.cjs', '--video', 'v.mp4', '--title', 't', '--cover', '/tmp/cover.jpg']);
    assert.equal(cover, '/tmp/cover.jpg');
  });

  test('无 --cover → null', () => {
    const { cover } = parseArgs(['node', 'script.cjs', '--video', 'v.mp4', '--title', 't']);
    assert.equal(cover, null);
  });

  test('无任何参数 → 全部 null/空', () => {
    const { video, title, tags, cover } = parseArgs(['node', 'script.cjs']);
    assert.equal(video, null);
    assert.equal(title, null);
    assert.deepEqual(tags, []);
    assert.equal(cover, null);
  });
});

// ============================================================
// buildImageUploadForm
// ============================================================
describe('buildImageUploadForm', () => {
  test('返回 Buffer', () => {
    const buf = buildImageUploadForm(Buffer.from('imgdata'), 'cover.jpg', 'boundary123', { token: 'tok' });
    assert.ok(Buffer.isBuffer(buf));
  });

  test('包含 boundary', () => {
    const buf = buildImageUploadForm(Buffer.from('data'), 'f.jpg', 'myboundary', {});
    assert.ok(buf.toString().includes('myboundary'));
  });

  test('包含文件名', () => {
    const buf = buildImageUploadForm(Buffer.from('data'), 'cover.jpg', 'bnd', {});
    assert.ok(buf.toString().includes('cover.jpg'));
  });

  test('包含额外字段', () => {
    const buf = buildImageUploadForm(Buffer.from('data'), 'img.png', 'bnd', { token: 'mytoken' });
    assert.ok(buf.toString().includes('mytoken'));
  });

  test('JPEG 文件 → Content-Type image/jpeg', () => {
    const buf = buildImageUploadForm(Buffer.from('data'), 'photo.jpeg', 'bnd', {});
    assert.ok(buf.toString().includes('image/jpeg'));
  });

  test('PNG 文件 → Content-Type image/png', () => {
    const buf = buildImageUploadForm(Buffer.from('data'), 'cover.png', 'bnd', {});
    assert.ok(buf.toString().includes('image/png'));
  });

  test('未知扩展名 → 默认 image/jpeg', () => {
    const buf = buildImageUploadForm(Buffer.from('data'), 'file.bmp', 'bnd', {});
    assert.ok(buf.toString().includes('image/jpeg'));
  });
});
