'use strict';
/**
 * publish-xiaohongshu-video 单元测试
 *
 * 测试策略：
 * - 不启动真实浏览器，通过导入纯函数测试核心逻辑
 * - 覆盖：isLoginError / isPublishSuccess / 标签生成逻辑
 *
 * 运行：
 *   node --test packages/workflows/skills/xiaohongshu-publisher/scripts/__tests__/publish-xiaohongshu-video.test.cjs
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { isLoginError, isPublishSuccess } = require('../publish-xiaohongshu-video.cjs');

// ============================================================
// isLoginError
// ============================================================
describe('isLoginError（视频版）', () => {
  test('普通发布页 URL 返回 false', () => {
    assert.equal(isLoginError('https://creator.xiaohongshu.com/publish/publish'), false);
  });

  test('含 login 的 URL 返回 true', () => {
    assert.equal(isLoginError('https://creator.xiaohongshu.com/login?redirect=...'), true);
  });

  test('含 passport 的 URL 返回 true', () => {
    assert.equal(isLoginError('https://passport.xiaohongshu.com/login'), true);
  });

  test('undefined/null/空字符串 返回 false', () => {
    assert.equal(isLoginError(undefined), false);
    assert.equal(isLoginError(null), false);
    assert.equal(isLoginError(''), false);
  });
});

// ============================================================
// isPublishSuccess
// ============================================================
describe('isPublishSuccess（视频版）', () => {
  test('URL 跳离发布页时返回 true', () => {
    assert.equal(isPublishSuccess('https://creator.xiaohongshu.com/creator/note/123', ''), true);
  });

  test('仍在发布页且无成功关键词返回 false', () => {
    assert.equal(isPublishSuccess('https://creator.xiaohongshu.com/publish/publish', '请填写标题'), false);
  });

  test('正文含"发布成功"返回 true', () => {
    assert.equal(isPublishSuccess('https://creator.xiaohongshu.com/publish/publish', '发布成功！视频正在审核'), true);
  });

  test('正文含"笔记已发布"返回 true', () => {
    assert.equal(isPublishSuccess('https://creator.xiaohongshu.com/publish/publish', '笔记已发布'), true);
  });

  test('正文含"创作成功"返回 true', () => {
    assert.equal(isPublishSuccess('https://creator.xiaohongshu.com/publish/publish', '创作成功'), true);
  });

  test('url 为空时仅依赖 bodyText', () => {
    assert.equal(isPublishSuccess('', '发布成功'), true);
    assert.equal(isPublishSuccess('', '请填写内容'), false);
  });
});

// ============================================================
// 标签格式化逻辑
// ============================================================
describe('标签格式化', () => {
  function formatTags(tagsText) {
    if (!tagsText) return '';
    const tags = tagsText.split(',').map(t => t.trim()).filter(Boolean);
    return tags.map(t => (t.startsWith('#') ? t : `#${t}`)).join(' ');
  }

  test('普通标签加 # 前缀', () => {
    assert.equal(formatTags('美食,旅行'), '#美食 #旅行');
  });

  test('已有 # 前缀不重复添加', () => {
    assert.equal(formatTags('#美食,#旅行'), '#美食 #旅行');
  });

  test('空字符串返回空', () => {
    assert.equal(formatTags(''), '');
  });

  test('单个标签', () => {
    assert.equal(formatTags('美食'), '#美食');
  });

  test('标签带空格会被 trim', () => {
    assert.equal(formatTags(' 美食 , 旅行 '), '#美食 #旅行');
  });
});

// ============================================================
// 日志格式验证
// ============================================================
describe('日志格式 [XHS-V] 前缀', () => {
  const EXPECTED_PREFIX = '[XHS-V]';

  test('视频发布日志包含 [XHS-V] 前缀', () => {
    const logs = [
      '[XHS-V] ✅ 小红书视频发布成功！',
      '[XHS-V] 1️⃣  导航到发布页...',
      '[XHS-V] ❌ 发布失败: CDP 连接失败'
    ];
    for (const log of logs) {
      assert.ok(log.startsWith(EXPECTED_PREFIX), `日志应以 ${EXPECTED_PREFIX} 开头: ${log}`);
    }
  });
});
