'use strict';
/**
 * validate-schedule-json.sh 逻辑验证测试
 *
 * 测试 schedule.json 格式规范的关键约束（纯 JS，不执行 shell 脚本）
 * 运行：node --test packages/workflows/scripts/__tests__/validate-schedule-json.test.cjs
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// ─── 内联验证逻辑（与 validate-schedule-json.sh 保持一致）───────────────────
const VALID_PLATFORMS = ['douyin', 'xiaohongshu', 'weibo', 'kuaishou', 'toutiao', 'zhihu', 'wechat', 'shipinhao'];
const VALID_CONTENT_TYPES = ['video', 'image', 'article'];
const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function validateSchedule(json) {
  const errors = [];

  if (!json.publishAt) {
    errors.push('缺少必填字段：publishAt');
  } else if (!ISO_8601_RE.test(json.publishAt)) {
    errors.push(`publishAt 格式无效：${json.publishAt}`);
  }

  if (!json.platforms) {
    errors.push('缺少必填字段：platforms');
  } else if (!Array.isArray(json.platforms) || json.platforms.length === 0) {
    errors.push('platforms 不能为空数组');
  } else {
    const invalid = json.platforms.filter(p => !VALID_PLATFORMS.includes(p));
    if (invalid.length > 0) errors.push(`无效平台：${invalid.join(', ')}`);
  }

  if (json.contentType && !VALID_CONTENT_TYPES.includes(json.contentType)) {
    errors.push(`无效 contentType：${json.contentType}`);
  }

  return errors;
}

// ─── 测试：publishAt 验证 ──────────────────────────────────────────────────────
describe('publishAt 字段验证', () => {
  test('缺少 publishAt 报错', () => {
    const errors = validateSchedule({ platforms: ['douyin'] });
    assert.ok(errors.some(e => e.includes('publishAt')), '应报 publishAt 错误');
  });

  test('合法 ISO 8601 格式通过', () => {
    const errors = validateSchedule({
      publishAt: '2026-03-19T14:00:00+08:00',
      platforms: ['douyin'],
    });
    assert.equal(errors.length, 0, `应无错误，实际：${errors.join(', ')}`);
  });

  test('非 ISO 8601 格式报错', () => {
    const errors = validateSchedule({
      publishAt: '2026/03/19 14:00',
      platforms: ['douyin'],
    });
    assert.ok(errors.some(e => e.includes('publishAt')), '应报格式错误');
  });

  test('仅日期（无时间）报错', () => {
    const errors = validateSchedule({
      publishAt: '2026-03-19',
      platforms: ['douyin'],
    });
    assert.ok(errors.some(e => e.includes('publishAt')), '应报格式错误');
  });
});

// ─── 测试：platforms 验证 ──────────────────────────────────────────────────────
describe('platforms 字段验证', () => {
  test('缺少 platforms 报错', () => {
    const errors = validateSchedule({ publishAt: '2026-03-19T14:00:00+08:00' });
    assert.ok(errors.some(e => e.includes('platforms')), '应报 platforms 错误');
  });

  test('空数组报错', () => {
    const errors = validateSchedule({
      publishAt: '2026-03-19T14:00:00+08:00',
      platforms: [],
    });
    assert.ok(errors.some(e => e.includes('platforms')), '应报空数组错误');
  });

  test('合法单平台通过', () => {
    const errors = validateSchedule({
      publishAt: '2026-03-19T14:00:00+08:00',
      platforms: ['douyin'],
    });
    assert.equal(errors.length, 0);
  });

  test('合法多平台通过', () => {
    const errors = validateSchedule({
      publishAt: '2026-03-19T14:00:00+08:00',
      platforms: ['douyin', 'xiaohongshu', 'weibo'],
    });
    assert.equal(errors.length, 0);
  });

  test('非法平台名报错', () => {
    const errors = validateSchedule({
      publishAt: '2026-03-19T14:00:00+08:00',
      platforms: ['twitter', 'instagram'],
    });
    assert.ok(errors.some(e => e.includes('twitter') || e.includes('无效平台')), '应报无效平台');
  });

  test('混合合法/非法平台报错', () => {
    const errors = validateSchedule({
      publishAt: '2026-03-19T14:00:00+08:00',
      platforms: ['douyin', 'twitter'],
    });
    assert.ok(errors.some(e => e.includes('twitter')), '应报 twitter 无效');
  });
});

// ─── 测试：contentType 验证 ────────────────────────────────────────────────────
describe('contentType 字段验证（可选）', () => {
  test('未设置 contentType 不报错', () => {
    const errors = validateSchedule({
      publishAt: '2026-03-19T14:00:00+08:00',
      platforms: ['douyin'],
    });
    assert.equal(errors.length, 0);
  });

  test('合法 contentType 通过', () => {
    for (const ct of ['video', 'image', 'article']) {
      const errors = validateSchedule({
        publishAt: '2026-03-19T14:00:00+08:00',
        platforms: ['douyin'],
        contentType: ct,
      });
      assert.equal(errors.length, 0, `${ct} 应通过`);
    }
  });

  test('非法 contentType 报错', () => {
    const errors = validateSchedule({
      publishAt: '2026-03-19T14:00:00+08:00',
      platforms: ['douyin'],
      contentType: 'podcast',
    });
    assert.ok(errors.some(e => e.includes('contentType')), '应报无效 contentType');
  });
});

// ─── 测试：全量合法 schedule.json ─────────────────────────────────────────────
describe('完整 schedule.json 格式', () => {
  test('所有字段合法通过', () => {
    const errors = validateSchedule({
      publishAt: '2026-03-19T14:00:00+08:00',
      platforms: ['douyin', 'xiaohongshu'],
      contentType: 'video',
      title: '测试内容标题',
      published_at: null,
    });
    assert.equal(errors.length, 0, `应无错误，实际：${errors.join(', ')}`);
  });

  test('published_at 已设置不影响验证', () => {
    const errors = validateSchedule({
      publishAt: '2026-03-19T14:00:00+08:00',
      platforms: ['douyin'],
      published_at: '2026-03-19T14:00:05+08:00',
    });
    assert.equal(errors.length, 0, '已发布状态不应触发格式错误');
  });
});
